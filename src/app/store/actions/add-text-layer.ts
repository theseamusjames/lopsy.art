import type { DocumentState, TextLayer } from '../../../types';
import type { EditorState } from '../types';
import { getInsertionGroupId, getInsertionOrderIndex, addToGroup } from '../../../layers/group-utils';

export function computeAddTextLayer(
  doc: DocumentState,
  textLayer: TextLayer,
): Partial<EditorState> {
  let layers = [...doc.layers, textLayer];
  const groupId = getInsertionGroupId(doc.layers, doc.activeLayerId, doc.rootGroupId);
  if (groupId) {
    layers = addToGroup(layers, textLayer.id, groupId);
  }
  const orderIdx = getInsertionOrderIndex(doc.layerOrder, doc.activeLayerId, doc.rootGroupId);
  const layerOrder = [...doc.layerOrder];
  layerOrder.splice(orderIdx, 0, textLayer.id);
  return {
    document: {
      ...doc,
      layers,
      layerOrder,
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
