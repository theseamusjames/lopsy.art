import { useEditorStore } from '../editor-store';
import { pixelDataManager } from '../../engine/pixel-data-manager';

/**
 * Clear JS-side pixel data for a layer, marking it dirty so the GPU texture
 * becomes the source of truth. Use this after GPU-side operations that modify
 * layer content (brush strokes, transforms, fills, etc.).
 */
export function clearJsPixelData(layerId: string): void {
  pixelDataManager.remove(layerId);
  // Always bump the pixel version so thumbnails re-read the GPU texture.
  // remove() only bumps when data existed, but GPU-painted layers (brush,
  // shape, fill) may never have had JS-side data.
  pixelDataManager.bumpVersion(layerId);
  useEditorStore.setState((state) => ({
    dirtyLayerIds: new Set(state.dirtyLayerIds).add(layerId),
  }));
}
