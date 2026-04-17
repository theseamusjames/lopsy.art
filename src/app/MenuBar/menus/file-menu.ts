import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import { addPngMetadata, addJpegComment } from '../../../utils/image-metadata';
import { encodeBMP } from '../../../utils/bmp-encoder';
import { hasActiveAdjustments, applyAdjustmentsToImageData, aggregateGroupAdjustments } from '../../../filters/image-adjustments';
import { contextOptions, canvasColorSpace, createImageDataFromArray } from '../../../engine/color-space';
import { seedBitmapFromBlob } from '../../../engine/bitmap-cache';
import { getEngine } from '../../../engine-wasm/engine-state';
import {
  compositeForExport,
  getCompositeSize,
  exportPsd,
  parsePsd,
  getPsdLayerPixels,
  getPsdLayerMask,
  initWasm,
} from '../../../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync } from '../../../engine-wasm/engine-sync';
import type { MenuDef } from './types';
import type { BlendMode } from '../../../types/color';
import type { Layer, GroupLayer, RasterLayer } from '../../../types/layers';
import { DEFAULT_EFFECTS } from '../../../layers/layer-model';
import { DEFAULT_ADJUSTMENTS } from '../../../filters/image-adjustments';
import { finalizePendingStrokeGlobal } from '../../interactions/pending-stroke';

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
      file.arrayBuffer().then((buffer) => {
        importPsdFile(new Uint8Array(buffer), file.name.replace(/\.psd$/i, ''));
      });
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

// ─── PSD Blend Mode Mapping ────────────────────────────────────────────

const BLEND_MODE_TO_U8: Record<BlendMode, number> = {
  'normal': 0,
  'multiply': 1,
  'screen': 2,
  'overlay': 3,
  'darken': 4,
  'lighten': 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  'difference': 10,
  'exclusion': 11,
  'hue': 12,
  'saturation': 13,
  'color': 14,
  'luminosity': 15,
};

const U8_TO_BLEND_MODE: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

// ─── PSD Export ────────────────────────────────────────────────────────

function flattenLayerTreeForPsd(
  layers: readonly Layer[],
  layerOrder: readonly string[],
): Array<{ layer: Layer; groupKind: number }> {
  const layerMap = new Map<string, Layer>();
  for (const l of layers) {
    layerMap.set(l.id, l);
  }

  // Build set of layer IDs that are children of some group —
  // these are emitted recursively via their group, not as top-level.
  const childIds = new Set<string>();
  for (const l of layers) {
    if (l.type === 'group') {
      for (const childId of (l as GroupLayer).children) {
        childIds.add(childId);
      }
    }
  }

  const result: Array<{ layer: Layer; groupKind: number }> = [];

  function emitLayer(id: string): void {
    const layer = layerMap.get(id);
    if (!layer) return;

    if (layer.type === 'group') {
      const group = layer as GroupLayer;
      // PSD convention: bottom-to-top with group-end marker first,
      // then children (bottom-to-top), then group-open marker.
      result.push({ layer: group, groupKind: 3 }); // GroupEnd
      for (const childId of group.children) {
        emitLayer(childId);
      }
      result.push({ layer: group, groupKind: 1 }); // GroupOpen
    } else {
      result.push({ layer, groupKind: 0 });
    }
  }

  // Only emit root-level entries from layerOrder — skip anything that's
  // a child of a group (it will be emitted via the group's recursion).
  for (const id of layerOrder) {
    if (childIds.has(id)) continue;
    emitLayer(id);
  }

  return result;
}

export function exportPsdFile(depth: 8 | 16 = 8): void {
  const engine = getEngine();
  if (!engine) return;

  // Commit any in-progress brush stroke so its pixels are in the GPU texture
  // before we read layer data.
  finalizePendingStrokeGlobal();

  const edState = useEditorStore.getState();
  const { document: doc } = edState;

  const flatLayers = flattenLayerTreeForPsd(doc.layers, doc.layerOrder);

  // Build mask data buffer and layer metadata
  const maskChunks: Uint8Array[] = [];
  let maskOffset = 0;

  interface LayerMeta {
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    blendMode: number;
    x: number;
    y: number;
    width: number;
    height: number;
    clipToBelow: boolean;
    groupKind: number;
    maskWidth?: number;
    maskHeight?: number;
    maskX?: number;
    maskY?: number;
    maskOffset?: number;
    maskLength?: number;
    maskDefaultColor?: number;
  }

  const layerMetas: LayerMeta[] = flatLayers.map(({ layer, groupKind }) => {
    const meta: LayerMeta = {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: Math.round(layer.opacity * 255),
      blendMode: BLEND_MODE_TO_U8[layer.blendMode] ?? 0,
      x: layer.x,
      y: layer.y,
      width: (layer.type === 'raster' || layer.type === 'shape') ? (layer as RasterLayer).width : 0,
      height: (layer.type === 'raster' || layer.type === 'shape') ? (layer as RasterLayer).height : 0,
      clipToBelow: layer.clipToBelow,
      groupKind,
    };

    // For group markers, zero out dimensions
    if (groupKind !== 0) {
      meta.width = 0;
      meta.height = 0;
    }

    // Pack mask data
    if (layer.mask && layer.mask.data.length > 0) {
      const maskBytes = new Uint8Array(layer.mask.data.buffer);
      meta.maskWidth = layer.mask.width;
      meta.maskHeight = layer.mask.height;
      meta.maskX = layer.x;
      meta.maskY = layer.y;
      meta.maskOffset = maskOffset;
      meta.maskLength = maskBytes.length;
      meta.maskDefaultColor = 0;
      maskChunks.push(maskBytes);
      maskOffset += maskBytes.length;
    }

    return meta;
  });

  // Concatenate mask data
  const allMaskData = new Uint8Array(maskOffset);
  let offset = 0;
  for (const chunk of maskChunks) {
    allMaskData.set(chunk, offset);
    offset += chunk.length;
  }

  const layersJson = JSON.stringify(layerMetas);
  const psdBytes = exportPsd(engine, layersJson, allMaskData, depth);

  // Download
  const blob = new Blob([psdBytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name || 'lopsy'}.psd`;
  a.click();
  URL.revokeObjectURL(url);
  useEditorStore.getState().markClean();
}

// ─── PSD Import ────────────────────────────────────────────────────────

export async function importPsdFile(data: Uint8Array, name: string): Promise<void> {
  // Ensure the WASM module is initialized — when opening from the initial
  // modal before any document exists, the engine hasn't been created yet.
  await initWasm();

  // Reset engine-sync tracking so it cleanly re-adds all layers on the next
  // frame with the correct blend modes, opacities, and pixel data.
  const eng = getEngine();
  if (eng) resetTrackedState(eng);

  const manifestJson = parsePsd(data);
  const manifest = JSON.parse(manifestJson) as {
    width: number;
    height: number;
    depth: number;
    layers: Array<{
      name: string;
      visible: boolean;
      opacity: number;
      blendMode: number;
      x: number;
      y: number;
      width: number;
      height: number;
      clipToBelow: boolean;
      groupKind: number;
      hasMask: boolean;
      maskX?: number;
      maskY?: number;
      maskWidth?: number;
      maskHeight?: number;
    }>;
  };

  // Create a new document with the PSD dimensions
  // First set up via the store's createDocument, then populate layers
  useEditorStore.getState().createDocument(manifest.width, manifest.height, true);

  const edState = useEditorStore.getState();
  const store = useEditorStore;

  // Build layers from the PSD manifest.
  // PSD layers are bottom-to-top; engine-sync handles the actual GPU upload
  // on the next frame using the ImageData we stash in layerPixelData.
  const newLayers: Layer[] = [];
  const newLayerOrder: string[] = [];
  const newPixelData = new Map<string, ImageData>();
  const groupStack: { groupLayer: GroupLayer; children: string[] }[] = [];

  for (let i = 0; i < manifest.layers.length; i++) {
    const psdLayer = manifest.layers[i]!;
    const layerId = crypto.randomUUID();

    if (psdLayer.groupKind === 3) {
      // GroupEnd — start collecting children
      groupStack.push({ groupLayer: null as unknown as GroupLayer, children: [] });
      continue;
    }

    if (psdLayer.groupKind === 1 || psdLayer.groupKind === 2) {
      // GroupOpen — finalize the group
      const groupInfo = groupStack.pop();
      const groupLayer: GroupLayer = {
        id: layerId,
        name: psdLayer.name,
        type: 'group',
        visible: psdLayer.visible,
        locked: false,
        opacity: psdLayer.opacity / 255,
        blendMode: U8_TO_BLEND_MODE[psdLayer.blendMode] ?? 'normal',
        x: 0,
        y: 0,
        clipToBelow: false,
        effects: DEFAULT_EFFECTS,
        mask: null,
        children: groupInfo?.children ?? [],
        collapsed: psdLayer.groupKind === 2,
        adjustments: { ...DEFAULT_ADJUSTMENTS },
        adjustmentsEnabled: true,
      };
      newLayers.push(groupLayer);
      // Lopsy's layerOrder is a flat list of ALL layer IDs; groups appear
      // after their children (bottom-to-top rendering).
      newLayerOrder.push(layerId);
      const topGroup = groupStack[groupStack.length - 1];
      if (topGroup) {
        topGroup.children.push(layerId);
      }
      continue;
    }

    // Normal raster layer
    let mask: RasterLayer['mask'] = null;
    let pixelImageData: ImageData | null = null;

    if (psdLayer.width > 0 && psdLayer.height > 0) {
      const pixelData = getPsdLayerPixels(data, i);
      // For 16-bit PSDs, pixel data is big-endian u16 pairs — downscale to 8-bit
      let rgba8: Uint8Array;
      if (manifest.depth === 16) {
        const pixelCount = psdLayer.width * psdLayer.height;
        rgba8 = new Uint8Array(pixelCount * 4);
        for (let p = 0; p < pixelCount * 4; p++) {
          rgba8[p] = pixelData[p * 2]!; // Take high byte as 8-bit approximation
        }
      } else {
        rgba8 = pixelData;
      }

      // Stash pixels as ImageData so engine-sync uploads them with the right
      // layer descriptor (correct blend mode, opacity, etc.) on the next frame.
      // Copy into a fresh ArrayBuffer — ImageData requires a non-shared buffer.
      const clamped = new Uint8ClampedArray(rgba8.length);
      clamped.set(rgba8);
      pixelImageData = new ImageData(clamped, psdLayer.width, psdLayer.height);

      // Collect mask data (upload via engine-sync by storing on the layer)
      if (psdLayer.hasMask && psdLayer.maskWidth && psdLayer.maskHeight) {
        const maskData = getPsdLayerMask(data, i);
        if (maskData.length > 0) {
          mask = {
            id: crypto.randomUUID(),
            enabled: true,
            data: new Uint8ClampedArray(maskData.buffer, maskData.byteOffset, maskData.byteLength),
            width: psdLayer.maskWidth,
            height: psdLayer.maskHeight,
          };
        }
      }
    }

    const rasterLayer: RasterLayer = {
      id: layerId,
      name: psdLayer.name,
      type: 'raster',
      visible: psdLayer.visible,
      locked: false,
      opacity: psdLayer.opacity / 255,
      blendMode: U8_TO_BLEND_MODE[psdLayer.blendMode] ?? 'normal',
      x: psdLayer.x,
      y: psdLayer.y,
      clipToBelow: psdLayer.clipToBelow,
      effects: DEFAULT_EFFECTS,
      mask,
      width: psdLayer.width,
      height: psdLayer.height,
    };

    newLayers.push(rasterLayer);
    if (pixelImageData) {
      newPixelData.set(layerId, pixelImageData);
    }
    // Always push to the flat layerOrder (bottom-to-top render order)
    newLayerOrder.push(layerId);
    const topGroupForLayer = groupStack[groupStack.length - 1];
    if (topGroupForLayer) {
      topGroupForLayer.children.push(layerId);
    }
  }

  // Update store with the new document structure
  const activeLayerId: string | null = newLayerOrder.length > 0
    ? newLayerOrder[newLayerOrder.length - 1] ?? null
    : null;

  // Mark every layer with pixel data as dirty so engine-sync uploads it.
  const dirtyLayerIds = new Set<string>(newPixelData.keys());

  store.setState({
    document: {
      ...edState.document,
      name,
      width: manifest.width,
      height: manifest.height,
      layers: newLayers,
      layerOrder: newLayerOrder,
      activeLayerId,
    },
    layerPixelData: newPixelData,
    sparseLayerData: new Map(),
    dirtyLayerIds,
    isDirty: false,
    renderVersion: edState.renderVersion + 1,
  });

  // Push the new state to the WASM engine immediately so the first frame
  // renders with the correct blend modes, opacities, and pixel data.
  flushLayerSync(store.getState());

  store.getState().fitToView();
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
