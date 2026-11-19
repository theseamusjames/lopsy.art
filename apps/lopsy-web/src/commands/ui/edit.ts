import { defineCommand } from '../registry';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { fillSelection } from '../../app/fill-selection';
import { defineBrush } from '../../app/MenuBar/brush-actions';

export const uiEditUndo = defineCommand({
  id: 'ui.edit.undo',
  summary:
    'Edit > Undo exactly as the menu runs it: it first finalizes a pending stroke and drops a live Move float even when there is nothing to undo, and is never refused. Agents should use history.undo, which refuses an empty history. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    useEditorStore.getState().undo();
  },
});

export const uiEditRedo = defineCommand({
  id: 'ui.edit.redo',
  summary:
    'Edit > Redo exactly as the menu runs it: it drops a live Move float even when there is nothing to redo, and is never refused. Agents should use history.redo, which refuses an empty redo stack. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    useEditorStore.getState().redo();
  },
});

export const uiEditFill = defineCommand({
  id: 'ui.edit.fill',
  summary:
    'Edit > Fill exactly as the menu runs it: the selection (or the active layer) with the foreground colour ("Fill"), or the mask in mask edit mode ("Mask Fill"); a text or group layer is refused with a toast, a locked one silently. Agents should use paint.fill, which reports what it filled. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    fillSelection();
  },
});

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

export const uiEditClearGuides = defineCommand({
  id: 'ui.edit.clear-guides',
  summary:
    'Edit > Clear Guides exactly as the menu runs it: removes every ruler guide and deselects any guide, even when there are none. Agents should use guide.clear. Returns nothing.',
  surface: 'ui',
  params: {},
  run(): void {
    useUIStore.getState().clearGuides();
  },
});
