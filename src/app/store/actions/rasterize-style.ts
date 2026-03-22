import type { DocumentState, Layer } from '../../../types';
import type { EditorState } from '../types';
import { hasEnabledEffects, DEFAULT_EFFECTS } from '../../../layers/layer-model';
import { createImageData } from '../../../engine/color-space';
import { getEngine } from '../../../engine-wasm/engine-state';
import { rasterizeLayerEffects } from '../../../engine-wasm/wasm-bridge';

export function computeRasterizeStyle(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): Partial<EditorState> | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const layer = doc.layers.find((l) => l.id === activeId);
  if (!layer || !hasEnabledEffects(layer.effects)) return undefined;

  const engine = getEngine();
  if (!engine) return undefined;

  // Use the GPU compositor to render the layer with effects —
  // this produces output identical to the live rendering.
  const pixels = rasterizeLayerEffects(engine, activeId);
  if (!pixels || pixels.length === 0) return undefined;

  const result = createImageData(doc.width, doc.height);
  result.data.set(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength));

  const pixelData = new Map(layerPixelData);
  pixelData.set(activeId, result);

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === activeId
          ? {
              ...l,
              x: 0,
              y: 0,
              effects: DEFAULT_EFFECTS,
              ...(l.type === 'raster' ? { width: doc.width, height: doc.height } : {}),
            } as Layer
          : l,
      ),
    },
    layerPixelData: pixelData,
  };
}
