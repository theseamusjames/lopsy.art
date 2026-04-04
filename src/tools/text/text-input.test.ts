import { describe, it, expect } from 'vitest';
import {
  insertCharacter,
  deleteBackward,
  deleteForward,
  moveCursorLeft,
  moveCursorRight,
  moveCursorHome,
  moveCursorEnd,
  insertNewline,
  processTextKey,
} from './text-input';
import type { TextEditState } from './text-input';

describe('insertCharacter', () => {
  it('inserts at the start', () => {
    const result = insertCharacter({ text: 'ello', cursorPos: 0 }, 'H');
    expect(result).toEqual({ text: 'Hello', cursorPos: 1 });
  });

  it('inserts at the end', () => {
    const result = insertCharacter({ text: 'Hell', cursorPos: 4 }, 'o');
    expect(result).toEqual({ text: 'Hello', cursorPos: 5 });
  });

  it('inserts in the middle', () => {
    const result = insertCharacter({ text: 'Hllo', cursorPos: 1 }, 'e');
    expect(result).toEqual({ text: 'Hello', cursorPos: 2 });
  });

  it('inserts into empty string', () => {
    const result = insertCharacter({ text: '', cursorPos: 0 }, 'A');
    expect(result).toEqual({ text: 'A', cursorPos: 1 });
  });
});

describe('deleteBackward', () => {
  it('deletes character before cursor', () => {
    const result = deleteBackward({ text: 'Hello', cursorPos: 5 });
    expect(result).toEqual({ text: 'Hell', cursorPos: 4 });
  });

  it('does nothing at start', () => {
    const state: TextEditState = { text: 'Hello', cursorPos: 0 };
    expect(deleteBackward(state)).toBe(state);
  });

  it('deletes in the middle', () => {
    const result = deleteBackward({ text: 'Hello', cursorPos: 3 });
    expect(result).toEqual({ text: 'Helo', cursorPos: 2 });
  });
});

describe('deleteForward', () => {
  it('deletes character after cursor', () => {
    const result = deleteForward({ text: 'Hello', cursorPos: 0 });
    expect(result).toEqual({ text: 'ello', cursorPos: 0 });
  });

  it('does nothing at end', () => {
    const state: TextEditState = { text: 'Hello', cursorPos: 5 };
    expect(deleteForward(state)).toBe(state);
  });
});

describe('moveCursorLeft', () => {
  it('moves cursor left', () => {
    expect(moveCursorLeft({ text: 'Hi', cursorPos: 2 })).toEqual({ text: 'Hi', cursorPos: 1 });
  });

  it('stops at 0', () => {
    expect(moveCursorLeft({ text: 'Hi', cursorPos: 0 }).cursorPos).toBe(0);
  });
});

describe('moveCursorRight', () => {
  it('moves cursor right', () => {
    expect(moveCursorRight({ text: 'Hi', cursorPos: 0 })).toEqual({ text: 'Hi', cursorPos: 1 });
  });

  it('stops at text length', () => {
    expect(moveCursorRight({ text: 'Hi', cursorPos: 2 }).cursorPos).toBe(2);
  });
});

describe('moveCursorHome', () => {
  it('moves to line start for single line', () => {
    expect(moveCursorHome({ text: 'Hello', cursorPos: 3 }).cursorPos).toBe(0);
  });

  it('moves to current line start for multi-line', () => {
    const text = 'Line 1\nLine 2';
    // Cursor in "Line 2" at position 10 (L of "Line 2" is at 7)
    expect(moveCursorHome({ text, cursorPos: 10 }).cursorPos).toBe(7);
  });
});

describe('moveCursorEnd', () => {
  it('moves to line end for single line', () => {
    expect(moveCursorEnd({ text: 'Hello', cursorPos: 2 }).cursorPos).toBe(5);
  });

  it('moves to current line end for multi-line', () => {
    const text = 'Line 1\nLine 2';
    // Cursor in "Line 1" at position 2
    expect(moveCursorEnd({ text, cursorPos: 2 }).cursorPos).toBe(6);
  });
});

describe('insertNewline', () => {
  it('inserts newline at cursor', () => {
    const result = insertNewline({ text: 'AB', cursorPos: 1 });
    expect(result).toEqual({ text: 'A\nB', cursorPos: 2 });
  });
});

describe('processTextKey', () => {
  const state: TextEditState = { text: 'Hello', cursorPos: 5 };

  it('handles printable characters', () => {
    const result = processTextKey(state, '!', false);
    expect(result).toEqual({ text: 'Hello!', cursorPos: 6 });
  });

  it('handles Backspace', () => {
    const result = processTextKey(state, 'Backspace', false);
    expect(result).toEqual({ text: 'Hell', cursorPos: 4 });
  });

  it('handles Delete', () => {
    const result = processTextKey({ text: 'Hello', cursorPos: 0 }, 'Delete', false);
    expect(result).toEqual({ text: 'ello', cursorPos: 0 });
  });

  it('handles ArrowLeft', () => {
    const result = processTextKey(state, 'ArrowLeft', false);
    expect(result!.cursorPos).toBe(4);
  });

  it('handles ArrowRight', () => {
    const result = processTextKey({ text: 'Hi', cursorPos: 0 }, 'ArrowRight', false);
    expect(result!.cursorPos).toBe(1);
  });

  it('handles Enter', () => {
    const result = processTextKey(state, 'Enter', false);
    expect(result).toEqual({ text: 'Hello\n', cursorPos: 6 });
  });

  it('returns null for unhandled keys', () => {
    expect(processTextKey(state, 'F1', false)).toBeNull();
    expect(processTextKey(state, 'Shift', false)).toBeNull();
    expect(processTextKey(state, 'Control', false)).toBeNull();
  });

  it('ignores printable chars with meta key', () => {
    // Cmd+C should not insert 'c'
    expect(processTextKey(state, 'c', true)).toBeNull();
  });

  it('handles Cmd+A', () => {
    const result = processTextKey({ text: 'Hello', cursorPos: 2 }, 'a', true);
    expect(result!.cursorPos).toBe(5);
  });
});
