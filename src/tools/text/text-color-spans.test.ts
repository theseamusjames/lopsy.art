import { describe, it, expect } from 'vitest';
import {
  colorOfRange,
  colorSpansProp,
  normalizeColorSpans,
  parseStoredColorSpans,
  remapColorSpansForEdit,
  setColorForRange,
  unitColors,
} from './text-color-spans';
import type { Color } from '../../types';

const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
const RED: Color = { r: 255, g: 0, b: 0, a: 1 };
const BLUE: Color = { r: 0, g: 0, b: 255, a: 1 };

describe('setColorForRange', () => {
  it('adds a span over the range', () => {
    expect(setColorForRange([], 5, BLACK, 1, 3, RED)).toEqual([{ start: 1, end: 3, color: RED }]);
  });

  it('accepts a reversed range (anchor after caret)', () => {
    expect(setColorForRange([], 5, BLACK, 3, 1, RED)).toEqual([{ start: 1, end: 3, color: RED }]);
  });

  it('splits an existing span it lands inside', () => {
    const spans = [{ start: 0, end: 5, color: RED }];
    expect(setColorForRange(spans, 5, BLACK, 2, 3, BLUE)).toEqual([
      { start: 0, end: 2, color: RED },
      { start: 2, end: 3, color: BLUE },
      { start: 3, end: 5, color: RED },
    ]);
  });

  it('merges with an adjacent span of the same colour', () => {
    const spans = [{ start: 0, end: 2, color: RED }];
    expect(setColorForRange(spans, 5, BLACK, 2, 4, RED)).toEqual([{ start: 0, end: 4, color: RED }]);
  });

  it('drops spans that are recoloured to the base colour', () => {
    const spans = [{ start: 1, end: 3, color: RED }];
    expect(setColorForRange(spans, 5, BLACK, 0, 5, BLACK)).toEqual([]);
  });

  it('clamps the range to the text', () => {
    expect(setColorForRange([], 3, BLACK, 2, 10, RED)).toEqual([{ start: 2, end: 3, color: RED }]);
  });
});

describe('normalizeColorSpans', () => {
  it('sorts, clips, resolves overlaps (later wins) and removes base-coloured spans', () => {
    const spans = [
      { start: 3, end: 9, color: BLUE },
      { start: 0, end: 4, color: RED },
      { start: 1, end: 2, color: BLACK },
    ];
    expect(normalizeColorSpans(spans, 6, BLACK)).toEqual([
      { start: 0, end: 1, color: RED },
      { start: 2, end: 4, color: RED },
      { start: 4, end: 6, color: BLUE },
    ]);
  });
});

describe('remapColorSpansForEdit', () => {
  const spans = [{ start: 2, end: 4, color: RED }]; // "ab[cd]ef"

  it('shifts spans after an insertion before them', () => {
    expect(remapColorSpansForEdit(spans, 'abcdef', 'XXabcdef', BLACK)).toEqual([{ start: 4, end: 6, color: RED }]);
  });

  it('extends a span when typing at its end (typing continues the colour)', () => {
    expect(remapColorSpansForEdit(spans, 'abcdef', 'abcdZef', BLACK)).toEqual([{ start: 2, end: 5, color: RED }]);
  });

  it('typing right before a span uses the preceding (base) colour', () => {
    expect(remapColorSpansForEdit(spans, 'abcdef', 'abZcdef', BLACK)).toEqual([{ start: 3, end: 5, color: RED }]);
  });

  it('inserting at the very start takes the first character colour', () => {
    const first = [{ start: 0, end: 2, color: RED }];
    expect(remapColorSpansForEdit(first, 'abcd', 'Zabcd', BLACK)).toEqual([{ start: 0, end: 3, color: RED }]);
  });

  it('shrinks a span when part of it is deleted', () => {
    expect(remapColorSpansForEdit(spans, 'abcdef', 'abdef', BLACK)).toEqual([{ start: 2, end: 3, color: RED }]);
  });

  it('removes a span whose text is deleted', () => {
    expect(remapColorSpansForEdit(spans, 'abcdef', 'abef', BLACK)).toEqual([]);
  });

  it('a replaced selection takes the colour before it', () => {
    // Select "cd" (red) and type "Q": the preceding "b" is base-coloured.
    expect(remapColorSpansForEdit(spans, 'abcdef', 'abQef', BLACK)).toEqual([]);
  });

  it('handles repeated characters around the edit', () => {
    const s = [{ start: 1, end: 3, color: RED }]; // "a[aa]a"
    expect(remapColorSpansForEdit(s, 'aaaa', 'aaaaa', BLACK)).toEqual([{ start: 1, end: 3, color: RED }]);
  });

  it('returns no spans when there were none', () => {
    expect(remapColorSpansForEdit(undefined, 'a', 'ab', BLACK)).toEqual([]);
  });
});

describe('colorOfRange', () => {
  const spans = [{ start: 2, end: 4, color: RED }];

  it('reports the single colour of a uniform range', () => {
    expect(colorOfRange(BLACK, spans, 6, 2, 4)).toEqual(RED);
    expect(colorOfRange(BLACK, spans, 6, 0, 2)).toEqual(BLACK);
  });

  it('reports null (mixed) for a range spanning two colours', () => {
    expect(colorOfRange(BLACK, spans, 6, 1, 3)).toBeNull();
  });

  it('treats an empty range as the whole text', () => {
    expect(colorOfRange(BLACK, spans, 6, 3, 3)).toBeNull();
    expect(colorOfRange(BLACK, [], 6, 3, 3)).toEqual(BLACK);
  });

  it('reports the base colour for empty text', () => {
    expect(colorOfRange(BLUE, [], 0, 0, 0)).toEqual(BLUE);
  });
});

describe('unitColors', () => {
  it('gives every UTF-16 unit its colour', () => {
    expect(unitColors(3, BLACK, [{ start: 1, end: 2, color: RED }])).toEqual([BLACK, RED, BLACK]);
  });
});

describe('colorSpansProp', () => {
  it('encodes spans for the engine with channels in 0..1', () => {
    expect(colorSpansProp([{ start: 1, end: 2, color: { r: 255, g: 0, b: 51, a: 0.5 } }])).toEqual([
      [1, 2, 1, 0, 0.2, 0.5],
    ]);
  });
});

describe('parseStoredColorSpans', () => {
  it('keeps well-formed spans and drops malformed ones', () => {
    expect(parseStoredColorSpans([
      { start: 0, end: 2, color: RED },
      { start: 3, end: 3, color: RED },
      { start: 1, end: 2, color: { r: 1 } },
      'junk',
    ])).toEqual([{ start: 0, end: 2, color: RED }]);
  });

  it('returns undefined when nothing usable is stored', () => {
    expect(parseStoredColorSpans(undefined)).toBeUndefined();
    expect(parseStoredColorSpans([])).toBeUndefined();
  });
});
