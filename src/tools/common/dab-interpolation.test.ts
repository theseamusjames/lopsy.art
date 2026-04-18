import { describe, it, expect } from 'vitest';
import { interpolateFlat } from './dab-interpolation';

describe('interpolateFlat', () => {
  it('returns just the destination when the segment is shorter than spacing', () => {
    const out = interpolateFlat({ x: 0, y: 0 }, { x: 2, y: 0 }, 5);
    expect(Array.from(out)).toEqual([2, 0]);
  });

  it('places dabs at multiples of spacing along the segment', () => {
    const out = interpolateFlat({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
    // 5 dabs at x = 2, 4, 6, 8, 10
    expect(Array.from(out)).toEqual([2, 0, 4, 0, 6, 0, 8, 0, 10, 0]);
  });

  it('walks along the segment for diagonal motion', () => {
    const out = interpolateFlat({ x: 0, y: 0 }, { x: 6, y: 8 }, 5);
    // dist = 10, two steps at t = 0.5 and t = 1.0
    expect(Array.from(out)).toEqual([3, 4, 6, 8]);
  });

  it('handles zero-length segments without dividing by zero', () => {
    const out = interpolateFlat({ x: 5, y: 5 }, { x: 5, y: 5 }, 1);
    expect(Array.from(out)).toEqual([5, 5]);
  });
});
