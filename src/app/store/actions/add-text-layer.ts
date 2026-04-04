import type { DocumentState, TextLayer } from '../../../types';
import type { EditorState } from '../types';

export function computeAddTextLayer(
  doc: DocumentState,
  textLayer: TextLayer,
): Partial<EditorState> {
  return {
    document: {
      ...doc,
      layers: [...doc.layers, textLayer],
      layerOrder: [...doc.layerOrder, textLayer.id],
      activeLayerId: textLayer.id,
    },
  };
}

export function computeUpdateTextLayerProperties(
  doc: DocumentState,
  id: string,
  props: Partial<Omit<TextLayer, 'id' | 'type'>>,
): Partial<EditorState> {
  const layers = doc.layers.map((layer) => {
    if (layer.id !== id || layer.type !== 'text') return layer;
    return { ...layer, ...props };
  });
  return {
    document: { ...doc, layers },
  };
}
