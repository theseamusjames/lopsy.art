import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument, requireEngine } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { addBrushPreset, readSelectionBrushTip } from '../../app/MenuBar/brush-actions';
import { EMPTY_COLOR_TIP_MESSAGE, EMPTY_TIP_MESSAGE } from '../../tools/brush/brush-from-selection';
import type { BrushTipData } from '../../types/brush';

export interface BrushPresetResult {
  id: string;
  name: string;
}

export const brushDefine = defineCommand({
  id: 'brush.define',
  summary:
    'Makes a custom brush preset from the active layer\'s pixels inside the selection and makes it the active preset, as Edit > Define Brush... does once its name prompt is answered (no history step): dark pixels paint, or with color true, as Define Color Brush... does, the pixels\' own colours. Refused without a selection (the menu items are disabled then) and when the brush would be empty, with the text the menu toasts. Returns the preset\'s id and name.',
  surface: 'document',
  params: {
    name: { type: 'string', minLength: 1, description: 'The preset\'s name: what the menu asks for in its "Brush name:" prompt.' },
    color: { type: 'boolean', default: false, description: 'false: Define Brush... (a greyscale tip). true: Define Color Brush... (a colour tip).' },
  },
  run({ name, color }): Promise<BrushPresetResult> {
    const doc = requireDocument();
    if (!doc.layers.some((l) => l.id === doc.activeLayerId)) {
      throw new CommandError('refused', 'There is no active layer to define a brush from.');
    }
    if (!useEditorStore.getState().selection.active) {
      throw new CommandError('refused', 'Nothing is selected: Define Brush needs a selection around the brush tip.');
    }
    requireEngine();
    return readSelectionBrushTip(color).then((tip: BrushTipData | null) => {
      // readSelectionBrushTip has already toasted an empty tip.
      if (!tip) throw new CommandError('refused', color ? EMPTY_COLOR_TIP_MESSAGE : EMPTY_TIP_MESSAGE);
      const preset = addBrushPreset(tip, name);
      return { id: preset.id, name: preset.name };
    });
  },
});
