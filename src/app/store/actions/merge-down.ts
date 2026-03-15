import type { DocumentState } from '../../../types';
import type { EditorState } from '../types';
import { compositeOver } from '../../../engine/compositing';
import { rasterizeEffectsToImageData } from '../../../engine/effects-renderer';
import { hasEnabledEffects } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';

export function computeMergeDown(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  if (orderIdx <= 0) return undefined;
  const belowId = doc.layerOrder[orderIdx - 1];
  if (!belowId) return undefined;

  const topLayer = doc.layers.find((l) => l.id === activeId);
  const bottomLayer = doc.layers.find((l) => l.id === belowId);
  if (!topLayer || !bottomLayer) return undefined;

  let topData = layerPixelData.get(activeId) ?? createImageData(doc.width, doc.height);
  const bottomData = layerPixelData.get(belowId) ?? createImageData(doc.width, doc.height);

  let topX = topLayer.x;
  let topY = topLayer.y;

  if (hasEnabledEffects(topLayer.effects)) {
    const rasterized = rasterizeEffectsToImageData(topLayer, topData);
    topData = rasterized.imageData;
    topX += rasterized.offsetX;
    topY += rasterized.offsetY;
  }

  const result = createImageData(bottomData.width, bottomData.height);
  result.data.set(bottomData.data);
  compositeOver(
    topData.data, bottomData.data,
    topData.width, topData.height,
    bottomData.width, bottomData.height,
    topX - bottomLayer.x, topY - bottomLayer.y,
    topLayer.opacity, result.data,
  );

  const pixelData = new Map(layerPixelData);
  pixelData.set(belowId, result);
  pixelData.delete(activeId);

  return {
    document: {
      ...doc,
      layers: doc.layers.filter((l) => l.id !== activeId),
      layerOrder: doc.layerOrder.filter((id) => id !== activeId),
      activeLayerId: belowId,
    },
    layerPixelData: pixelData,
  };
}
