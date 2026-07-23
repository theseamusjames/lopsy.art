import { describe, it, expect } from 'vitest';
import {
  insertText,
  deleteBackward,
  deleteForward,
  deleteSelection,
  hasSelection,
  selectionRange,
  moveVertical,
  wordAt,
  wordBoundaryBefore,
  wordBoundaryAfter,
  lineStart,
  lineEnd,
  processTextKey,
  type TextEditState,
  type TextGeometry,
  type KeyModifiers,
} from './text-input';

/** Build a state; defaults have no selection and no goal column. */
function st(text: string, cursorPos: number, selectionAnchor: number | null = null): TextEditState {
  return { text, cursorPos, selectionAnchor, preferredX: null };
}

const NONE: KeyModifiers = { meta: false, shift: false, alt: false };
const SHIFT: KeyModifiers = { meta: false, shift: true, alt: false };
const META: KeyModifiers = { meta: true, shift: false, alt: false };
const ALT: KeyModifiers = { meta: false, shift: false, alt: true };

describe('selection helpers', () => {
  it('hasSelection is false when anchor is null or equal to cursor', () => {
    expect(hasSelection(st('Hello', 3))).toBe(false);
    expect(hasSelection(st('Hello', 3, 3))).toBe(false);
    expect(hasSelection(st('Hello', 3, 1))).toBe(true);
  });

  it('selectionRange orders anchor and cursor', () => {
    expect(selectionRange(st('Hello', 1, 4))).toEqual([1, 4]);
    expect(selectionRange(st('Hello', 4, 1))).toEqual([1, 4]);
    expect(selectionRange(st('Hello', 2))).toBeNull();
  });
});

describe('insertText', () => {
  it('inserts at the cursor', () => {
    expect(insertText(st('Hllo', 1), 'e')).toEqual(st('Hello', 2));
  });

  it('replaces an active selection', () => {
    // "Hello", select "ell" [1,4), type "i" → "Hio"
    const result = insertText(st('Hello', 4, 1), 'i');
    expect(result.text).toBe('Hio');
    expect(result.cursorPos).toBe(2);
    expect(result.selectionAnchor).toBeNull();
  });
});

describe('deleteBackward / deleteForward', () => {
  it('deletes the char before the cursor', () => {
    expect(deleteBackward(st('Hello', 5))).toEqual(st('Hell', 4));
  });

  it('deletes the selection when present', () => {
    const result = deleteBackward(st('Hello', 4, 1));
    expect(result.text).toBe('Ho');
    expect(result.cursorPos).toBe(1);
  });

  it('deleteForward removes the char after the cursor', () => {
    expect(deleteForward(st('Hello', 0))).toEqual(st('ello', 0));
  });

  it('deleteForward removes the selection when present', () => {
    expect(deleteSelection(st('Hello', 1, 4)).text).toBe('Ho');
  });
});

describe('word + line boundaries', () => {
  it('finds the word containing a position', () => {
    expect(wordAt('foo bar baz', 5)).toEqual([4, 7]); // "bar"
    expect(wordAt('foo bar', 0)).toEqual([0, 3]); // "foo"
  });

  it('selects a single char on a non-word position', () => {
    expect(wordAt('a b', 1)).toEqual([1, 2]); // the space
  });

  it('word boundaries skip separators then word chars', () => {
    expect(wordBoundaryAfter('foo bar', 0)).toBe(3);
    expect(wordBoundaryAfter('foo bar', 3)).toBe(7);
    expect(wordBoundaryBefore('foo bar', 7)).toBe(4);
    expect(wordBoundaryBefore('foo bar', 3)).toBe(0);
  });

  it('line boundaries respect newlines', () => {
    const text = 'Line 1\nLine 2';
    expect(lineStart(text, 10)).toBe(7);
    expect(lineEnd(text, 2)).toBe(6);
  });
});

describe('processTextKey — movement + selection', () => {
  it('inserts printable characters', () => {
    expect(processTextKey(st('Hello', 5), '!', NONE)).toEqual(st('Hello!', 6));
  });

  it('plain ArrowLeft collapses a selection to its start', () => {
    const result = processTextKey(st('Hello', 4, 1), 'ArrowLeft', NONE)!;
    expect(result.cursorPos).toBe(1);
    expect(result.selectionAnchor).toBeNull();
  });

  it('plain ArrowRight collapses a selection to its end', () => {
    const result = processTextKey(st('Hello', 1, 4), 'ArrowRight', NONE)!;
    expect(result.cursorPos).toBe(4);
    expect(result.selectionAnchor).toBeNull();
  });

  it('Shift+ArrowLeft starts and extends a selection', () => {
    const first = processTextKey(st('Hello', 5), 'ArrowLeft', SHIFT)!;
    expect(first.cursorPos).toBe(4);
    expect(first.selectionAnchor).toBe(5);
    const second = processTextKey(first, 'ArrowLeft', SHIFT)!;
    expect(second.cursorPos).toBe(3);
    expect(second.selectionAnchor).toBe(5);
  });

  it('Alt+Arrow jumps by word', () => {
    expect(processTextKey(st('foo bar', 0), 'ArrowRight', ALT)!.cursorPos).toBe(3);
    expect(processTextKey(st('foo bar', 7), 'ArrowLeft', ALT)!.cursorPos).toBe(4);
  });

  it('Cmd+Arrow jumps to line start/end', () => {
    expect(processTextKey(st('Hello', 2), 'ArrowLeft', META)!.cursorPos).toBe(0);
    expect(processTextKey(st('Hello', 2), 'ArrowRight', META)!.cursorPos).toBe(5);
  });

  it('Home/End move within the current line, Shift extends', () => {
    expect(processTextKey(st('ab\ncd', 4), 'Home', NONE)!.cursorPos).toBe(3);
    const sel = processTextKey(st('ab\ncd', 3), 'End', SHIFT)!;
    expect(sel.cursorPos).toBe(5);
    expect(sel.selectionAnchor).toBe(3);
  });

  it('Cmd+A selects all', () => {
    const result = processTextKey(st('Hello', 2), 'a', META)!;
    expect(result.cursorPos).toBe(5);
    expect(result.selectionAnchor).toBe(0);
  });

  it('typing replaces an active selection', () => {
    const result = processTextKey(st('Hello', 5, 0), 'x', NONE)!;
    expect(result.text).toBe('x');
  });

  it('Enter inserts a newline (replacing selection)', () => {
    expect(processTextKey(st('AB', 1), 'Enter', NONE)).toEqual(st('A\nB', 2));
  });

  it('returns null for Tab and other unhandled keys', () => {
    expect(processTextKey(st('Hello', 5), 'Tab', NONE)).toBeNull();
    expect(processTextKey(st('Hello', 5), 'F1', NONE)).toBeNull();
    expect(processTextKey(st('Hello', 5), 'Shift', NONE)).toBeNull();
  });

  it('ignores printable chars combined with meta', () => {
    expect(processTextKey(st('Hello', 5), 'c', META)).toBeNull();
  });

  it('ArrowUp/ArrowDown are not handled here (need geometry)', () => {
    expect(processTextKey(st('Hello', 5), 'ArrowUp', NONE)).toBeNull();
    expect(processTextKey(st('Hello', 5), 'ArrowDown', NONE)).toBeNull();
  });
});

describe('moveVertical', () => {
  // Two lines "ab" / "cd": line 0 top 0, line 1 top 10, height 10.
  // Glyph x positions: a=0, b=6, c=0, d=6.
  const geometry: TextGeometry = {
    caretRect(pos) {
      const line = pos <= 2 ? 0 : 1;
      const col = line === 0 ? pos : pos - 3;
      return { x: col * 6, top: line * 10, height: 10 };
    },
    hitTest(x, y) {
      const line = y < 10 ? 0 : 1;
      const col = Math.round(x / 6);
      return line === 0 ? Math.min(col, 2) : 3 + Math.min(col, 2);
    },
  };

  it('moves the caret down one line at the same column', () => {
    // cursor after "a" on line 0 (pos 1) → down → line 1 col 1 (pos 4)
    const result = moveVertical(st('ab\ncd', 1), 'down', geometry, false);
    expect(result.cursorPos).toBe(4);
    expect(result.preferredX).toBe(6);
  });

  it('moves the caret up one line', () => {
    const result = moveVertical(st('ab\ncd', 5), 'up', geometry, false);
    expect(result.cursorPos).toBe(2); // line 0, col 2
  });

  it('extends the selection with shift', () => {
    const result = moveVertical(st('ab\ncd', 1), 'down', geometry, true);
    expect(result.selectionAnchor).toBe(1);
  });

  it('snaps to line end when already on the last line', () => {
    const result = moveVertical(st('ab\ncd', 4), 'down', geometry, false);
    expect(result.cursorPos).toBe(5); // end of "cd"
  });
});
