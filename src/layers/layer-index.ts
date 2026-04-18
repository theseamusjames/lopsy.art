import type { Layer, GroupLayer } from '../types';

/**
 * Precomputed lookup tables over a layer list.
 *
 * Building an index is O(n); every query is O(1) or O(depth). Use this
 * instead of repeated `layers.find(l => l.id === ...)` calls — a single
 * find is cheap, but the patterns that need it (visibility walks, depth
 * computation, ancestor checks) become O(n²) without an index.
 *
 * The index is keyed by Layer reference, not layer id — so when the store
 * produces a new layer array with the same references, callers can reuse
 * an existing index.
 */
export interface LayerIndex {
  readonly layers: readonly Layer[];
  readonly byId: ReadonlyMap<string, Layer>;
  /** Parent id for each layer id. Null if the layer has no parent (root). */
  readonly parentOf: ReadonlyMap<string, string | null>;
}

export function buildLayerIndex(layers: readonly Layer[]): LayerIndex {
  const byId = new Map<string, Layer>();
  const parentOf = new Map<string, string | null>();

  for (const layer of layers) {
    byId.set(layer.id, layer);
    if (!parentOf.has(layer.id)) parentOf.set(layer.id, null);

    if (layer.type === 'group') {
      const group = layer as GroupLayer;
      for (const childId of group.children) {
        parentOf.set(childId, layer.id);
      }
    }
  }

  return { layers, byId, parentOf };
}

/**
 * True if the layer is visible and every ancestor group is also visible.
 * O(depth) — typically O(1) or O(log n), never O(n²).
 */
export function isEffectivelyVisible(index: LayerIndex, layerId: string): boolean {
  let currentId: string | null = layerId;
  while (currentId) {
    const layer = index.byId.get(currentId);
    if (!layer) return false;
    if (!layer.visible) return false;
    currentId = index.parentOf.get(currentId) ?? null;
  }
  return true;
}

/** Depth of a layer in the group hierarchy (0 = root child). */
export function getLayerDepth(index: LayerIndex, layerId: string): number {
  let depth = 0;
  let current: string | null = index.parentOf.get(layerId) ?? null;
  while (current) {
    depth++;
    current = index.parentOf.get(current) ?? null;
  }
  return depth;
}

/** True if `ancestorId` appears anywhere up the group chain from `layerId`. */
export function isAncestorOf(index: LayerIndex, ancestorId: string, layerId: string): boolean {
  let current: string | null = index.parentOf.get(layerId) ?? null;
  while (current) {
    if (current === ancestorId) return true;
    current = index.parentOf.get(current) ?? null;
  }
  return false;
}
