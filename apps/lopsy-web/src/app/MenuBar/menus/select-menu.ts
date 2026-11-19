import { useEditorStore } from '../../editor-store';
import { invertSelectionAction, selectAll, selectionToPathAction, type SelectionModifyKind } from '../../selection-actions';
import type { MenuDef } from './types';

export type SelectDialogId = SelectionModifyKind;

export function createSelectMenu(showDialog: (id: SelectDialogId) => void): MenuDef {
  return {
    label: 'Select',
    items: [
      { label: 'All', shortcut: '⌘A', action: () => selectAll() },
      { label: 'Deselect', shortcut: '⌘D', action: () => useEditorStore.getState().clearSelection() },
      { label: 'Inverse', shortcut: '⇧⌘I', action: () => invertSelectionAction() },
      { separator: true, label: '' },
      { label: 'Grow…', action: () => showDialog('grow') },
      { label: 'Shrink…', action: () => showDialog('shrink') },
      { label: 'Feather…', action: () => showDialog('feather') },
      { separator: true, label: '' },
      {
        label: 'Selection → Path',
        action: () => selectionToPathAction(),
        disabled: !useEditorStore.getState().selection.active,
      },
    ],
  };
}
