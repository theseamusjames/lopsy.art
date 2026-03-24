import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { duplicateLayer as duplicateLayerModel } from '../../../layers/layer-model';
import { getEngine } from '../../../engine-wasm/engine-state';
import { duplicateLayerTexture } from '../../../engine-wasm/wasm-bridge';

export function computeDuplicateLayer(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer) return undefined;

  const newLayer = duplicateLayerModel(layer);
  const newId = newLayer.id;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  const newOrder = [...doc.layerOrder];
  newOrder.splice(orderIdx + 1, 0, newId);

  // GPU-side texture copy — no JS round-trip
  const engine = getEngine();
  if (engine) {
    duplicateLayerTexture(engine, activeId, newId);
  }

  // Clear any JS pixel data for the new layer (GPU is source of truth)
  const pixelData = new Map(layerPixelData);

  return {
    document: {
      ...doc,
      layers: [...doc.layers, newLayer],
      layerOrder: newOrder,
      activeLayerId: newId,
    },
    layerPixelData: pixelData,
  };
}
