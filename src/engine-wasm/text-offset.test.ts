import { describe, it, expect } from 'vitest';
import { utf16ToUtf8, utf8ToUtf16 } from './text-offset';

describe('utf16ToUtf8', () => {
  it('is identity for ASCII', () => {
    expect(utf16ToUtf8('Hello', 0)).toBe(0);
    expect(utf16ToUtf8('Hello', 3)).toBe(3);
    expect(utf16ToUtf8('Hello', 5)).toBe(5);
  });

  it('counts multi-byte code points', () => {
    // 'é' is 2 UTF-8 bytes; index 2 (after "aé") → 3 bytes.
    expect(utf16ToUtf8('aé', 2)).toBe(3);
    // CJK '中' is 3 bytes.
    expect(utf16ToUtf8('中x', 1)).toBe(3);
  });

  it('handles astral (emoji, surrogate pair)', () => {
    // '😀' is 2 UTF-16 units and 4 UTF-8 bytes.
    expect(utf16ToUtf8('😀!', 2)).toBe(4);
    expect(utf16ToUtf8('😀!', 3)).toBe(5);
  });

  it('clamps out-of-range indices', () => {
    expect(utf16ToUtf8('Hi', -1)).toBe(0);
    expect(utf16ToUtf8('Hi', 99)).toBe(2);
  });
});

describe('utf8ToUtf16', () => {
  it('is identity for ASCII', () => {
    expect(utf8ToUtf16('Hello', 3)).toBe(3);
  });

  it('inverts utf16ToUtf8 at code-point boundaries', () => {
    const samples = ['aé', '中x', '😀!', 'plain text'];
    for (const text of samples) {
      // Only code-point boundaries round-trip; a UTF-16 index inside a surrogate
      // pair has no valid UTF-8 byte offset and never occurs as a cursor pos.
      const boundaries = new Set<number>([0]);
      let idx = 0;
      for (const ch of text) {
        idx += ch.length;
        boundaries.add(idx);
      }
      for (const i of boundaries) {
        const bytes = utf16ToUtf8(text, i);
        expect(utf8ToUtf16(text, bytes)).toBe(i);
      }
    }
  });

  it('rounds a mid-codepoint byte offset down to the boundary', () => {
    // '中' occupies bytes 0..3; a byte offset of 1 is inside it → index 0.
    expect(utf8ToUtf16('中', 1)).toBe(0);
  });
});
