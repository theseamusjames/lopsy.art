import { describe, it, expect } from 'vitest';
import { createPolygonMask } from './lasso';

describe('createPolygonMask', () => {
  it('creates empty mask for fewer than 3 points', () => {
    const mask = createPolygonMask(
      [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      20, 20,
    );
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('fills a triangle', () => {
    const mask = createPolygonMask(
      [{ x: 5, y: 2 }, { x: 2, y: 8 }, { x: 8, y: 8 }],
      10, 10,
    );
    // Center of triangle should be filled
    expect(mask[5 * 10 + 5]).toBe(255);
    // Outside the triangle should be empty
    expect(mask[0]).toBe(0);
  });

  it('fills a rectangle', () => {
    const mask = createPolygonMask(
      [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }],
      10, 10,
    );
    // Inside should be filled
    expect(mask[5 * 10 + 5]).toBe(255);
    // Outside should be empty
    expect(mask[0]).toBe(0);
    expect(mask[9 * 10 + 9]).toBe(0);
  });

  it('handles zero-area polygons', () => {
    const mask = createPolygonMask([], 10, 10);
    expect(mask.length).toBe(100);
    expect(mask.every((v) => v === 0)).toBe(true);
  });
});
