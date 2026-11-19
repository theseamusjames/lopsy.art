import { scheduleFallbackPaste } from '../useKeyboardShortcuts';
import { runKeyCommand } from './key-bindings';

export function handleEditShortcut(e: KeyboardEvent): boolean {
  // Cmd+Shift+X — open Liquify
  if ((e.key === 'x' || e.key === 'X') && e.shiftKey) {
    e.preventDefault();
    runKeyCommand('liquify');
    return true;
  }
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (e.shiftKey) {
      runKeyCommand('copyMerged');
    } else {
      runKeyCommand('copy');
    }
    return true;
  }
  if (e.key === 'x') {
    e.preventDefault();
    runKeyCommand('cut');
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
    runKeyCommand('mergeDown');
    return true;
  }
  if (e.key === 'a') {
    e.preventDefault();
    runKeyCommand('selectAll');
    return true;
  }
  if ((e.key === 'i' || e.key === 'I') && e.shiftKey) {
    e.preventDefault();
    runKeyCommand('invertSelection');
    return true;
  }
  if (e.key === 'd') {
    e.preventDefault();
    runKeyCommand('deselect');
    return true;
  }
  if (e.key === "'") {
    e.preventDefault();
    runKeyCommand('toggleGrid');
    return true;
  }
  if (e.key === ';') {
    e.preventDefault();
    runKeyCommand('toggleGuides');
    return true;
  }
  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault();
    // Keyboard undo/redo applies synchronously: callers read state back on
    // the same tick, and invokeFromUi starts the command in this one.
    // undoBy/redoBy still batch the History-panel jump (#761).
    if (e.shiftKey) runKeyCommand('redo');
    else runKeyCommand('undo');
    return true;
  }
  // Shift+Cmd+L — Auto Tone
  if ((e.key === 'l' || e.key === 'L') && e.shiftKey && !e.altKey) {
    e.preventDefault();
    runKeyCommand('autoTone');
    return true;
  }
  // Alt+Shift+Cmd+L — Auto Contrast
  if ((e.key === 'l' || e.key === 'L') && e.shiftKey && e.altKey) {
    e.preventDefault();
    runKeyCommand('autoContrast');
    return true;
  }
  // Shift+Cmd+B — Auto Color
  if ((e.key === 'b' || e.key === 'B') && e.shiftKey) {
    e.preventDefault();
    runKeyCommand('autoColor');
    return true;
  }
  return false;
}
