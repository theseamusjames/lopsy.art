import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';

export function computeMoveLayer(
  doc: DocumentState,
  renderVersion: number,
  fromIndex: number,
  toIndex: number,
): Partial<EditorState> | undefined {
  const layers = [...doc.layers];
  const order = [...doc.layerOrder];
  const [movedLayer] = layers.splice(fromIndex, 1);
  const [movedOrder] = order.splice(fromIndex, 1);
  if (movedLayer === undefined || movedOrder === undefined) return undefined;
  layers.splice(toIndex, 0, movedLayer);
  order.splice(toIndex, 0, movedOrder);
  return {
    document: { ...doc, layers, layerOrder: order },
    renderVersion: renderVersion + 1,
  };
}
