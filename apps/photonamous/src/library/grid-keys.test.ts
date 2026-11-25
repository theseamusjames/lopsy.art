import { describe, expect, it } from 'vitest';
import { gridKeyAction, rowsPerPage, type GridKeyInput, type GridPosition } from './grid-keys';

function key(k: string, mods: Partial<Omit<GridKeyInput, 'key'>> = {}): GridKeyInput {
  return { key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods };
}

/** 23 photos in rows of 5, the 13th (index 12) focused, three rows to a page. */
const at: GridPosition = { index: 12, count: 23, columns: 5, pageRows: 3 };

describe('gridKeyAction', () => {
  it('leaves plain arrows and Shift+Left/Right to the shortcut registry', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) expect(gridKeyAction(key(k), at)).toBeNull();
    expect(gridKeyAction(key('ArrowLeft', { shiftKey: true }), at)).toBeNull();
    expect(gridKeyAction(key('ArrowRight', { shiftKey: true }), at)).toBeNull();
    expect(gridKeyAction(key('Enter'), at)).toBeNull();
    expect(gridKeyAction(key(' '), at)).toBeNull();
    expect(gridKeyAction(key('a', { ctrlKey: true }), at)).toBeNull();
  });

  it('goes to the first and last photo with Home and End', () => {
    expect(gridKeyAction(key('Home'), at)).toEqual({ kind: 'focus', index: 0, how: 'select' });
    expect(gridKeyAction(key('End'), at)).toEqual({ kind: 'focus', index: 22, how: 'select' });
    expect(gridKeyAction(key('End', { shiftKey: true }), at)).toEqual({ kind: 'focus', index: 22, how: 'extend' });
    expect(gridKeyAction(key('Home', { metaKey: true }), at)).toEqual({ kind: 'focus', index: 0, how: 'keep' });
  });

  it('moves a page of rows with Page Up and Page Down, stopping at the ends', () => {
    expect(gridKeyAction(key('PageUp'), at)).toEqual({ kind: 'focus', index: 0, how: 'select' });
    expect(gridKeyAction(key('PageDown'), { ...at, index: 2 })).toEqual({ kind: 'focus', index: 17, how: 'select' });
    expect(gridKeyAction(key('PageDown'), at)).toEqual({ kind: 'focus', index: 22, how: 'select' });
  });

  it('grows the selection a row at a time with Shift+Up and Shift+Down', () => {
    expect(gridKeyAction(key('ArrowUp', { shiftKey: true }), at)).toEqual({ kind: 'focus', index: 7, how: 'extend' });
    expect(gridKeyAction(key('ArrowDown', { shiftKey: true }), at)).toEqual({ kind: 'focus', index: 17, how: 'extend' });
    // The last row is short: down from its column lands on the last photo.
    expect(gridKeyAction(key('ArrowDown', { shiftKey: true }), { ...at, index: 19 })).toEqual({ kind: 'focus', index: 22, how: 'extend' });
  });

  it('moves focus without selecting with Ctrl or Cmd and an arrow', () => {
    expect(gridKeyAction(key('ArrowRight', { ctrlKey: true }), at)).toEqual({ kind: 'focus', index: 13, how: 'keep' });
    expect(gridKeyAction(key('ArrowLeft', { metaKey: true }), at)).toEqual({ kind: 'focus', index: 11, how: 'keep' });
    expect(gridKeyAction(key('ArrowUp', { ctrlKey: true }), at)).toEqual({ kind: 'focus', index: 7, how: 'keep' });
    expect(gridKeyAction(key('ArrowDown', { ctrlKey: true, shiftKey: true }), at)).toEqual({ kind: 'focus', index: 17, how: 'extend' });
  });

  it('toggles the focused photo with Ctrl/Cmd+Space', () => {
    expect(gridKeyAction(key(' ', { ctrlKey: true }), at)).toEqual({ kind: 'toggle' });
    expect(gridKeyAction(key(' ', { metaKey: true }), at)).toEqual({ kind: 'toggle' });
    expect(gridKeyAction(key(' ', { ctrlKey: true }), { ...at, index: -1 })).toBeNull();
  });

  it('opens the context menu with Shift+F10 or the Menu key', () => {
    expect(gridKeyAction(key('F10', { shiftKey: true }), at)).toEqual({ kind: 'menu' });
    expect(gridKeyAction(key('ContextMenu'), at)).toEqual({ kind: 'menu' });
    expect(gridKeyAction(key('F10'), at)).toBeNull();
    expect(gridKeyAction(key('ContextMenu'), { ...at, index: -1 })).toBeNull();
  });

  it('starts from the first photo going forward and the last going back when nothing is focused', () => {
    const none = { ...at, index: -1 };
    expect(gridKeyAction(key('PageDown'), none)).toEqual({ kind: 'focus', index: 0, how: 'select' });
    expect(gridKeyAction(key('PageUp'), none)).toEqual({ kind: 'focus', index: 22, how: 'select' });
    expect(gridKeyAction(key('ArrowDown', { shiftKey: true }), none)).toEqual({ kind: 'focus', index: 0, how: 'extend' });
  });

  it('does nothing in an empty grid or with Alt held', () => {
    expect(gridKeyAction(key('Home'), { ...at, count: 0, index: -1 })).toBeNull();
    expect(gridKeyAction(key('Home', { altKey: true }), at)).toBeNull();
  });
});

describe('rowsPerPage', () => {
  it('counts whole rows, at least one', () => {
    expect(rowsPerPage(600, 186)).toBe(3);
    expect(rowsPerPage(100, 186)).toBe(1);
    expect(rowsPerPage(600, 0)).toBe(1);
  });
});
