/**
 * Tracks which layer-mask GPU textures have changed since the last pixel
 * history snapshot.
 *
 * Undo snapshots of masks are GPU→GPU blits (`snapshotMaskGpu`), and a
 * full-document mask is a full-document texture — at 4K each copy is
 * tens of MB of VRAM. `pushHistory` therefore reuses the previous
 * snapshot's mask handle for every mask that nothing has written to
 * since, the same way layer snapshots are shared for layers that are not
 * in `dirtyLayerIds` (#780).
 *
 * Every wasm-bridge entry point that writes a mask texture marks it here
 * (see the wrappers in `wasm-bridge.ts`), so the set is complete without
 * each caller having to remember to mark. Undo/redo mark everything
 * dirty, which mirrors how they reset `dirtyLayerIds` to every layer.
 */

const dirtyIds = new Set<string>();
let isEverythingDirty = true;

export function markMaskGpuDirty(layerId: string): void {
  dirtyIds.add(layerId);
}

export function markAllMasksGpuDirty(): void {
  isEverythingDirty = true;
}

export function isMaskGpuDirty(layerId: string): boolean {
  return isEverythingDirty || dirtyIds.has(layerId);
}

/** Called once a snapshot has captured every mask's current texture. */
export function clearMaskGpuDirty(): void {
  dirtyIds.clear();
  isEverythingDirty = false;
}
