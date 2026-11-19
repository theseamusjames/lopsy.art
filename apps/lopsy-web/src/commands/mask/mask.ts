import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { activateIfOther, enterMaskEdit, layerRefSpec, requireDocument, resolveLayer, selectReplace } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { addMaskAndEdit, removeMaskAndLeaveEdit } from '../../panels/LayerPanel/mask-actions';
import { convertMaskToMarquee } from '../../panels/LayerPanel/layer-selection';
import { materializeMaskData } from '../../app/mask-data-sync';
import type { Layer } from '../../types';

export interface MaskState {
  layer: string;
  hasMask: boolean;
  /** Whether the mask applies; null when the layer has no mask. */
  enabled: boolean | null;
  /** Whether paint, fill and filters go to this layer's mask (layer-mask edit mode on, this layer active). */
  editing: boolean;
}

export interface MaskSelectionResult {
  selection: { x: number; y: number; width: number; height: number } | null;
  editing: boolean;
}

function store() {
  return useEditorStore.getState();
}

function refuse(reason: string): never {
  throw new CommandError('refused', reason);
}

function isEditing(layerId: string): boolean {
  return useUIStore.getState().maskMode === 'layerMask' && store().document.activeLayerId === layerId;
}

function maskState(layerId: string): MaskState {
  const layer = store().document.layers.find((l) => l.id === layerId);
  return {
    layer: layerId,
    hasMask: !!layer?.mask,
    enabled: layer?.mask ? layer.mask.enabled : null,
    editing: isEditing(layerId),
  };
}

function maskedLayer(ref: string | undefined): Layer {
  requireDocument();
  const layer = resolveLayer(ref);
  if (!layer.mask) refuse(`"${layer.name}" has no mask.`);
  return layer;
}

export const maskAdd = defineCommand({
  id: 'mask.add',
  summary:
    'Adds a layer mask and enters mask edit mode, as the Layers panel\'s Add Mask button does ("Add Mask"): with a pixel selection the mask reveals only the selection and the selection is dropped, otherwise it reveals everything. A `layer` other than the active one is made active first, as a click on its row would. Returns the mask state.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): MaskState {
    requireDocument();
    const layer = resolveLayer(ref);
    if (layer.mask) refuse(`"${layer.name}" already has a mask: the Add Mask button is hidden while the active layer has one.`);
    activateIfOther(layer.id);
    addMaskAndEdit(layer.id);
    return maskState(layer.id);
  },
});

export const maskRemove = defineCommand({
  id: 'mask.remove',
  summary:
    'Deletes a layer\'s mask (discarding it, not applying it) and leaves mask edit mode, as the Delete mask button on the layer\'s mask row does ("Remove Mask"). Returns the mask state.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): MaskState {
    const layer = maskedLayer(ref);
    removeMaskAndLeaveEdit(layer.id);
    return maskState(layer.id);
  },
});

export const maskSetEnabled = defineCommand({
  id: 'mask.set-enabled',
  summary:
    'Turns a layer\'s mask off (the whole layer shows) or back on ("Toggle Mask"; no history step when it is already in that state). The UI has no control for this. Returns the mask state.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    enabled: { type: 'boolean', description: 'true applies the mask, false ignores it while keeping it.' },
  },
  run({ layer: ref, enabled }): MaskState {
    const layer = maskedLayer(ref);
    if (layer.mask?.enabled !== enabled) store().toggleLayerMask(layer.id);
    return maskState(layer.id);
  },
});

export const maskEdit = defineCommand({
  id: 'mask.edit',
  summary:
    'Enters mask edit mode on a layer, as a click on its mask thumbnail does (the layer becomes active; paint, fill and filters then go to the mask), or leaves it, as a plain click on the layer\'s row does (the layer becomes the active and only selected layer). Either click first commits a pending Move float or multi-layer transform. No history step of its own. Returns the mask state.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    enabled: { type: 'boolean', description: 'true: edit the mask. false: edit the layer\'s pixels.' },
  },
  run({ layer: ref, enabled }): MaskState {
    if (!enabled) {
      requireDocument();
      const layer = resolveLayer(ref);
      selectReplace(layer.id);
      return maskState(layer.id);
    }
    const layer = maskedLayer(ref);
    enterMaskEdit(layer.id);
    return maskState(layer.id);
  },
});

export const maskToSelection = defineCommand({
  id: 'mask.to-selection',
  summary:
    'Replaces the selection with the area a layer\'s mask hides (255 minus the mask), and leaves mask edit mode, as the Convert mask to selection button on the mask row does (no history step). It first reads the mask back from the GPU when the editor\'s copy of it is behind (after a mask stroke, undo or redo), so the selection matches the mask as drawn. A mask that hides nothing leaves the selection as it was. Returns the selection bounds in document pixels, or null when there is no selection.',
  surface: 'document',
  params: { layer: layerRefSpec },
  async run({ layer: ref }): Promise<MaskSelectionResult> {
    const { id } = maskedLayer(ref);
    // convertMaskToMarquee reads layer.mask.data, which lags the GPU mask after a stroke, undo or redo.
    await materializeMaskData(id);
    const layer = maskedLayer(id);
    convertMaskToMarquee(layer.id);
    const { selection } = store();
    return {
      selection: selection.active && selection.bounds ? { ...selection.bounds } : null,
      editing: isEditing(layer.id),
    };
  },
});
