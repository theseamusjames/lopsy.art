import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { actOnLayer, layerRefSpec, layerSummary, requireDocument, requireEngine, resolveLayer, type LayerSummary } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { canRasterizeLayerStyle } from '../../app/store/actions/rasterize-style';
import { hasEnabledEffects } from '../../layers/layer-model';
import { isGroupLayer } from '../../layers/group-utils';
import type { Layer } from '../../types';

function store() {
  return useEditorStore.getState();
}

function refuse(reason: string): never {
  throw new CommandError('refused', reason);
}

function layerAfter(id: string): Layer {
  const layer = store().document.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`Layer ${id} vanished while it was rasterized`);
  return layer;
}

export const layerRasterize = defineCommand({
  id: 'layer.rasterize',
  summary:
    'Turns a text layer into a raster layer of its rendered glyphs, as the Layers panel\'s Rasterize Layer button does ("Rasterize Layer"); a `layer` other than the active one is made active first, as a click on its row would. Returns the layer, now raster.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): LayerSummary | Promise<LayerSummary> {
    requireDocument();
    const layer = resolveLayer(ref);
    if (layer.type !== 'text') refuse(`"${layer.name}" is not a text layer: the Rasterize Layer button only shows for text layers.`);
    requireEngine();
    return actOnLayer(layer.id, () => {
      store().rasterizeTextLayer();
      const after = layerAfter(layer.id);
      if (after.type === 'text') refuse(`"${layer.name}" has nothing rendered to rasterize.`);
      return layerSummary(after);
    });
  },
});

export const layerRasterizeStyle = defineCommand({
  id: 'layer.rasterize-style',
  summary:
    'Bakes a raster or text layer\'s enabled effects into its pixels and turns them off, as the Layer Effects drawer\'s Rasterize Layer Style button does ("Rasterize Layer Style"); a text layer becomes raster. A `layer` other than the active one is made active first, as a click on its row would. Returns the layer.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): LayerSummary | Promise<LayerSummary> {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    if (isGroupLayer(layer)) refuse(`"${layer.name}" is a group: groups have no layer effects to rasterize.`);
    if (!hasEnabledEffects(layer.effects)) {
      refuse(`"${layer.name}" has no enabled effects: the Rasterize Layer Style button is disabled.`);
    }
    requireEngine();
    if (!canRasterizeLayerStyle({ ...doc, activeLayerId: layer.id })) refuse(`"${layer.name}" cannot be rasterized.`);
    return actOnLayer(layer.id, () => {
      store().rasterizeLayerStyle();
      return layerSummary(layerAfter(layer.id));
    });
  },
});
