import type { DocumentState, Layer } from '../../../types';
import type { EditorState } from '../types';
import { rasterizeEffectsToImageData } from '../../../engine/effects-renderer';
import { hasEnabledEffects, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';

export function computeRasterizeStyle(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer || !hasEnabledEffects(layer.effects)) return undefined;

  const data = layerPixelData.get(activeId) ?? createImageData(doc.width, doc.height);
  const result = rasterizeEffectsToImageData(layer, data);

  const pixelData = new Map(layerPixelData);
  pixelData.set(activeId, result.imageData);

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === activeId
          ? {
              ...l,
              x: l.x + result.offsetX,
              y: l.y + result.offsetY,
              effects: DEFAULT_EFFECTS,
              ...(l.type === 'raster' ? { width: result.imageData.width, height: result.imageData.height } : {}),
            } as Layer
          : l,
      ),
    },
    layerPixelData: pixelData,
  };
}
