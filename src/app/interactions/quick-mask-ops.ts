/**
 * Quick Mask Mode operations — enter/exit logic.
 *
 * Entering: converts the active selection mask (if any) into an editable
 * quick mask buffer. If no selection, starts with a fully-unselected mask.
 *
 * Exiting: converts the quick mask buffer back to a selection and applies it.
 */

import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import {
  createQuickMaskFromSelection,
  quickMaskToSelectionMask,
  setQuickMaskBuffer,
  clearQuickMaskBuffer,
  getQuickMaskBuffer,
} from './quick-mask-buffer';
import { selectionBounds } from '../../selection/selection';

export function enterQuickMaskMode(): void {
  const editorState = useEditorStore.getState();
  const doc = editorState.document;
  const sel = editorState.selection;

  const existingMask = sel.active && sel.mask ? sel.mask : null;
  const buf = createQuickMaskFromSelection(existingMask, doc.width, doc.height);
  setQuickMaskBuffer(buf);

  useUIStore.getState().toggleQuickMaskMode();
  editorState.notifyRender();
}

export function exitQuickMaskMode(): void {
  const buf = getQuickMaskBuffer();
  const editorState = useEditorStore.getState();
  const doc = editorState.document;

  if (buf) {
    const selectionMask = quickMaskToSelectionMask(buf);
    const bounds = selectionBounds(selectionMask, doc.width, doc.height);
    if (bounds) {
      editorState.setSelection(bounds, selectionMask, doc.width, doc.height);
    } else {
      editorState.clearSelection();
    }
    clearQuickMaskBuffer();
  }

  useUIStore.getState().toggleQuickMaskMode();
  editorState.notifyRender();
}

export function toggleQuickMaskMode(): void {
  const isActive = useUIStore.getState().isQuickMaskMode;
  if (isActive) {
    exitQuickMaskMode();
  } else {
    enterQuickMaskMode();
  }
}
