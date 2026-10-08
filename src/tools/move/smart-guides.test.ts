import { describe, it, expect } from 'vitest';
import { buildAlignmentTargets, findAlignment, sameGuides, unionRects } from './smart-guides';

const DOC_W = 400;
const DOC_H = 300;

describe('buildAlignmentTargets', () => {
  it('includes the canvas edges and centre', () => {
    const t = buildAlignmentTargets([], DOC_W, DOC_H);
    expect(t.vertical.map((v) => v.position)).toEqual([0, 200, 400]);
    expect(t.horizontal.map((h) => h.position)).toEqual([0, 150, 300]);
    expect(t.vertical[0]).toEqual({ position: 0, spanStart: 0, spanEnd: DOC_H });
  });

  it('adds each rect’s edges and centres with the rect’s cross extent', () => {
    const t = buildAlignmentTargets([{ x: 10, y: 20, width: 60, height: 40 }], DOC_W, DOC_H);
    expect(t.vertical.slice(3)).toEqual([
      { position: 10, spanStart: 20, spanEnd: 60 },
      { position: 40, spanStart: 20, spanEnd: 60 },
      { position: 70, spanStart: 20, spanEnd: 60 },
    ]);
    expect(t.horizontal.slice(3).map((h) => h.position)).toEqual([20, 40, 60]);
  });

  it('skips empty rects', () => {
    const t = buildAlignmentTargets([{ x: 10, y: 20, width: 0, height: 40 }], DOC_W, DOC_H);
    expect(t.vertical).toHaveLength(3);
  });
});

describe('unionRects', () => {
  it('returns null for nothing', () => {
    expect(unionRects([])).toBeNull();
  });

  it('bounds every rect', () => {
    expect(unionRects([
      { x: 10, y: 10, width: 10, height: 10 },
      { x: 50, y: -5, width: 5, height: 5 },
    ])).toEqual({ x: 10, y: -5, width: 45, height: 25 });
  });
});

describe('findAlignment', () => {
  // A 60x60 box at (100, 100): x features 100 / 130 / 160, y features 100 / 130 / 160.
  const targets = buildAlignmentTargets([{ x: 100, y: 100, width: 60, height: 60 }], DOC_W, DOC_H);

  it('finds nothing when no feature is in reach', () => {
    const r = findAlignment({ x: 250, y: 220, width: 30, height: 30 }, targets, 4);
    expect(r).toEqual({ dx: null, dy: null, guides: [] });
  });

  it('aligns a left edge with another box’s right edge', () => {
    const r = findAlignment({ x: 163, y: 200, width: 20, height: 20 }, targets, 4);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBeNull();
    expect(r.guides).toEqual([
      { orientation: 'vertical', position: 160, start: 100, end: 220 },
    ]);
  });

  it('aligns centres', () => {
    // Moving centre 134 is 4 from the box centre 130; its left edge (6 away) loses.
    const r = findAlignment({ x: 124, y: 220, width: 20, height: 20 }, targets, 6);
    expect(r.dx).toBe(-4);
    expect(r.guides.map((g) => g.position)).toEqual([130]);
  });

  it('aligns with the canvas centre and spans the whole canvas', () => {
    const r = findAlignment({ x: 300, y: 133, width: 20, height: 30 }, targets, 4);
    // Moving middle y = 148, canvas middle = 150.
    expect(r.dy).toBe(2);
    expect(r.guides).toEqual([
      { orientation: 'horizontal', position: 150, start: 0, end: DOC_W },
    ]);
  });

  it('picks the nearest pair on each axis independently', () => {
    // Same-size box offset by (+3, -2): one shift per axis aligns all three features.
    const r = findAlignment({ x: 103, y: 98, width: 60, height: 60 }, targets, 5);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(2);
    const vertical = r.guides.filter((g) => g.orientation === 'vertical').map((g) => g.position);
    expect(vertical).toEqual([100, 130, 160]);
    const horizontal = r.guides.filter((g) => g.orientation === 'horizontal').map((g) => g.position);
    expect(horizontal).toEqual([100, 130, 160]);
  });

  it('marks every feature an exact alignment lines up', () => {
    const r = findAlignment({ x: 100, y: 200, width: 60, height: 30 }, targets, 4);
    expect(r.dx).toBe(0);
    expect(r.guides.map((g) => g.position)).toEqual([100, 130, 160]);
  });

  it('merges identical target positions into one guide covering both spans', () => {
    const stacked = buildAlignmentTargets([
      { x: 50, y: 10, width: 20, height: 20 },
      { x: 50, y: 200, width: 40, height: 20 },
    ], DOC_W, DOC_H);
    const r = findAlignment({ x: 52, y: 100, width: 30, height: 10 }, stacked, 4);
    expect(r.guides).toEqual([
      { orientation: 'vertical', position: 50, start: 10, end: 220 },
    ]);
  });

  it('respects the threshold exactly', () => {
    expect(findAlignment({ x: 164, y: 250, width: 10, height: 10 }, targets, 4).dx).toBe(-4);
    expect(findAlignment({ x: 164.5, y: 250, width: 10, height: 10 }, targets, 4).dx).toBeNull();
  });
});

describe('sameGuides', () => {
  const g = { orientation: 'vertical' as const, position: 1, start: 0, end: 2 };

  it('compares by value', () => {
    expect(sameGuides([g], [{ ...g }])).toBe(true);
    expect(sameGuides([g], [{ ...g, end: 3 }])).toBe(false);
    expect(sameGuides([g], [])).toBe(false);
  });
});
