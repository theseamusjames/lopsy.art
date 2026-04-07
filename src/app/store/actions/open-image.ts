import type { EditorState, SelectionData } from '../types';
import { createRasterLayer, createGroupLayer } from '../../../layers/layer-model';

function imageHasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] as number) < 255) return true;
  }
  return false;
}

export function computeOpenImage(
  imageData: ImageData,
  name: string,
): Partial<EditorState> {
  const hasAlpha = imageHasTransparency(imageData.data);
  const layer = createRasterLayer({ name: 'Background', width: imageData.width, height: imageData.height });
  const rootGroup = createGroupLayer({ name: 'Project', children: [layer.id] });
  const pixelData = new Map<string, ImageData>();
  pixelData.set(layer.id, imageData);
  const selection: SelectionData = { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 };
  return {
    document: {
      id: crypto.randomUUID(),
      name,
      width: imageData.width,
      height: imageData.height,
      layers: [layer, rootGroup],
      layerOrder: [layer.id, rootGroup.id],
      activeLayerId: layer.id,
      backgroundColor: hasAlpha
        ? { r: 0, g: 0, b: 0, a: 0 }
        : { r: 255, g: 255, b: 255, a: 1 },
      rootGroupId: rootGroup.id,
    },
    layerPixelData: pixelData,
    sparseLayerData: new Map(),
    undoStack: [],
    redoStack: [],
    renderVersion: 0,
    selection,
    documentReady: true,
    isDirty: false,
  };
}
