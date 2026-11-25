import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument, requireEngine } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { clearSelectedLayerPixels } from '../../app/delete-key';

export const paintClear = defineCommand({
  id: 'paint.clear',
  summary:
    'Clears the active layer\'s pixels inside the selection to transparent, as the Delete key does with a selection ("Clear Selection"): a pending Move float or transform is committed first, and the selection and the clipboard are kept. Like the key, it checks neither the layer lock nor the layer type, so it clears a locked layer too. Refused with no selection (the key would delete the layer: that is layer.remove) and in mask edit mode (the key clears the mask: that is mask.clear). Returns the layer id.',
  surface: 'document',
  params: {},
  run(): { layer: string } {
    const doc = requireDocument();
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    if (!layer) throw new CommandError('refused', 'There is no active layer to clear.');
    if (useUIStore.getState().maskMode === 'layerMask' && layer.mask) {
      throw new CommandError(
        'refused',
        `"${layer.name}" is in mask edit mode, where the Delete key clears the mask: use mask.clear, or mask.edit with enabled false to clear its pixels.`,
      );
    }
    const { selection } = useEditorStore.getState();
    if (!selection.active || !selection.mask) {
      throw new CommandError(
        'refused',
        'Nothing is selected: paint.clear clears the selected pixels. (The Delete key with no selection removes the layer: that is layer.remove.)',
      );
    }
    requireEngine();
    if (!clearSelectedLayerPixels(layer.id, selection.mask)) {
      throw new CommandError('refused', 'The selection was dropped while the pending move was committed, so nothing was cleared.');
    }
    return { layer: layer.id };
  },
});
