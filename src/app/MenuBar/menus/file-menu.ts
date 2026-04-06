import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import {
  CanvasAllocator,
  applyColorOverlay,
  renderOuterGlow,
  renderInnerGlow,
  renderDropShadow,
  renderStroke,
} from '../../../engine/effects-renderer';
import { renderLayerContent } from '../../rendering/render-layers';
import { addPngMetadata, addJpegComment } from '../../../utils/image-metadata';
import { encodeBMP } from '../../../utils/bmp-encoder';
import { hasActiveAdjustments, applyAdjustmentsToImageData, aggregateGroupAdjustments } from '../../../filters/image-adjustments';
import { contextOptions, canvasColorSpace, createImageDataFromArray } from '../../../engine/color-space';
import { getCachedBitmap, seedBitmapFromBlob } from '../../../engine/bitmap-cache';
import { hasEnabledEffects } from '../../../layers/layer-model';
import { getEngine } from '../../../engine-wasm/engine-state';
import { compositeForExport, getCompositeSize } from '../../../engine-wasm/wasm-bridge';
import type { MenuDef } from './types';

const METADATA_NOTE = 'Made with Lopsy — http://lopsy.art';

function confirmIfDirty(): boolean {
  if (!useEditorStore.getState().isDirty) return true;
  return window.confirm('You have unsaved changes. Are you sure you want to continue?');
}

export function openFileFromDisk(): void {
  if (!confirmIfDirty()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      // Use sRGB context — internal pipeline works in sRGB
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const name = file.name.replace(/\.[^.]+$/, '');
        useEditorStore.getState().openImageAsDocument(imageData, name);
        // Seed the bitmap cache from the original file so the rendering
        // path uses the browser's native decoded bitmap rather than one
        // rebuilt from the canvas-round-tripped ImageData.
        const layerId = useEditorStore.getState().document.activeLayerId;
        if (layerId) seedBitmapFromBlob(layerId, file);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  input.click();
}

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp';

/**
 * Export using the WASM engine's GPU compositor.
 * Falls back to the CPU compositing path if the engine is unavailable.
 */
export function exportCanvas(format: ExportFormat): void {
  const engine = getEngine();

  if (engine) {
    exportViaEngine(engine, format);
  } else {
    exportViaCpu(format);
  }
}

function exportViaEngine(engine: NonNullable<ReturnType<typeof getEngine>>, format: ExportFormat): void {
  const sizeArr = getCompositeSize(engine);
  const width = sizeArr[0] ?? 0;
  const height = sizeArr[1] ?? 0;
  if (width === 0 || height === 0) return;

  const rawPixels = compositeForExport(engine);
  const clamped = new Uint8ClampedArray(width * height * 4);
  clamped.set(rawPixels);
  const imageData = createImageDataFromArray(clamped, width, height);

  // Apply post-composite image adjustments aggregated from all groups
  const edState = useEditorStore.getState();
  const adj = aggregateGroupAdjustments(edState.document.layers);
  if (adj && hasActiveAdjustments(adj)) {
    applyAdjustmentsToImageData(imageData, adj);
  }

  // GPU output is in the working color space (P3 on capable displays).
  // Create the export canvas in the same color space and putImageData
  // directly — no intermediate conversion needed.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return;
  ctx.putImageData(imageData, 0, 0);

  finishCanvasExport(canvas, width, height, format);
}

function exportViaCpu(format: ExportFormat): void {
  const state = useEditorStore.getState();
  const { width, height, backgroundColor } = state.document;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return;

  // Fill background
  ctx.fillStyle = `rgba(${backgroundColor.r},${backgroundColor.g},${backgroundColor.b},${backgroundColor.a})`;
  ctx.fillRect(0, 0, width, height);

  // Composite all visible layers
  const allocator = new CanvasAllocator();
  for (const layerId of state.document.layerOrder) {
    const layer = state.document.layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible) continue;
    const data = state.resolvePixelData(layerId);
    if (!data) continue;

    ctx.globalAlpha = layer.opacity;

    // Use cached bitmap for layers without effects for color-correct export
    const bitmap = getCachedBitmap(layerId);
    const hasMask = layer.mask?.enabled;
    if (bitmap && !hasEnabledEffects(layer.effects) && !hasMask) {
      ctx.drawImage(bitmap, layer.x, layer.y);
      continue;
    }

    const { canvas: tempCanvas, ctx: tempCtx } = allocator.acquire(data.width, data.height);
    if (bitmap && !layer.effects.colorOverlay.enabled) {
      tempCtx.drawImage(bitmap, 0, 0);
    } else {
      tempCtx.putImageData(data, 0, 0);
    }

    if (layer.effects.colorOverlay.enabled) {
      const overlaid = tempCtx.getImageData(0, 0, data.width, data.height);
      applyColorOverlay(overlaid, layer);
      tempCtx.putImageData(overlaid, 0, 0);
    }

    renderOuterGlow(ctx, tempCanvas, layer, data, allocator);
    renderDropShadow(ctx, tempCanvas, layer, data, allocator);
    renderLayerContent(ctx, tempCanvas, layer, data, false, null, allocator);
    renderInnerGlow(ctx, tempCanvas, layer, data, allocator);
    renderStroke(ctx, tempCanvas, layer, data, allocator);
  }
  ctx.globalAlpha = 1;
  allocator.releaseAll();

  // Apply post-composite image adjustments aggregated from all groups
  const edState2 = useEditorStore.getState();
  const adj2 = aggregateGroupAdjustments(edState2.document.layers);
  if (adj2 && hasActiveAdjustments(adj2)) {
    const imgData = ctx.getImageData(0, 0, width, height);
    applyAdjustmentsToImageData(imgData, adj2);
    ctx.putImageData(imgData, 0, 0);
  }

  finishCanvasExport(canvas, width, height, format);
}

const FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

const FORMAT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  bmp: 'bmp',
};

function finishCanvasExport(canvas: HTMLCanvasElement, width: number, height: number, format: ExportFormat): void {
  const mimeType = FORMAT_MIME[format];
  const ext = FORMAT_EXT[format];

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lopsy.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    useEditorStore.getState().markClean();
  };

  // BMP is encoded on the JS side — no canvas.toBlob support
  if (format === 'bmp') {
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    downloadBlob(encodeBMP(imageData));
    return;
  }

  const finishExport = async (blob: Blob) => {
    const tagged =
      format === 'png'
        ? await addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        : format === 'jpeg'
          ? await addJpegComment(blob, METADATA_NOTE)
          : blob;
    downloadBlob(tagged);
  };

  // Prefer OffscreenCanvas.convertToBlob which passes colorSpace to the
  // encoder, producing a color-space-aware blob.  Fall back to toBlob.
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const offCtx = offscreen.getContext('2d', contextOptions);
    if (offCtx) {
      offCtx.drawImage(canvas, 0, 0);
      offscreen.convertToBlob({ type: mimeType, quality: 0.92, colorSpace: canvasColorSpace } as ImageEncodeOptions)
        .then(finishExport);
      return;
    }
  }

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    await finishExport(blob);
  }, mimeType, 0.92);
}

export const fileMenu: MenuDef = {
  label: 'File',
  items: [
    { label: 'New', shortcut: '\u2318N', action: () => { if (confirmIfDirty()) useUIStore.getState().setShowNewDocumentModal(true); } },
    { label: 'Open...', shortcut: '\u2318O', action: () => openFileFromDisk() },
    { separator: true, label: '' },
    { label: 'Export PNG', shortcut: '\u21E7\u2318E', action: () => exportCanvas('png') },
    { label: 'Export JPEG', action: () => exportCanvas('jpeg') },
    { label: 'Export WebP', action: () => exportCanvas('webp') },
    { label: 'Export BMP', action: () => exportCanvas('bmp') },
  ],
};
