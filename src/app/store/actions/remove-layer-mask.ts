import type { DocumentState, Layer } from '../../../types';
import type { ActionResult } from '../types';

export function computeRemoveLayerMask(
  doc: DocumentState,
  renderVersion: number,
  id: string,
): ActionResult | undefined {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer?.mask) return undefined;

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, mask: null } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}
