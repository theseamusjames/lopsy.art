import type { DocumentState, FillConfig, FillLayer } from '../../../types';

export function computeUpdateFillConfig(
  doc: DocumentState,
  renderVersion: number,
  id: string,
  newFill: FillConfig,
): { document: DocumentState; renderVersion: number } | null {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.type !== 'fill') return null;

  const fillLayer = layer as FillLayer;
  const updatedLayer: FillLayer = { ...fillLayer, fill: newFill };
  const layers = doc.layers.map((l) => l.id === id ? updatedLayer : l);

  return {
    document: { ...doc, layers },
    renderVersion: renderVersion + 1,
  };
}
