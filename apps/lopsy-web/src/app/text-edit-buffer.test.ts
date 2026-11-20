import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { insertIntoEditedText, selectAllEditedText } from './text-edit-buffer';

function edit(text: string, cursorPos: number, selectionAnchor: number | null = null): void {
  useUIStore.getState().startTextEditing({
    layerId: 'l1',
    bounds: { x: 0, y: 0, width: null, height: null },
    text,
    cursorPos,
    selectionAnchor,
    isNew: true,
    originalVisible: true,
  });
}

function buffer() {
  const editing = useUIStore.getState().textEditing;
  return editing && { text: editing.text, cursorPos: editing.cursorPos, selectionAnchor: editing.selectionAnchor };
}

describe('text-edit-buffer', () => {
  beforeEach(() => {
    useUIStore.setState({ textEditing: null });
  });

  it('inserts at the caret, replacing the selection, normalising line endings, and redraws', () => {
    const render = vi.spyOn(useEditorStore.getState(), 'notifyRender');
    edit('Hello world', 6, 11);
    insertIntoEditedText('there\r\nfriend');
    expect(buffer()).toEqual({ text: 'Hello there\nfriend', cursorPos: 18, selectionAnchor: null });
    expect(render).toHaveBeenCalled();
  });

  it('selects the whole buffer as Cmd+A does', () => {
    edit('Hello', 2);
    selectAllEditedText();
    expect(buffer()).toEqual({ text: 'Hello', cursorPos: 5, selectionAnchor: 0 });
  });

  it('does nothing when no text is being edited', () => {
    insertIntoEditedText('x');
    selectAllEditedText();
    expect(buffer()).toBeNull();
  });
});
