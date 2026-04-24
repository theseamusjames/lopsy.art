import { useEditorStore } from '../../editor-store';
import { createRectSelection, invertSelection } from '../../../selection/selection';
import type { MenuDef } from './types';

export type SelectDialogId = 'grow' | 'shrink';

export function selectAll(): void {
  const state = useEditorStore.getState();
  const { width, height } = state.document;
  const rect = { x: 0, y: 0, width, height };
  const mask = createRectSelection(rect, width, height);
  state.setSelection(rect, mask, width, height);
}

export function invertSelectionAction(): void {
  const state = useEditorStore.getState();
  const sel = state.selection;
  if (!sel.active || !sel.mask) return;
  const inverted = invertSelection(sel.mask);
  const { width, height } = state.document;
  state.setSelection({ x: 0, y: 0, width, height }, inverted, sel.maskWidth, sel.maskHeight);
}

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
    ],
  };
}
