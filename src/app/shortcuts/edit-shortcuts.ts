import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { selectAll, invertSelectionAction } from '../MenuBar/menus/select-menu';
import { applyAutoTone, applyAutoContrast, applyAutoColor } from '../MenuBar/menus/image-menu';
import { openLiquify } from '../MenuBar/liquify-actions';
import { scheduleFallbackPaste } from '../useKeyboardShortcuts';

export function handleEditShortcut(
  e: KeyboardEvent,
  clearPersistentTransform: () => void,
): boolean {
  // Cmd+Shift+X — open Liquify
  if ((e.key === 'x' || e.key === 'X') && e.shiftKey) {
    e.preventDefault();
    openLiquify();
    return true;
  }
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
  // Shift+Cmd+L — Auto Tone
  if ((e.key === 'l' || e.key === 'L') && e.shiftKey && !e.altKey) {
    e.preventDefault();
    applyAutoTone();
    return true;
  }
  // Alt+Shift+Cmd+L — Auto Contrast
  if ((e.key === 'l' || e.key === 'L') && e.shiftKey && e.altKey) {
    e.preventDefault();
    applyAutoContrast();
    return true;
  }
  // Shift+Cmd+B — Auto Color
  if ((e.key === 'b' || e.key === 'B') && e.shiftKey) {
    e.preventDefault();
    applyAutoColor();
    return true;
  }
  return false;
}
