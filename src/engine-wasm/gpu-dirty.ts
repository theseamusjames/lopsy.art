/**
 * Tracks which layers need their GPU texture re-uploaded.
 *
 * During painting, CPU-side ImageData is mutated in place without
 * creating a new reference. The store's `dirtyLayerIds` only tracks
 * reference changes (via updateLayerPixelData). This module provides
 * a parallel dirty set that painting code and the render loop both use.
 */

const gpuDirtyLayers = new Set<string>();

/** Mark a layer as needing GPU re-upload (called during painting). */
export function markLayerGpuDirty(layerId: string): void {
  gpuDirtyLayers.add(layerId);
}

/** Consume and clear the dirty set (called once per render frame). */
export function consumeGpuDirtyLayers(): Set<string> {
  if (gpuDirtyLayers.size === 0) return gpuDirtyLayers;
  const snapshot = new Set(gpuDirtyLayers);
  gpuDirtyLayers.clear();
  return snapshot;
}
