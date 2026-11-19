import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { enterMaskEdit, layerRefSpec, requireDocument, requireEngine, resolveLayer } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { clearActiveLayerMask } from '../../app/delete-key';

export const maskClear = defineCommand({
  id: 'mask.clear',
  summary:
    'Fills a layer\'s mask with the background colour\'s grey value (white by default, which reveals) inside the selection, or everywhere with none, as the Delete key does in mask edit mode ("Mask Clear"). A layer whose mask is not being edited is first put in mask edit mode, as a click on its mask thumbnail does. Like the key, it does not check the layer lock. paint.fill fills the mask with the foreground colour instead. Returns the layer id.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): { layer: string } {
    requireDocument();
    const layer = resolveLayer(ref);
    if (!layer.mask) throw new CommandError('refused', `"${layer.name}" has no mask.`);
    requireEngine();
    const isEditing = useUIStore.getState().maskMode === 'layerMask' && useEditorStore.getState().document.activeLayerId === layer.id;
    if (!isEditing) enterMaskEdit(layer.id);
    if (!clearActiveLayerMask()) throw new Error('mask.clear: the mask was not cleared');
    return { layer: layer.id };
  },
});
