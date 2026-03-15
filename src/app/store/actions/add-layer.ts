import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { createRasterLayer } from '../../../layers/layer-model';

export function computeAddLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> {
  const newLayer = createRasterLayer({
    name: `Layer ${doc.layers.length + 1}`,
    width: doc.width,
    height: doc.height,
  });
  const pixelData = new Map(layerPixelData);
  pixelData.set(newLayer.id, new ImageData(newLayer.width, newLayer.height));
  return {
    document: {
      ...doc,
      layers: [...doc.layers, newLayer],
      layerOrder: [...doc.layerOrder, newLayer.id],
      activeLayerId: newLayer.id,
    },
    layerPixelData: pixelData,
  };
}
