import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { selectAll, invertSelectionAction } from '../MenuBar/menus/select-menu';
import { scheduleFallbackPaste } from '../useKeyboardShortcuts';

export function handleEditShortcut(
  e: KeyboardEvent,
  clearPersistentTransform: () => void,
): boolean {
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (e.shiftKey) {
      useEditorStore.getState().copyMerged();
    } else {
      useEditorStore.getState().copy();
    }
    return true;
  }
  if (e.key === 'x') {
    e.preventDefault();
    useEditorStore.getState().cut();
    return true;
  }
  if (e.key === 'v') {
    // Don't preventDefault — let the browser fire the 'paste' event so
    // clipboardData.files is populated for file pastes from Finder/Explorer.
    // The paste event handler in useKeyboardShortcuts handles all paste logic.
    //
    // Schedule a fallback internal paste in case the paste event doesn't fire
    // (Firefox may not fire paste on non-editable elements like canvas).
    // The paste handler cancels this timer if it runs.
    scheduleFallbackPaste();
    return true;
  }
  if (e.key === 'e') {
    e.preventDefault();
    useEditorStore.getState().mergeDown();
    return true;
  }
  if (e.key === 'a') {
    e.preventDefault();
    selectAll();
    return true;
  }
  if ((e.key === 'i' || e.key === 'I') && e.shiftKey) {
    e.preventDefault();
    invertSelectionAction();
    return true;
  }
  if (e.key === 'd') {
    e.preventDefault();
    useEditorStore.getState().clearSelection();
    useUIStore.getState().setTransform(null);
    clearPersistentTransform();
    return true;
  }
  if (e.key === "'") {
    e.preventDefault();
    useUIStore.getState().toggleGrid();
    return true;
  }
  if (e.key === ';') {
    e.preventDefault();
    useUIStore.getState().toggleGuides();
    return true;
  }
  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault();
    if (e.shiftKey) {
      useEditorStore.getState().redo();
    } else {
      useEditorStore.getState().undo();
    }
    return true;
  }
  return false;
}
