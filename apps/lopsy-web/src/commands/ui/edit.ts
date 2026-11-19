import { defineCommand } from '../registry';
import { useEditorStore } from '../../app/editor-store';
import { defineBrush } from '../../app/MenuBar/brush-actions';

export const uiEditDefineBrush = defineCommand({
  id: 'ui.edit.define-brush',
  summary:
    'Edit > Define Brush... (or Define Color Brush... with color true): reads the selection as a brush tip, asks for its name in a browser prompt and adds it as the active preset. Disabled with nothing selected. Agents should use brush.define, which takes the name. Returns nothing.',
  surface: 'ui',
  settles: false,
  params: {
    color: { type: 'boolean', default: false, description: 'false: Define Brush... (a greyscale tip). true: Define Color Brush... (a colour tip).' },
  },
  enabled(): boolean {
    return useEditorStore.getState().selection.active;
  },
  run({ color }): Promise<void> {
    return defineBrush(color);
  },
});
