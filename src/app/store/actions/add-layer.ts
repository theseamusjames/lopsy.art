import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { createRasterLayer } from '../../../layers/layer-model';
import { getInsertionGroupId, getInsertionOrderIndex, addToGroup } from '../../../layers/group-utils';

export function computeAddLayer(
  doc: DocumentState,
): Partial<EditorState> {
  const newLayer = createRasterLayer({
    name: `Layer ${doc.layers.length + 1}`,
    width: doc.width,
    height: doc.height,
  });

  let layers = [...doc.layers, newLayer];
  const groupId = getInsertionGroupId(doc.layers, doc.activeLayerId, doc.rootGroupId);
  if (groupId) {
    layers = addToGroup(layers, newLayer.id, groupId);
  }

  const orderIdx = getInsertionOrderIndex(doc.layerOrder, doc.activeLayerId, doc.rootGroupId);
  const layerOrder = [...doc.layerOrder];
  layerOrder.splice(orderIdx, 0, newLayer.id);

  return {
    document: {
      ...doc,
      layers,
      layerOrder,
      activeLayerId: newLayer.id,
    },
  };
}
