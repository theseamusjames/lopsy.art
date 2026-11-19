import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { fillSelection } from '../../fill-selection';
import { pasteInternalClipboard } from '../../paste-or-open';
import { cropToSelection } from '../../crop-to-selection';
import { definePattern } from '../pattern-actions';
import { defineBrush } from '../brush-actions';
import type { FilterDialogId } from '../filter-actions';
import type { MenuDef } from './types';

export function createEditMenu(showFilterDialog: (id: FilterDialogId) => void): MenuDef {
  const hasSelection = useEditorStore.getState().selection.active;
  return {
    label: 'Edit',
    items: [
      { label: 'Undo', shortcut: '⌘Z', action: () => useEditorStore.getState().undo() },
      { label: 'Redo', shortcut: '⇧⌘Z', action: () => useEditorStore.getState().redo() },
      { separator: true, label: '' },
      { label: 'Cut', shortcut: '⌘X', action: () => useEditorStore.getState().cut() },
      { label: 'Copy', shortcut: '⌘C', action: () => useEditorStore.getState().copy() },
      { label: 'Copy Merged', shortcut: '⇧⌘C', action: () => void useEditorStore.getState().copyMerged() },
      { label: 'Paste', shortcut: '⌘V', action: () => pasteInternalClipboard() },
      { separator: true, label: '' },
      { label: 'Fill', shortcut: '⇧F5', action: () => fillSelection() },
      { label: 'Fill with Pattern...', action: () => showFilterDialog('pattern-fill') },
      { separator: true, label: '' },
      { label: 'Crop', action: () => cropToSelection(), disabled: !hasSelection },
      { separator: true, label: '' },
      { label: 'Define Pattern', action: () => definePattern() },
      { label: 'Define Brush...', action: () => defineBrush(false), disabled: !hasSelection },
      { label: 'Define Color Brush...', action: () => defineBrush(true), disabled: !hasSelection },
      { separator: true, label: '' },
      { label: 'Clear Guides', action: () => useUIStore.getState().clearGuides() },
    ],
  };
}
