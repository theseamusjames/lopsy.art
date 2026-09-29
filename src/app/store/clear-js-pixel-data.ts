import { useEditorStore } from '../editor-store';
import { pixelDataManager } from '../../engine/pixel-data-manager';

export interface ClearJsPixelDataOptions {
  /**
   * False skips the unconditional pixel-version bump, so thumbnails don't
   * re-read the GPU texture. For writes in the middle of a pointer gesture
   * whose pointer-up clears again (float growth during a transform drag,
   * #1018): every bump there queued a synchronous thumbnail readback.
   */
  shouldBumpVersion?: boolean;
}

/**
 * Clear JS-side pixel data for a layer, marking it dirty so the GPU texture
 * becomes the source of truth. Use this after GPU-side operations that modify
 * layer content (brush strokes, transforms, fills, etc.).
 */
export function clearJsPixelData(layerId: string, options: ClearJsPixelDataOptions = {}): void {
  pixelDataManager.remove(layerId);
  // Always bump the pixel version so thumbnails re-read the GPU texture.
  // remove() only bumps when data existed, but GPU-painted layers (brush,
  // shape, fill) may never have had JS-side data.
  if (options.shouldBumpVersion !== false) pixelDataManager.bumpVersion(layerId);
  useEditorStore.setState((state) => ({
    dirtyLayerIds: new Set(state.dirtyLayerIds).add(layerId),
  }));
}
