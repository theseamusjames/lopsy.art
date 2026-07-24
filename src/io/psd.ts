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
import { useUIStore } from '../app/ui-store';
import { notifyInfo } from '../app/notifications-store';
import { getEngine } from '../engine-wasm/engine-state';
import {
  exportPsd,
  parsePsd,
  decodeAndUploadPsdLayer,
  getPsdLayerMask,
  getLayerTextureDimensions,
  initWasm,
} from '../engine-wasm/wasm-bridge';
import { resetTrackedState, flushLayerSync } from '../engine-wasm/engine-sync';
import { isWideGamut } from '../engine/color-space';
import { pixelDataManager } from '../engine/pixel-data-manager';
import type { Layer, GroupLayer, RasterLayer } from '../types/layers';
import type { LayerEffects } from '../types/effects';
import { DEFAULT_EFFECTS, hasEnabledEffects } from '../layers/layer-model';
import { finalizePendingStrokeGlobal } from '../app/interactions/pending-stroke';
import { BLEND_MODE_TO_PSD_INDEX, BLEND_MODES_BY_PSD_INDEX } from '../types/blend-mode-tables';

const BLEND_MODE_TO_U8 = BLEND_MODE_TO_PSD_INDEX;
const U8_TO_BLEND_MODE = BLEND_MODES_BY_PSD_INDEX;

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
      const childSet = new Set(group.children);
      // group.children tracks membership but not visual order — use
      // layerOrder (bottom-to-top) as the source of truth for stacking.
      const sortedChildren = layerOrder.filter((cid) => childSet.has(cid));
      result.push({ layer: group, groupKind: 3 }); // GroupEnd
      for (const childId of sortedChildren) {
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

  // Commit any in-progress brush stroke and flush all pending JS pixel
  // data to the GPU before the synchronous WASM export call.  Without this
  // the rAF render loop may try to upload pending data (mutable borrow)
  // while exportPsd holds an immutable borrow, triggering a RefCell panic.
  finalizePendingStrokeGlobal();

  const edState = useEditorStore.getState();
  flushLayerSync(edState);

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
    effectsJson?: string;
  }

  const layerMetas: LayerMeta[] = flatLayers.map(({ layer, groupKind }) => {
    const meta: LayerMeta = {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: Math.round(layer.opacity * 255),
      blendMode: BLEND_MODE_TO_U8[layer.blendMode] ?? 0,
      x: Math.round(layer.x),
      y: Math.round(layer.y),
      width: (layer.type === 'raster' || layer.type === 'shape')
        ? (layer as RasterLayer).width
        : layer.type === 'text' && engine
          ? (getLayerTextureDimensions(engine, layer.id)[0] ?? 0)
          : 0,
      height: (layer.type === 'raster' || layer.type === 'shape')
        ? (layer as RasterLayer).height
        : layer.type === 'text' && engine
          ? (getLayerTextureDimensions(engine, layer.id)[1] ?? 0)
          : 0,
      clipToBelow: layer.clipToBelow,
      groupKind,
      effectsJson: hasEnabledEffects(layer.effects)
        ? JSON.stringify(layer.effects)
        : undefined,
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
      meta.maskX = Math.round(layer.x);
      meta.maskY = Math.round(layer.y);
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
  // Layer pixels are read from GPU textures in the working color space, so
  // wide-gamut documents embed a Display P3 ICC profile (resource 1039).
  // PSD header color mode: grayscale documents write a single gray channel;
  // every other Lopsy mode round-trips as RGB.
  const psdColorMode = useEditorStore.getState().document.colorMode === 'grayscale' ? 1 : 3;
  const psdBytes = exportPsd(engine, layersJson, allMaskData, depth, isWideGamut() ? 1 : 0, psdColorMode);

  const blob = new Blob([psdBytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name || 'lopsy'}.psd`;
  a.click();
  URL.revokeObjectURL(url);
  useEditorStore.getState().markClean();
}

function parseEffectsJson(json: string | undefined): LayerEffects {
  if (!json) return DEFAULT_EFFECTS;
  try {
    const parsed = JSON.parse(json) as Partial<LayerEffects>;
    return {
      stroke: parsed.stroke ?? DEFAULT_EFFECTS.stroke,
      dropShadow: parsed.dropShadow ?? DEFAULT_EFFECTS.dropShadow,
      outerGlow: parsed.outerGlow ?? DEFAULT_EFFECTS.outerGlow,
      innerGlow: parsed.innerGlow ?? DEFAULT_EFFECTS.innerGlow,
      colorOverlay: parsed.colorOverlay ?? DEFAULT_EFFECTS.colorOverlay,
    };
  } catch {
    return DEFAULT_EFFECTS;
  }
}

// ─── PSD Import ────────────────────────────────────────────────────────

export async function importPsdFile(data: Uint8Array, name: string): Promise<void> {
  useUIStore.getState().openModal({ kind: 'loading', message: 'Opening PSD…' });

  // Ensure the WASM module is initialized — when opening from the initial
  // modal before any document exists, the engine hasn't been created yet.
  await initWasm();

  const manifestJson = parsePsd(data);
  const manifest = JSON.parse(manifestJson) as {
    width: number;
    height: number;
    depth: number;
    /** PSD header color mode (1 = grayscale, 3 = RGB, 4 = CMYK). */
    colorMode?: number;
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
      sourceKind: 'raster' | 'text' | 'adjustment' | 'fill' | 'smartObject';
      hasMask: boolean;
      maskX?: number;
      maskY?: number;
      maskWidth?: number;
      maskHeight?: number;
      effectsJson?: string;
    }>;
  };

  // Create a new document with the PSD dimensions.
  useEditorStore.getState().createDocument(manifest.width, manifest.height, true);

  const edState = useEditorStore.getState();
  const store = useEditorStore;

  // PSD layers are bottom-to-top. Pixel data lives in the PSD bytes until we
  // upload it straight to the GPU below — nothing transits JS as ImageData,
  // so 16-bit precision is preserved end-to-end.
  const newLayers: Layer[] = [];
  const newLayerOrder: string[] = [];
  const pixelUploads: Array<{ layerId: string; psdIndex: number }> = [];
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
      // GroupOpen — finalize the group. Group masks round-trip the same
      // way leaf-layer masks do (the writer emits them on the divider
      // record), so read them back instead of dropping them.
      let groupMask: GroupLayer['mask'] = null;
      if (psdLayer.hasMask && psdLayer.maskWidth && psdLayer.maskHeight) {
        const maskData = getPsdLayerMask(data, i);
        if (maskData.length > 0) {
          groupMask = {
            id: crypto.randomUUID(),
            enabled: true,
            data: new Uint8ClampedArray(maskData.buffer, maskData.byteOffset, maskData.byteLength),
            width: psdLayer.maskWidth,
            height: psdLayer.maskHeight,
          };
        }
      }
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
        effects: parseEffectsJson(psdLayer.effectsJson),
        mask: groupMask,
        children: groupInfo?.children ?? [],
        collapsed: psdLayer.groupKind === 2,
        adjustments: [],
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

    if (psdLayer.width > 0 && psdLayer.height > 0) {
      pixelUploads.push({ layerId, psdIndex: i });

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
      effects: parseEffectsJson(psdLayer.effectsJson),
      mask,
      width: psdLayer.width,
      height: psdLayer.height,
    };

    newLayers.push(rasterLayer);
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

  pixelDataManager.replace(new Map(), new Map());
  store.setState({
    document: {
      ...edState.document,
      name,
      width: manifest.width,
      height: manifest.height,
      layers: newLayers,
      layerOrder: newLayerOrder,
      activeLayerId,
      selectedLayerIds: activeLayerId ? [activeLayerId] : [],
      // Grayscale PSDs open as grayscale documents. RGB and CMYK sources both
      // decode to RGB pixels on import, so they open in RGB.
      colorMode: manifest.colorMode === 1 ? 'grayscale' : 'rgb',
    },
    dirtyLayerIds: new Set<string>(),
    isDirty: false,
    renderVersion: edState.renderVersion + 1,
  });

  // The engine may not exist yet (pre-document modal import): createDocument
  // above flips documentReady, which mounts the canvas, which fires the
  // async initEngine effect. Wait for it before pushing layers and pixels.
  const engine = await waitForEngine();
  if (engine) {
    resetTrackedState(engine);
    flushLayerSync(store.getState());
    for (const { layerId, psdIndex } of pixelUploads) {
      decodeAndUploadPsdLayer(engine, layerId, data, psdIndex);
    }
  }

  store.getState().fitToView();
  useUIStore.getState().closeModalOfKind('loading');
  notifyRasterizedLayers(manifest.layers);
}

/** Photoshop-native features Lopsy flattens to pixels on import. Tell the
 *  user instead of silently dropping editability. */
function notifyRasterizedLayers(layers: Array<{ sourceKind: string }>): void {
  const counts = new Map<string, number>();
  for (const l of layers) {
    if (l.sourceKind && l.sourceKind !== 'raster') {
      counts.set(l.sourceKind, (counts.get(l.sourceKind) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return;

  const label: Record<string, [string, string]> = {
    text: ['text layer', 'text layers'],
    adjustment: ['adjustment layer', 'adjustment layers'],
    fill: ['fill layer', 'fill layers'],
    smartObject: ['smart object', 'smart objects'],
  };
  const parts = [...counts.entries()].map(([kind, n]) => {
    const [one, many] = label[kind] ?? [kind, kind];
    return `${n} ${n === 1 ? one : many}`;
  });
  notifyInfo(`PSD import: ${parts.join(', ')} rasterized — pixels are preserved but they are no longer editable as their original type.`);
}

async function waitForEngine(maxFrames = 60): Promise<ReturnType<typeof getEngine>> {
  for (let i = 0; i < maxFrames; i++) {
    const engine = getEngine();
    if (engine) return engine;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return getEngine();
}
