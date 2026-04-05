import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { createRasterLayer } from '../../../layers/layer-model';
import { findParentGroup, isGroupLayer } from '../../../layers/group-utils';

export function computeAddLayer(
  doc: DocumentState,
): Partial<EditorState> {
  const newLayer = createRasterLayer({
    name: `Layer ${doc.layers.length + 1}`,
    width: doc.width,
    height: doc.height,
  });

  let layers = [...doc.layers, newLayer];

  // Add the new layer to the active layer's parent group, or the root group
  const activeId = doc.activeLayerId;
  let targetGroupId: string | null = null;
  if (activeId) {
    const parent = findParentGroup(doc.layers, activeId);
    if (parent) {
      targetGroupId = parent.id;
    } else if (activeId && isGroupLayer(doc.layers.find((l) => l.id === activeId)!)) {
      targetGroupId = activeId;
    }
  }
  if (!targetGroupId && doc.rootGroupId) {
    targetGroupId = doc.rootGroupId;
  }

  if (targetGroupId) {
    layers = layers.map((l) => {
      if (l.id === targetGroupId && isGroupLayer(l)) {
        return { ...l, children: [...l.children, newLayer.id] };
      }
      return l;
    });
  }

  return {
    document: {
      ...doc,
      layers,
      layerOrder: [...doc.layerOrder, newLayer.id],
      activeLayerId: newLayer.id,
    },
  };
}
