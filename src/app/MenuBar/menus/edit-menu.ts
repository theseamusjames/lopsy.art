import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { useToolSettingsStore } from '../../tool-settings-store';
import { clearJsPixelData } from '../../store/clear-js-pixel-data';
import { getEngine } from '../../../engine-wasm/engine-state';
import { fillWithColor } from '../../../engine-wasm/wasm-bridge';
import { definePattern } from '../pattern-actions';
import type { FilterDialogId } from '../filter-actions';
import type { MenuDef } from './types';

export function fillSelection(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  state.pushHistory();
  const color = useToolSettingsStore.getState().foregroundColor;

  // GPU fill: uses the engine's selection mask if active
  fillWithColor(engine, activeId, color.r / 255, color.g / 255, color.b / 255, color.a);

  clearJsPixelData(activeId);
  state.notifyRender();
}

export function cropToSelection(): void {
  const { selection } = useEditorStore.getState();
  if (!selection.active || !selection.bounds) return;
  useEditorStore.getState().cropCanvas(selection.bounds);
}

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
      { label: 'Copy Merged', shortcut: '⇧⌘C', action: () => useEditorStore.getState().copyMerged() },
      { label: 'Paste', shortcut: '⌘V', action: () => useEditorStore.getState().paste() },
      { separator: true, label: '' },
      { label: 'Fill', shortcut: '⇧F5', action: () => fillSelection() },
      { label: 'Fill with Pattern...', action: () => showFilterDialog('pattern-fill') },
      { separator: true, label: '' },
      { label: 'Crop', action: () => cropToSelection(), disabled: !hasSelection },
      { separator: true, label: '' },
      { label: 'Define Pattern', action: () => definePattern() },
      { separator: true, label: '' },
      { label: 'Clear Guides', action: () => useUIStore.getState().clearGuides() },
    ],
  };
}
