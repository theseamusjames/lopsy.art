/**
 * Per-frame layer sync: diffs the current layer array against what the
 * engine already knows and pushes only the deltas (adds, updates, removes,
 * pixel uploads, mask uploads, layer order).
 *
 * This is the hottest part of engine sync and lives in its own file so the
 * surrounding engine-sync.ts stays small. Shared tracked state lives in
 * sync-state.ts so other sync functions can read and mutate it too.
 */

import type { Engine } from './wasm-bridge';
import type { Layer, GroupLayer } from '../types';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { buildLayerIndex, isEffectivelyVisible, type LayerIndex } from '../layers/layer-index';
import { BLEND_MODE_TO_PASCAL as BLEND_MODE_MAP } from '../types/blend-mode-tables';
import {
  addLayer,
  removeLayer,
  updateLayer,
  setLayerOrder,
  uploadLayerPixels,
  uploadLayerSparsePixels,
  uploadLayerMask,
  removeLayerMask,
} from './wasm-bridge';
import { getTracked } from './sync-state';

const LAYER_TYPE_MAP: Record<string, string> = {
  'raster': 'Raster',
  'text': 'Text',
  'shape': 'Shape',
  'group': 'Group',
  'adjustment': 'Adjustment',
};

export function layerToDescJson(layer: Layer, effectiveVisible: boolean): string {
  const effects: Record<string, unknown> = {};

  const eff = layer.effects;

  if (eff.outerGlow.enabled) {
    const c = eff.outerGlow.color;
    effects.outer_glow = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      size: eff.outerGlow.size,
      spread: eff.outerGlow.spread,
      opacity: eff.outerGlow.opacity,
    };
  }
  if (eff.innerGlow.enabled) {
    const c = eff.innerGlow.color;
    effects.inner_glow = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      size: eff.innerGlow.size,
      spread: eff.innerGlow.spread,
      opacity: eff.innerGlow.opacity,
    };
  }
  if (eff.dropShadow.enabled) {
    const c = eff.dropShadow.color;
    effects.drop_shadow = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      offset_x: eff.dropShadow.offsetX,
      offset_y: eff.dropShadow.offsetY,
      blur: eff.dropShadow.blur,
      spread: eff.dropShadow.spread,
      opacity: eff.dropShadow.opacity ?? c.a,
    };
  }
  if (eff.stroke.enabled) {
    const c = eff.stroke.color;
    const posMap: Record<string, string> = {
      'outside': 'Outside',
      'inside': 'Inside',
      'center': 'Center',
    };
    effects.stroke = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      width: eff.stroke.width,
      position: posMap[eff.stroke.position] ?? 'Outside',
      opacity: 1.0,
    };
  }
  if (eff.colorOverlay.enabled) {
    const c = eff.colorOverlay.color;
    effects.color_overlay = {
      enabled: true,
      color: [c.r / 255, c.g / 255, c.b / 255, c.a],
      opacity: 1.0,
    };
  }

  const width = 'width' in layer ? (layer.width ?? 0) : 0;
  const height = 'height' in layer ? (layer.height ?? 0) : 0;

  const desc: Record<string, unknown> = {
    id: layer.id,
    name: layer.name,
    layer_type: LAYER_TYPE_MAP[layer.type] ?? 'Raster',
    visible: effectiveVisible,
    locked: layer.locked,
    opacity: layer.opacity,
    blend_mode: BLEND_MODE_MAP[layer.blendMode] ?? 'Normal',
    x: layer.x,
    y: layer.y,
    width,
    height,
    clip_to_below: layer.clipToBelow,
    effects,
    mask: layer.mask ? {
      enabled: layer.mask.enabled,
      linked: true,
      width: layer.mask.width,
      height: layer.mask.height,
    } : null,
  };

  if (layer.type === 'group' && 'children' in layer) {
    desc.children = (layer as GroupLayer).children;
  }

  return JSON.stringify(desc);
}

export function syncLayers(
  engine: Engine,
  layers: readonly Layer[],
  layerOrder: readonly string[],
  dirtyLayerIds: Set<string>,
): void {
  const tracked = getTracked(engine);
  const currentIds = new Set(layers.map((l) => l.id));

  // Build a per-sync LayerIndex so ancestor-visibility checks are O(depth)
  // per layer instead of the O(n²) nested walk this used to do.
  const index: LayerIndex = buildLayerIndex(layers);

  // Remove layers no longer present
  for (const id of tracked.layerIds) {
    if (!currentIds.has(id)) {
      try {
        removeLayer(engine, id);
      } catch (e) {
        console.error('[syncLayers] removeLayer failed:', id, e);
      }
      tracked.layerVersions.delete(id);
      tracked.layerRefs.delete(id);
      tracked.layerEffectiveVisible.delete(id);
      tracked.masksOnEngine.delete(id);
      tracked.pixelDataVersions.delete(id);
      tracked.sparseVersions.delete(id);
    }
  }

  // Track which layers were successfully added so we don't mark failed
  // adds as tracked (which would prevent retry on the next frame).
  const failedAdds = new Set<string>();

  // Add or update layers
  for (const layer of layers) {
    const effectiveVisible = isEffectivelyVisible(index, layer.id);

    // Fast path: if both the layer reference and its effective visibility
    // are unchanged since last sync, the descriptor JSON is also unchanged.
    // Skip the serialization entirely. This is the common case — most
    // frames re-render without any layer mutation.
    const refUnchanged = tracked.layerRefs.get(layer.id) === layer;
    const visUnchanged = tracked.layerEffectiveVisible.get(layer.id) === effectiveVisible;
    const isKnown = tracked.layerIds.has(layer.id);

    let descJson: string | undefined;
    if (!isKnown || !refUnchanged || !visUnchanged) {
      descJson = layerToDescJson(layer, effectiveVisible);
    }

    if (!isKnown) {
      try {
        addLayer(engine, descJson!);
        tracked.layerVersions.set(layer.id, descJson!);
        tracked.layerRefs.set(layer.id, layer);
        tracked.layerEffectiveVisible.set(layer.id, effectiveVisible);
      } catch (e) {
        console.error('[syncLayers] addLayer failed:', layer.id, e);
        failedAdds.add(layer.id);
      }
    } else if (descJson !== undefined && tracked.layerVersions.get(layer.id) !== descJson) {
      try {
        updateLayer(engine, descJson);
        tracked.layerVersions.set(layer.id, descJson);
      } catch (e) {
        console.error('[syncLayers] updateLayer failed:', layer.id, e);
      }
      tracked.layerRefs.set(layer.id, layer);
      tracked.layerEffectiveVisible.set(layer.id, effectiveVisible);
    } else if (descJson !== undefined) {
      tracked.layerRefs.set(layer.id, layer);
      tracked.layerEffectiveVisible.set(layer.id, effectiveVisible);
    }

    // Upload pixel data if changed or marked dirty (including GPU paint dirty).
    // When no JS data exists AND no sparse data, the GPU texture is source of truth
    // (e.g. after a GPU paint stroke or undo restore) — skip upload.
    const data = pixelDataManager.get(layer.id);
    const sparseEntry = pixelDataManager.getSparse(layer.id);
    const isDirty = dirtyLayerIds.has(layer.id);
    const pixelChanged = tracked.pixelDataVersions.get(layer.id) !== data;
    const sparseChanged = tracked.sparseVersions.get(layer.id) !== sparseEntry;

    if (data && (pixelChanged || isDirty)) {
      const rawBytes = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
      uploadLayerPixels(engine, layer.id, rawBytes, data.width, data.height, layer.x, layer.y);
      tracked.pixelDataVersions.set(layer.id, data);
      tracked.sparseVersions.set(layer.id, undefined);
    } else if (!data && sparseEntry && (sparseChanged || isDirty)) {
      const indices = new Uint32Array(sparseEntry.sparse.indices);
      const rgba = new Uint8Array(sparseEntry.sparse.rgba.buffer, sparseEntry.sparse.rgba.byteOffset, sparseEntry.sparse.rgba.byteLength);
      // Use layer.x/y as authoritative position — sparse offsets may be
      // stale after updateLayerPosition() (move tool).
      uploadLayerSparsePixels(
        engine,
        layer.id,
        indices,
        rgba,
        sparseEntry.sparse.width,
        sparseEntry.sparse.height,
        layer.x,
        layer.y,
      );
      tracked.sparseVersions.set(layer.id, sparseEntry);
      tracked.pixelDataVersions.set(layer.id, undefined);
    } else if (!data && !sparseEntry) {
      // No JS data — GPU texture is source of truth (GPU paint or undo restore).
      // Only clear the GPU texture if we previously had JS data AND the layer is dirty
      // (meaning JS data was explicitly removed, not just never set).
      if (isDirty && (tracked.pixelDataVersions.get(layer.id) !== undefined || tracked.sparseVersions.get(layer.id) !== undefined)) {
        // JS data was cleared but layer is dirty — GPU already has the correct data
        // from uploadCompressed or GPU stroke. Just update tracking.
        tracked.pixelDataVersions.set(layer.id, undefined);
        tracked.sparseVersions.set(layer.id, undefined);
      }
    }

    // Upload mask
    if (layer.mask) {
      const maskBytes = new Uint8Array(layer.mask.data.buffer, layer.mask.data.byteOffset, layer.mask.data.byteLength);
      uploadLayerMask(engine, layer.id, maskBytes, layer.mask.width, layer.mask.height);
      tracked.masksOnEngine.add(layer.id);
    } else if (tracked.masksOnEngine.has(layer.id)) {
      removeLayerMask(engine, layer.id);
      tracked.masksOnEngine.delete(layer.id);
    }
  }

  // Exclude layers that failed to add — they stay out of tracking so
  // syncLayers retries addLayer on the next frame.
  for (const id of failedAdds) {
    currentIds.delete(id);
  }
  tracked.layerIds = currentIds;

  // Sync layer order
  const orderJson = JSON.stringify(layerOrder);
  if (tracked.layerOrder !== orderJson) {
    setLayerOrder(engine, orderJson);
    tracked.layerOrder = orderJson;
  }
}
