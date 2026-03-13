import { useEditorStore } from '../../editor-store';
import { createRectSelection, invertSelection } from '../../../selection/selection';
import type { MenuDef } from './types';

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

export const selectMenu: MenuDef = {
  label: 'Select',
  items: [
    { label: 'All', shortcut: '\u2318A', action: () => selectAll() },
    { label: 'Deselect', shortcut: '\u2318D', action: () => useEditorStore.getState().clearSelection() },
    { label: 'Inverse', shortcut: '\u21E7\u2318I', action: () => invertSelectionAction() },
  ],
};
