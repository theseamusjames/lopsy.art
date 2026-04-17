/**
 * PSD import and export — reads/writes Photoshop .psd files via the
 * Rust-side parser/writer, translating between the binary format and
 * Lopsy's layer model.
 *
 * Extracted from the old file-menu.ts to keep format glue independent of
 * menu plumbing. Thin enough to stay in one file; the heavy lifting lives
 * in engine-rs/lopsy-core/psd.
 */

import { useEditorStore } from '../app/editor-store';
import { getEngine } from '../engine-wasm/engine-state';
import {
  exportPsd,
  parsePsd,
  getPsdLayerPixels,
  getPsdLayerMask,
  initWasm,
} from '../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync } from '../engine-wasm/engine-sync';
import type { BlendMode } from '../types/color';
import type { Layer, GroupLayer, RasterLayer } from '../types/layers';
import { DEFAULT_EFFECTS } from '../layers/layer-model';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';
import { finalizePendingStrokeGlobal } from '../app/interactions/pending-stroke';

// ─── PSD Blend Mode Mapping ────────────────────────────────────────────
// Mirror tables: the index of a mode in U8_TO_BLEND_MODE equals its
// BLEND_MODE_TO_U8 value. Keep them in sync if editing.

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

  // Build mask data buffer and layer metadata.
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

    // For group markers, zero out dimensions.
    if (groupKind !== 0) {
      meta.width = 0;
      meta.height = 0;
    }

    // Pack mask data.
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

  const allMaskData = new Uint8Array(maskOffset);
  let offset = 0;
  for (const chunk of maskChunks) {
    allMaskData.set(chunk, offset);
    offset += chunk.length;
  }

  const layersJson = JSON.stringify(layerMetas);
  const psdBytes = exportPsd(engine, layersJson, allMaskData, depth);

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

  // Create a new document with the PSD dimensions.
  useEditorStore.getState().createDocument(manifest.width, manifest.height, true);

  const edState = useEditorStore.getState();
  const store = useEditorStore;

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
      // GroupEnd — start collecting children.
      groupStack.push({ groupLayer: null as unknown as GroupLayer, children: [] });
      continue;
    }

    if (psdLayer.groupKind === 1 || psdLayer.groupKind === 2) {
      // GroupOpen — finalize the group.
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

    // Normal raster layer.
    let mask: RasterLayer['mask'] = null;
    let pixelImageData: ImageData | null = null;

    if (psdLayer.width > 0 && psdLayer.height > 0) {
      const pixelData = getPsdLayerPixels(data, i);
      // For 16-bit PSDs, pixel data is big-endian u16 pairs — downscale to 8-bit.
      let rgba8: Uint8Array;
      if (manifest.depth === 16) {
        const pixelCount = psdLayer.width * psdLayer.height;
        rgba8 = new Uint8Array(pixelCount * 4);
        for (let p = 0; p < pixelCount * 4; p++) {
          rgba8[p] = pixelData[p * 2]!; // Take high byte as 8-bit approximation.
        }
      } else {
        rgba8 = pixelData;
      }

      // Stash pixels as ImageData so engine-sync uploads them with the right
      // layer descriptor (correct blend mode, opacity, etc.) on the next frame.
      const clamped = new Uint8ClampedArray(rgba8.length);
      clamped.set(rgba8);
      pixelImageData = new ImageData(clamped, psdLayer.width, psdLayer.height);

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
    // Always push to the flat layerOrder (bottom-to-top render order).
    newLayerOrder.push(layerId);
    const topGroupForLayer = groupStack[groupStack.length - 1];
    if (topGroupForLayer) {
      topGroupForLayer.children.push(layerId);
    }
  }

  const activeLayerId: string | null = newLayerOrder.length > 0
    ? newLayerOrder[newLayerOrder.length - 1] ?? null
    : null;

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
