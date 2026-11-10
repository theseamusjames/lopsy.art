import { useUIStore } from '../ui-store';
import {
  beginMeshWarpPreview,
  cancelMeshWarpPreview,
  previewMeshWarp,
} from '../MenuBar/mesh-warp-actions';

/**
 * Takes a previewed Mesh Warp off the layer before an undo/redo. The preview
 * keeps a copy of the layer it was armed on and writes the warp into the
 * layer itself, so a history jump left armed would snapshot the warped
 * preview for redo and Apply would blit the pre-undo copy back (#1591).
 * Returns whether a preview was suspended.
 */
export function suspendMeshWarpPreview(): boolean {
  const session = useUIStore.getState().meshWarp;
  if (!session?.previewActive) return false;
  cancelMeshWarpPreview();
  return true;
}

/** Re-arms the preview on the restored layer after a history jump. */
export function resumeMeshWarpPreview(): void {
  const session = useUIStore.getState().meshWarp;
  if (!session?.previewActive) return;
  beginMeshWarpPreview();
  previewMeshWarp(session.grid, session.bounds);
}
