import { useUIStore, type TextEditingState } from './ui-store';
import { useEditorStore } from './editor-store';
import { insertInputText, processTextKey, type TextEditState } from '../tools/text/text-input';

export function toEditState(editing: TextEditingState): TextEditState {
  return {
    text: editing.text,
    cursorPos: editing.cursorPos,
    selectionAnchor: editing.selectionAnchor,
    preferredX: null,
  };
}

/** Make `next` the edited text, caret and selection, and redraw the live preview. */
export function applyEditState(next: TextEditState): void {
  useUIStore.getState().updateTextEditingSelection(next.text, next.cursorPos, next.selectionAnchor);
  useEditorStore.getState().notifyRender();
}

/**
 * Insert text that arrives outside a keydown (a paste, an input event from
 * the input sink) into the text being edited, replacing its selection.
 * Line breaks are '\n', as Enter types them. No-op when nothing is edited.
 */
export function insertIntoEditedText(raw: string): void {
  const editing = useUIStore.getState().textEditing;
  if (!editing) return;
  applyEditState(insertInputText(toEditState(editing), raw));
}

/** Cmd+A while text is edited: select the whole buffer. No-op when nothing is edited. */
export function selectAllEditedText(): void {
  const editing = useUIStore.getState().textEditing;
  if (!editing) return;
  const next = processTextKey(toEditState(editing), 'a', { meta: true, shift: false, alt: false });
  if (next) applyEditState(next);
}
