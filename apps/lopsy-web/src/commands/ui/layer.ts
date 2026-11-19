import { defineCommand } from '../registry';
import { useEditorStore } from '../../app/editor-store';
import { openAdjustmentLayer } from '../../app/MenuBar/layer-menu-actions';

export const uiLayerNew = defineCommand({
  id: 'ui.layer.new',
  summary:
    'Layer > New Layer exactly as the menu runs it: a pending stroke is finalized, then an empty layer is added above the active one ("Add Layer"), or a toast says why not in an Indexed document. Agents should use layer.add, which returns the new id. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    useEditorStore.getState().addLayer();
  },
});

export const uiLayerDuplicate = defineCommand({
  id: 'ui.layer.duplicate',
  summary:
    'Layer > Duplicate Layer exactly as the menu runs it: duplicates the active layer ("Duplicate Layer") with no root-group check, so with the root group active it duplicates the whole project. Never disabled. Agents should use layer.duplicate, which refuses the root group as the Layers panel button does. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    useEditorStore.getState().duplicateLayer();
  },
});

export const uiLayerAdjustmentLayer = defineCommand({
  id: 'ui.layer.adjustment-layer',
  summary:
    'Layer > Adjustment Layer…: activates the root group without committing a pending Move float, opens the effects drawer and shows the note on where adjustments live. Agents should use adjust.add. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    openAdjustmentLayer();
  },
});
