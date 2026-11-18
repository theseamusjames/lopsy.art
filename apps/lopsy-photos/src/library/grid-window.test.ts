import { describe, expect, it } from 'vitest';
import { anchorScroll, gridGeometry, scrollToReveal, visibleRange } from './grid-window';

describe('gridGeometry', () => {
  it('fits as many columns as the target size allows and stretches tiles', () => {
    const g = gridGeometry({ width: 1000, targetSize: 200, gap: 8, itemCount: 50 });
    expect(g.columns).toBe(4);
    expect(g.tileSize).toBeCloseTo((1000 - 24) / 4);
    expect(g.rowCount).toBe(13);
    expect(g.totalHeight).toBeCloseTo(13 * g.rowHeight - 8);
  });

  it('always has at least one column', () => {
    const g = gridGeometry({ width: 50, targetSize: 200, gap: 8, itemCount: 3 });
    expect(g.columns).toBe(1);
    expect(g.rowCount).toBe(3);
  });

  it('is empty with no items', () => {
    const g = gridGeometry({ width: 800, targetSize: 100, gap: 4, itemCount: 0 });
    expect(g.rowCount).toBe(0);
    expect(g.totalHeight).toBe(0);
  });
});

describe('visibleRange', () => {
  const g = gridGeometry({ width: 1000, targetSize: 100, gap: 0, itemCount: 50_000 });

  it('covers only the rows in view plus overscan', () => {
    expect(g.columns).toBe(10);
    const r = visibleRange(g, 50_000, 1000, 500, 2);
    expect(r.firstRow).toBe(8);
    expect(r.lastRow).toBe(17);
    expect(r.startIndex).toBe(80);
    expect(r.endIndex).toBe(180);
  });

  it('clamps at the end of the list', () => {
    const r = visibleRange(g, 50_000, g.totalHeight, 500, 2);
    expect(r.lastRow).toBe(g.rowCount - 1);
    expect(r.endIndex).toBe(50_000);
  });

  it('handles a partial last row', () => {
    const small = gridGeometry({ width: 1000, targetSize: 100, gap: 0, itemCount: 15 });
    const r = visibleRange(small, 15, 0, 1000);
    expect(r.endIndex).toBe(15);
  });

  it('is empty without a viewport', () => {
    expect(visibleRange(g, 50_000, 0, 0).endIndex).toBe(0);
  });
});

describe('scrollToReveal', () => {
  const g = gridGeometry({ width: 1000, targetSize: 100, gap: 0, itemCount: 1000 });
  it('scrolls up to a row above the viewport', () => {
    expect(scrollToReveal(g, 5, 300, 400)).toBe(0);
  });
  it('scrolls down to a row below the viewport', () => {
    expect(scrollToReveal(g, 95, 0, 400)).toBe(1000 - 400);
  });
  it('leaves a visible row alone', () => {
    expect(scrollToReveal(g, 25, 0, 400)).toBeNull();
  });
});

describe('anchorScroll', () => {
  it('keeps the first visible item in the first row', () => {
    const a = gridGeometry({ width: 1000, targetSize: 100, gap: 0, itemCount: 1000 });
    const b = gridGeometry({ width: 1000, targetSize: 200, gap: 0, itemCount: 1000 });
    // Row 10 of a starts with item 100, which is row 20 of b (5 columns).
    expect(anchorScroll(a, b, 1000)).toBe(20 * b.rowHeight);
  });
});
