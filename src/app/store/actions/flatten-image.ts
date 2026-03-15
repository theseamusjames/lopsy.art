import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { compositeOver } from '../../../engine/compositing';
import { createRasterLayer } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';

export function computeFlattenImage(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  if (doc.layers.length <= 1) return undefined;

  const { width, height, backgroundColor } = doc;
  const result = createImageData(width, height);
  for (let i = 0; i < result.data.length; i += 4) {
    result.data[i] = backgroundColor.r;
    result.data[i + 1] = backgroundColor.g;
    result.data[i + 2] = backgroundColor.b;
    result.data[i + 3] = Math.round(backgroundColor.a * 255);
  }

  for (const layerId of doc.layerOrder) {
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer || !layer.visible) continue;
    const data = layerPixelData.get(layerId);
    if (!data) continue;
    compositeOver(
      data.data, result.data,
      data.width, data.height,
      width, height,
      layer.x, layer.y,
      layer.opacity, result.data,
    );
  }

  const flatLayer = createRasterLayer({ name: 'Background', width, height });
  const pixelData = new Map<string, ImageData>();
  pixelData.set(flatLayer.id, result);

  return {
    document: {
      ...doc,
      layers: [flatLayer],
      layerOrder: [flatLayer.id],
      activeLayerId: flatLayer.id,
    },
    layerPixelData: pixelData,
  };
}
