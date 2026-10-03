import { describe, it, expect } from 'vitest';
import { buildPathLookupTable, pathTextStartOffset, placeTextOnPath } from './text-on-path';
import type { PathAnchor } from '../path/path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function straightPath(x0: number, y0: number, x1: number, y1: number): PathAnchor[] {
  return [
    { point: { x: x0, y: y0 }, handleIn: null, handleOut: null },
    { point: { x: x1, y: y1 }, handleIn: null, handleOut: null },
  ];
}

function uniformWidths(count: number, width: number): number[] {
  return Array.from({ length: count }, () => width);
}

// ---------------------------------------------------------------------------
// buildPathLookupTable
// ---------------------------------------------------------------------------

describe('buildPathLookupTable', () => {
  it('returns empty table for fewer than two anchors', () => {
    const table = buildPathLookupTable([], false);
    expect(table).toHaveLength(0);

    const single = buildPathLookupTable(
      [{ point: { x: 0, y: 0 }, handleIn: null, handleOut: null }],
      false,
    );
    expect(single).toHaveLength(0);
  });

  it('produces monotonically increasing distances for a straight path', () => {
    const anchors = straightPath(0, 0, 100, 0);
    const table = buildPathLookupTable(anchors, false);

    expect(table.length).toBeGreaterThan(0);
    for (let i = 1; i < table.length; i++) {
      expect(table[i]!.distance).toBeGreaterThan(table[i - 1]!.distance);
    }
  });

  it('total arc length approximates straight-line length', () => {
    const anchors = straightPath(0, 0, 200, 0);
    const table = buildPathLookupTable(anchors, false);
    const totalDist = table[table.length - 1]!.distance;
    expect(totalDist).toBeGreaterThan(195);
    expect(totalDist).toBeLessThan(205);
  });

  it('tangent along a horizontal path is unit vector pointing right', () => {
    const anchors = straightPath(0, 0, 100, 0);
    const table = buildPathLookupTable(anchors, false);

    for (const sample of table) {
      expect(sample.tx).toBeCloseTo(1, 1);
      expect(sample.ty).toBeCloseTo(0, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// placeTextOnPath
// ---------------------------------------------------------------------------

describe('placeTextOnPath', () => {
  it('returns empty array when anchors are empty', () => {
    const placements = placeTextOnPath('Hello', uniformWidths(5, 10), [], false, 16);
    expect(placements).toHaveLength(0);
  });

  it('places glyphs at correct x positions along a horizontal path', () => {
    // Path from (0,0) to (300,0) — plenty of room for 5 chars × 20px each
    const anchors = straightPath(0, 0, 300, 0);
    const text = 'Hello';
    const charWidth = 20;
    const placements = placeTextOnPath(
      text,
      uniformWidths(text.length, charWidth),
      anchors,
      false,
      16,
    );

    expect(placements).toHaveLength(text.length);

    // Each glyph should be centred at dist + width/2 along the path
    let dist = 0;
    for (let i = 0; i < placements.length; i++) {
      const expected = dist + charWidth / 2;
      expect(placements[i]!.x).toBeCloseTo(expected, 0);
      expect(placements[i]!.y).toBeCloseTo(0, 0);
      dist += charWidth;
    }
  });

  it('assigns zero rotation along a horizontal path', () => {
    const anchors = straightPath(0, 0, 300, 0);
    const placements = placeTextOnPath(
      'AB',
      uniformWidths(2, 20),
      anchors,
      false,
      16,
    );
    for (const p of placements) {
      expect(p.rotation).toBeCloseTo(0, 2);
    }
  });

  it('assigns π/2 rotation along a downward vertical path', () => {
    // Path going straight down
    const anchors = straightPath(0, 0, 0, 300);
    const placements = placeTextOnPath(
      'AB',
      uniformWidths(2, 20),
      anchors,
      false,
      16,
    );
    expect(placements).toHaveLength(2);
    for (const p of placements) {
      expect(p.rotation).toBeCloseTo(Math.PI / 2, 1);
    }
  });

  it('glyphs on a circular-arc path have varying rotation matching the tangent', () => {
    // Approximate a quarter-circle arc (from (100,0) sweeping to (0,100) via handles)
    const r = 100;
    const k = 0.5523; // Bezier approximation constant for quarter-circle
    const anchors: PathAnchor[] = [
      {
        point: { x: r, y: 0 },
        handleIn: null,
        handleOut: { x: r, y: r * k },
      },
      {
        point: { x: 0, y: r },
        handleIn: { x: r * k, y: r },
        handleOut: null,
      },
    ];

    const text = 'ABCDE';
    const placements = placeTextOnPath(
      text,
      uniformWidths(text.length, 15),
      anchors,
      false,
      16,
    );

    // There should be multiple placements along the arc
    expect(placements.length).toBeGreaterThan(0);

    // Rotations should be strictly increasing (path curves from horizontal to vertical)
    for (let i = 1; i < placements.length; i++) {
      expect(placements[i]!.rotation).toBeGreaterThan(placements[i - 1]!.rotation - 0.01);
    }

    // First glyph should be near horizontal (small rotation)
    expect(placements[0]!.rotation).toBeCloseTo(Math.PI / 2, 0); // tangent at (r,0) of this arc points down
  });

  it('truncates text that is longer than path length', () => {
    // Short path — only ~50px long
    const anchors = straightPath(0, 0, 50, 0);
    const text = 'ABCDEFGHIJ'; // 10 chars × 20px = 200px needed
    const placements = placeTextOnPath(
      text,
      uniformWidths(text.length, 20),
      anchors,
      false,
      16,
    );

    // At most 2 glyphs fit (2 × 20px = 40px advance) — verify strict truncation
    expect(placements.length).toBeLessThan(text.length);
    expect(placements.length).toBeGreaterThan(0);
  });

  it('charIndex matches position in text string', () => {
    const anchors = straightPath(0, 0, 400, 0);
    const text = 'Hello';
    const placements = placeTextOnPath(text, uniformWidths(5, 20), anchors, false, 16);
    for (let i = 0; i < placements.length; i++) {
      expect(placements[i]!.charIndex).toBe(i);
      expect(placements[i]!.char).toBe(text[i]);
    }
  });

  it('uses fallback width when glyphWidths is shorter than text', () => {
    const anchors = straightPath(0, 0, 400, 0);
    const fontSize = 16;
    const fallback = fontSize * 0.6; // 9.6px
    // Provide widths only for first two chars; rest get fallback
    const placements = placeTextOnPath('ABCDE', [20, 20], anchors, false, fontSize);

    expect(placements).toHaveLength(5);
    // Third char should be at x = 20+20 + fallback/2
    expect(placements[2]!.x).toBeCloseTo(40 + fallback / 2, 0);
  });
});

// ---------------------------------------------------------------------------
// Alignment (#1161)
// ---------------------------------------------------------------------------

describe('pathTextStartOffset', () => {
  it('starts left-aligned and justified runs at the first anchor', () => {
    expect(pathTextStartOffset(1200, 240, 'left')).toBe(0);
    expect(pathTextStartOffset(1200, 240, 'justify')).toBe(0);
  });

  it('splits the slack evenly for center', () => {
    expect(pathTextStartOffset(1200, 240, 'center')).toBe(480);
  });

  it('ends a right-aligned run at the last anchor', () => {
    expect(pathTextStartOffset(1200, 240, 'right')).toBe(960);
  });

  it('starts every alignment at the first anchor when the run overflows the path', () => {
    expect(pathTextStartOffset(100, 240, 'left')).toBe(0);
    expect(pathTextStartOffset(100, 240, 'center')).toBe(0);
    expect(pathTextStartOffset(100, 240, 'right')).toBe(0);
  });
});

describe('placeTextOnPath alignment', () => {
  const anchors = straightPath(300, 300, 1500, 300);
  const widths = uniformWidths(5, 40);

  function runExtent(align: 'left' | 'center' | 'right' | 'justify'): { start: number; end: number } {
    const placements = placeTextOnPath('HELLO', widths, anchors, false, 80, align);
    expect(placements).toHaveLength(5);
    return { start: placements[0]!.x - 20, end: placements[4]!.x + 20 };
  }

  it('defaults to left alignment', () => {
    const placements = placeTextOnPath('HELLO', widths, anchors, false, 80);
    expect(placements[0]!.x).toBeCloseTo(320, 0);
  });

  it('places a left run at the first anchor', () => {
    const { start, end } = runExtent('left');
    expect(start).toBeCloseTo(300, 0);
    expect(end).toBeCloseTo(500, 0);
  });

  it('centres a run on the middle of the path', () => {
    const { start, end } = runExtent('center');
    expect((start + end) / 2).toBeCloseTo(900, 0);
    expect(end - start).toBeCloseTo(200, 0);
  });

  it('ends a right run at the last anchor', () => {
    const { start, end } = runExtent('right');
    expect(start).toBeCloseTo(1300, 0);
    expect(end).toBeCloseTo(1500, 0);
  });

  it('treats justify like left on its single line', () => {
    expect(runExtent('justify').start).toBeCloseTo(300, 0);
  });

  it('measures the slack along the arc, not the chord, on a curved path', () => {
    // Quarter circle of radius 100: arc length ≈ 157, chord ≈ 141.
    const k = 0.5523 * 100;
    const arc: PathAnchor[] = [
      { point: { x: 100, y: 0 }, handleIn: null, handleOut: { x: 100, y: k } },
      { point: { x: 0, y: 100 }, handleIn: { x: k, y: 100 }, handleOut: null },
    ];
    const table = buildPathLookupTable(arc, false);
    expect(table[table.length - 1]!.distance).toBeGreaterThan(150);
    const placements = placeTextOnPath('AB', [20, 20], arc, false, 16, 'right');
    expect(placements).toHaveLength(2);
    // The last glyph's centre sits half an advance (10) before the path's end.
    const last = placements[1]!;
    const chordToEnd = Math.hypot(last.x - 0, last.y - 100);
    expect(chordToEnd).toBeGreaterThan(9);
    expect(chordToEnd).toBeLessThan(10.5);
  });

  it('keeps an overflowing run anchored at the start for every alignment', () => {
    const short = straightPath(0, 0, 50, 0);
    for (const align of ['left', 'center', 'right'] as const) {
      const placements = placeTextOnPath('ABCDEFGHIJ', uniformWidths(10, 20), short, false, 16, align);
      expect(placements[0]!.x).toBeCloseTo(10, 0);
      // Glyphs are kept while their centre is on the path: 10, 30 and 50.
      expect(placements).toHaveLength(3);
    }
  });
});
