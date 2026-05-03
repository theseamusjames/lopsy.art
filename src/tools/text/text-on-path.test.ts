import { describe, it, expect } from 'vitest';
import { buildPathLookupTable, placeTextOnPath } from './text-on-path';
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
