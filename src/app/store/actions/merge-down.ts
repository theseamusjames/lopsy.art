import type { DocumentState } from '../../../types';
import type { ActionResult } from '../types';
import { getEngine } from '../../../engine-wasm/engine-state';
import { mergeLayers, rasterizeLayerEffects, updateLayer, uploadLayerPixels } from '../../../engine-wasm/wasm-bridge';
import { DEFAULT_EFFECTS, hasEnabledEffects } from '../../../layers/layer-model';
import { removeFromParentGroup } from '../../../layers/group-utils';
import { BLEND_MODE_TO_PASCAL } from '../../../types/blend-mode-tables';

export function computeMergeDown(
  doc: DocumentState,
  layerPixelData: Map<string, ImageData>,
): ActionResult | undefined {
  const activeId = doc.activeLayerId;
  if (!activeId) return undefined;
  const orderIdx = doc.layerOrder.indexOf(activeId);
  if (orderIdx <= 0) return undefined;
  const belowId = doc.layerOrder[orderIdx - 1];
  if (!belowId) return undefined;

  const topLayer = doc.layers.find((l) => l.id === activeId);
  const bottomLayer = doc.layers.find((l) => l.id === belowId);
  if (!topLayer || !bottomLayer) return undefined;

  let bottomRasterized = false;
  const engine = getEngine();
  if (engine) {
    if (hasEnabledEffects(topLayer.effects)) {
      const rasterized = rasterizeLayerEffects(engine, activeId);
      if (rasterized && rasterized.length > 0) {
        uploadLayerPixels(engine, activeId, rasterized, doc.width, doc.height, 0, 0);
        updateLayer(engine, JSON.stringify({
          id: topLayer.id,
          name: topLayer.name,
          layer_type: topLayer.type === 'text' ? 'Text' : topLayer.type === 'group' ? 'Group' : 'Raster',
          visible: topLayer.visible,
          locked: topLayer.locked,
          opacity: topLayer.opacity,
          blend_mode: BLEND_MODE_TO_PASCAL[topLayer.blendMode] ?? 'Normal',
          x: 0,
          y: 0,
          width: doc.width,
          height: doc.height,
          clip_to_below: topLayer.clipToBelow,
          effects: {},
          mask: null,
        }));
      }
    }

    if (hasEnabledEffects(bottomLayer.effects)) {
      const rasterized = rasterizeLayerEffects(engine, belowId);
      if (rasterized && rasterized.length > 0) {
        uploadLayerPixels(engine, belowId, rasterized, doc.width, doc.height, 0, 0);
        updateLayer(engine, JSON.stringify({
          id: bottomLayer.id,
          name: bottomLayer.name,
          layer_type: bottomLayer.type === 'text' ? 'Text' : bottomLayer.type === 'group' ? 'Group' : 'Raster',
          visible: bottomLayer.visible,
          locked: bottomLayer.locked,
          opacity: bottomLayer.opacity,
          blend_mode: BLEND_MODE_TO_PASCAL[bottomLayer.blendMode] ?? 'Normal',
          x: 0,
          y: 0,
          width: doc.width,
          height: doc.height,
          clip_to_below: bottomLayer.clipToBelow,
          effects: {},
          mask: null,
        }));
        bottomRasterized = true;
      }
    }

    // GPU-side merge: composite top onto bottom.
    // mergeLayers calls ensure_layer_full_size on the bottom layer,
    // which may reposition it to (0, 0). The JS position update below
    // keeps the store in sync.
    mergeLayers(engine, activeId, belowId);
  }

  // Clear stale JS pixel data
  const pixelData = new Map(layerPixelData);
  pixelData.delete(activeId);
  pixelData.delete(belowId);

  // Remove merged layer from its parent group's children
  let layers = removeFromParentGroup(doc.layers, activeId);
  layers = layers.filter((l) => l.id !== activeId);

  // mergeLayers always produces a doc-sized result at (0, 0).
  layers = layers.map((l) => {
    if (l.id !== belowId) return l;
    return { ...l, effects: DEFAULT_EFFECTS, x: 0, y: 0, width: doc.width, height: doc.height } as typeof l;
  });

  return {
    document: {
      ...doc,
      layers,
      layerOrder: doc.layerOrder.filter((id) => id !== activeId),
      activeLayerId: belowId,
    },
    layerPixelData: pixelData,
  };
}
