import type { DocumentState, FillConfig } from '../../../types';
import type { ActionResult } from '../types';
import { createFillLayer } from '../../../layers/layer-model';
import { getInsertionGroupId, getInsertionOrderIndex, addToGroup } from '../../../layers/group-utils';

function defaultNameForFill(fill: FillConfig): string {
  if (fill.type === 'solid-color') return 'Solid Color';
  if (fill.type === 'gradient') return 'Gradient Fill';
  return 'Pattern Fill';
}

export function computeAddFillLayer(
  doc: DocumentState,
  fill: FillConfig,
): ActionResult {
  const newLayer = createFillLayer({
    name: defaultNameForFill(fill),
    fill,
  });

  let layers = [...doc.layers, newLayer];
  const groupId = getInsertionGroupId(doc.layers, doc.activeLayerId, doc.rootGroupId);
  if (groupId) {
    layers = addToGroup(layers, newLayer.id, groupId);
  }

  const orderIdx = getInsertionOrderIndex(doc.layerOrder, doc.activeLayerId, doc.rootGroupId, doc.layers);
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
