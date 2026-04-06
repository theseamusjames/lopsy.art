import { useEditorStore } from '../editor-store';

/**
 * Clear JS-side pixel data for a layer, marking it dirty so the GPU texture
 * becomes the source of truth. Use this after GPU-side operations that modify
 * layer content (brush strokes, transforms, fills, etc.).
 */
export function clearJsPixelData(layerId: string): void {
  const state = useEditorStore.getState();
  const pixelDataMap = new Map(state.layerPixelData);
  pixelDataMap.delete(layerId);
  const sparseMap = new Map(state.sparseLayerData);
  sparseMap.delete(layerId);
  const dirtyIds = new Set(state.dirtyLayerIds);
  dirtyIds.add(layerId);
  useEditorStore.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
}
