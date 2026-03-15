import type { EditorState, SelectionData } from '../types';
import { createRasterLayer } from '../../../layers/layer-model';

export function computeOpenImage(
  imageData: ImageData,
  name: string,
): Partial<EditorState> {
  const layer = createRasterLayer({ name: 'Background', width: imageData.width, height: imageData.height });
  const pixelData = new Map<string, ImageData>();
  pixelData.set(layer.id, imageData);
  const selection: SelectionData = { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 };
  return {
    document: {
      id: crypto.randomUUID(),
      name,
      width: imageData.width,
      height: imageData.height,
      layers: [layer],
      layerOrder: [layer.id],
      activeLayerId: layer.id,
      backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    },
    layerPixelData: pixelData,
    undoStack: [],
    redoStack: [],
    renderVersion: 0,
    selection,
    documentReady: true,
    isDirty: false,
  };
}
