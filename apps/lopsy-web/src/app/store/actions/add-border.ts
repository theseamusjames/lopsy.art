import type { DocumentState } from '../../../types';
import type { BorderPlacement } from '../../../layers/border';
import { createRasterLayer } from '../../../layers/layer-model';
import { addToGroup } from '../../../layers/group-utils';

export interface AddBorderLayerResult {
  readonly document: DocumentState;
  readonly layerId: string;
}

/**
 * Insert an empty, document-sized "Border" layer into the project group: at
 * the very bottom when the canvas was expanded (a backdrop for the new
 * margin), or at the top of the group for an overlay so it covers every
 * layer. The new layer becomes active.
 */
export function computeAddBorderLayer(doc: DocumentState, placement: BorderPlacement): AddBorderLayerResult {
  const layer = createRasterLayer({ name: 'Border', width: doc.width, height: doc.height });
  const rootIdx = doc.rootGroupId ? doc.layerOrder.indexOf(doc.rootGroupId) : -1;
  const topIdx = rootIdx === -1 ? doc.layerOrder.length : rootIdx;
  const orderIdx = placement === 'expand' ? 0 : topIdx;
  const layerOrder = [...doc.layerOrder];
  layerOrder.splice(orderIdx, 0, layer.id);

  let layers = [...doc.layers, layer];
  if (doc.rootGroupId) {
    layers = addToGroup(layers, layer.id, doc.rootGroupId, layerOrder);
  }

  return {
    document: {
      ...doc,
      layers,
      layerOrder,
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
    },
    layerId: layer.id,
  };
}
