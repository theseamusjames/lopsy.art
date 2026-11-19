import { commandItem } from './command-item';
import type { MenuDef } from './types';

export function createEditMenu(): MenuDef {
  return {
    label: 'Edit',
    items: [
      commandItem('Undo', 'ui.edit.undo', undefined, '⌘Z'),
      commandItem('Redo', 'ui.edit.redo', undefined, '⇧⌘Z'),
      { separator: true, label: '' },
      commandItem('Cut', 'clipboard.cut', undefined, '⌘X'),
      commandItem('Copy', 'clipboard.copy', undefined, '⌘C'),
      commandItem('Copy Merged', 'clipboard.copy-merged', undefined, '⇧⌘C'),
      commandItem('Paste', 'clipboard.paste', undefined, '⌘V'),
      { separator: true, label: '' },
      commandItem('Fill', 'ui.edit.fill', undefined, '⇧F5'),
      commandItem('Fill with Pattern...', 'ui.dialog.filter', { dialog: 'pattern-fill' }),
      { separator: true, label: '' },
      commandItem('Crop', 'image.crop-to-selection'),
      { separator: true, label: '' },
      commandItem('Define Pattern', 'pattern.define'),
      commandItem('Define Brush...', 'ui.edit.define-brush', { color: false }),
      commandItem('Define Color Brush...', 'ui.edit.define-brush', { color: true }),
      { separator: true, label: '' },
      commandItem('Clear Guides', 'ui.edit.clear-guides'),
    ],
  };
}
