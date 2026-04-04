import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './ui-store';
import type { TextEditingState } from './ui-store';

function makeEditingState(overrides?: Partial<TextEditingState>): TextEditingState {
  return {
    layerId: 'layer-1',
    bounds: { x: 100, y: 200, width: null, height: null },
    text: '',
    cursorPos: 0,
    isNew: true,
    originalVisible: true,
    ...overrides,
  };
}

describe('ui-store text editing', () => {
  beforeEach(() => {
    useUIStore.setState({ textEditing: null, textDrag: null });
  });

  it('starts with null textEditing', () => {
    expect(useUIStore.getState().textEditing).toBeNull();
  });

  it('startTextEditing sets state', () => {
    const state = makeEditingState();
    useUIStore.getState().startTextEditing(state);
    expect(useUIStore.getState().textEditing).toEqual(state);
  });

  it('updateTextEditingText updates text and cursor', () => {
    useUIStore.getState().startTextEditing(makeEditingState());
    useUIStore.getState().updateTextEditingText('Hello', 5);
    const editing = useUIStore.getState().textEditing!;
    expect(editing.text).toBe('Hello');
    expect(editing.cursorPos).toBe(5);
  });

  it('updateTextEditingText is a no-op when not editing', () => {
    useUIStore.getState().updateTextEditingText('Hello', 5);
    expect(useUIStore.getState().textEditing).toBeNull();
  });

  it('updateTextEditingBounds updates bounds', () => {
    useUIStore.getState().startTextEditing(makeEditingState());
    useUIStore.getState().updateTextEditingBounds({ x: 50, y: 60, width: 300, height: 200 });
    const editing = useUIStore.getState().textEditing!;
    expect(editing.bounds).toEqual({ x: 50, y: 60, width: 300, height: 200 });
  });

  it('commitTextEditing clears state', () => {
    useUIStore.getState().startTextEditing(makeEditingState());
    useUIStore.getState().commitTextEditing();
    expect(useUIStore.getState().textEditing).toBeNull();
  });

  it('cancelTextEditing clears state', () => {
    useUIStore.getState().startTextEditing(makeEditingState());
    useUIStore.getState().cancelTextEditing();
    expect(useUIStore.getState().textEditing).toBeNull();
  });

  it('setTextDrag sets and clears drag state', () => {
    useUIStore.getState().setTextDrag({ startX: 10, startY: 20, currentX: 100, currentY: 120 });
    expect(useUIStore.getState().textDrag).toEqual({ startX: 10, startY: 20, currentX: 100, currentY: 120 });
    useUIStore.getState().setTextDrag(null);
    expect(useUIStore.getState().textDrag).toBeNull();
  });

  it('preserves other editing fields when updating text', () => {
    const state = makeEditingState({ layerId: 'my-layer', bounds: { x: 10, y: 20, width: 300, height: null } });
    useUIStore.getState().startTextEditing(state);
    useUIStore.getState().updateTextEditingText('New text', 8);
    const editing = useUIStore.getState().textEditing!;
    expect(editing.layerId).toBe('my-layer');
    expect(editing.bounds.x).toBe(10);
    expect(editing.isNew).toBe(true);
  });
});
