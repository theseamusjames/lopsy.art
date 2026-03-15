import type { DocumentState, Layer, LayerMask } from '../../../types';
import type { EditorState } from '../types';

export function computeAddLayerMask(
  doc: DocumentState,
  renderVersion: number,
  id: string,
): Partial<EditorState> | undefined {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return undefined;

  const width = layer.type === 'raster' || layer.type === 'shape' ? layer.width : doc.width;
  const height = layer.type === 'raster' || layer.type === 'shape' ? layer.height : doc.height;
  const maskData = new Uint8ClampedArray(width * height);
  maskData.fill(255);
  const layerMask: LayerMask = {
    id: crypto.randomUUID(),
    enabled: true,
    data: maskData,
    width,
    height,
  };

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, mask: layerMask } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}
