import type { SelectionModifyKind } from '../../selection-actions';
import { commandItem } from './command-item';
import type { MenuDef } from './types';

export type SelectDialogId = SelectionModifyKind;

export function createSelectMenu(): MenuDef {
  return {
    label: 'Select',
    items: [
      commandItem('All', 'select.all', undefined, '⌘A'),
      // select.none with its default commit: false is clearSelection() alone (Cmd+D also commits).
      commandItem('Deselect', 'select.none', undefined, '⌘D'),
      commandItem('Inverse', 'ui.select.inverse', undefined, '⇧⌘I'),
      { separator: true, label: '' },
      commandItem('Grow…', 'ui.dialog.select', { dialog: 'grow' }),
      commandItem('Shrink…', 'ui.dialog.select', { dialog: 'shrink' }),
      commandItem('Feather…', 'ui.dialog.select', { dialog: 'feather' }),
      { separator: true, label: '' },
      commandItem('Selection → Path', 'select.to-path'),
    ],
  };
}
