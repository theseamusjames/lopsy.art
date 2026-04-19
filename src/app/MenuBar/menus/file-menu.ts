import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import { addPngMetadata, addJpegComment } from '../../../utils/image-metadata';
import { encodeBMP } from '../../../utils/bmp-encoder';
import { hasActiveAdjustments, applyAdjustmentsToImageData, aggregateGroupAdjustments } from '../../../filters/image-adjustments';
import { contextOptions, canvasColorSpace, isWideGamut, createImageDataFromArray } from '../../../engine/color-space';
import { seedBitmapFromBlob } from '../../../engine/bitmap-cache';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  compositeForExport,
  exportPng16,
  getCompositeSize,
} from '../../../engine-wasm/wasm-bridge';
import type { MenuDef } from './types';
import { exportPsdFile, importPsdFile } from '../../../io/psd';
import { describeError, notifyError } from '../../notifications-store';

// Re-export so existing callers (App.tsx, e2e tests) keep working.
export { importPsdFile, exportPsdFile };

const METADATA_NOTE = 'Made with Lopsy — http://lopsy.art';

function confirmIfDirty(): boolean {
  if (!useEditorStore.getState().isDirty) return true;
  return window.confirm('You have unsaved changes. Are you sure you want to continue?');
}

export function openFileFromDisk(): void {
  if (!confirmIfDirty()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.psd';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    // Route PSD files to the PSD importer
    if (/\.psd$/i.test(file.name)) {
      file
        .arrayBuffer()
        .then((buffer) => importPsdFile(new Uint8Array(buffer), file.name.replace(/\.psd$/i, '')))
        .catch((err) => notifyError(`Failed to import PSD: ${describeError(err)}`));
      return;
    }

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
        useEditorStore.getState().fitToView();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  input.click();
}

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp';

/** Export using the WASM engine's GPU compositor. */
export function exportCanvas(format: ExportFormat): void {
  const engine = getEngine();
  if (!engine) return;
  exportViaEngine(engine, format);
}

function exportViaEngine(engine: NonNullable<ReturnType<typeof getEngine>>, format: ExportFormat): void {
  const sizeArr = getCompositeSize(engine);
  const width = sizeArr[0] ?? 0;
  const height = sizeArr[1] ?? 0;
  if (width === 0 || height === 0) return;

  // PNG uses the 16-bit WASM path — composites at full precision and encodes
  // directly in Rust, bypassing the 8-bit canvas.toBlob pipeline.
  if (format === 'png') {
    try {
      const colorSpace: number = isWideGamut() ? 1 : 0;
      const pngBytes = exportPng16(engine, colorSpace);
      const blob = new Blob([pngBytes as BlobPart], { type: 'image/png' });
      addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        .then(downloadBlob)
        .catch((err) => notifyError(`Failed to export: ${describeError(err)}`));
    } catch (err) {
      notifyError(`Failed to export PNG: ${describeError(err)}`);
    }
    return;
  }

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

function downloadBlob(blob: Blob, ext = 'png'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lopsy.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
  useEditorStore.getState().markClean();
}

function finishCanvasExport(canvas: HTMLCanvasElement, width: number, height: number, format: ExportFormat): void {
  const mimeType = FORMAT_MIME[format];
  const ext = FORMAT_EXT[format];

  // BMP is encoded on the JS side — no canvas.toBlob support
  if (format === 'bmp') {
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    downloadBlob(encodeBMP(imageData), ext);
    return;
  }

  const finishExport = async (blob: Blob) => {
    const tagged =
      format === 'png'
        ? await addPngMetadata(blob, { Software: 'Lopsy', Comment: METADATA_NOTE })
        : format === 'jpeg'
          ? await addJpegComment(blob, METADATA_NOTE)
          : blob;
    downloadBlob(tagged, ext);
  };

  // Prefer OffscreenCanvas.convertToBlob which passes colorSpace to the
  // encoder, producing a color-space-aware blob.  Fall back to toBlob.
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const offCtx = offscreen.getContext('2d', contextOptions);
    if (offCtx) {
      offCtx.drawImage(canvas, 0, 0);
      offscreen
        .convertToBlob({ type: mimeType, quality: 0.92, colorSpace: canvasColorSpace } as ImageEncodeOptions)
        .then(finishExport)
        .catch((err) => notifyError(`Failed to export: ${describeError(err)}`));
      return;
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) {
      notifyError('Failed to export: browser could not encode image.');
      return;
    }
    finishExport(blob).catch((err) => notifyError(`Failed to export: ${describeError(err)}`));
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
    { label: 'Export PSD', action: () => exportPsdFile(16) },
  ],
};
