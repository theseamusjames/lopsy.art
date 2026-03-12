import { describe, it, expect } from 'vitest';
import { clamp, lerp, distance, normalize, degToRad, radToDeg, roundTo } from './math';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles min equal to max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe('lerp', () => {
  it('returns a at t=0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('returns b at t=1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('interpolates at midpoint', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it('extrapolates beyond 1', () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe('distance', () => {
  it('returns 0 for same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('computes horizontal distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
  });

  it('computes diagonal distance (3-4-5 triangle)', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('normalize', () => {
  it('returns 0 at min', () => {
    expect(normalize(0, 0, 10)).toBe(0);
  });

  it('returns 1 at max', () => {
    expect(normalize(10, 0, 10)).toBe(1);
  });

  it('returns 0.5 at midpoint', () => {
    expect(normalize(5, 0, 10)).toBe(0.5);
  });

  it('returns 0 when min equals max', () => {
    expect(normalize(5, 5, 5)).toBe(0);
  });

  it('handles values outside range', () => {
    expect(normalize(15, 0, 10)).toBe(1.5);
  });
});

describe('degToRad', () => {
  it('converts 0 degrees', () => {
    expect(degToRad(0)).toBe(0);
  });

  it('converts 180 degrees', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  it('converts 360 degrees', () => {
    expect(degToRad(360)).toBeCloseTo(2 * Math.PI);
  });

  it('converts 90 degrees', () => {
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });
});

describe('radToDeg', () => {
  it('converts 0 radians', () => {
    expect(radToDeg(0)).toBe(0);
  });

  it('converts PI radians', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
  });

  it('round-trips with degToRad', () => {
    expect(radToDeg(degToRad(45))).toBeCloseTo(45);
  });
});

describe('roundTo', () => {
  it('rounds to 0 decimals', () => {
    expect(roundTo(3.7, 0)).toBe(4);
  });

  it('rounds to 2 decimals', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
  });

  it('rounds to 1 decimal', () => {
    expect(roundTo(2.55, 1)).toBe(2.6);
  });

  it('handles negative values', () => {
    expect(roundTo(-1.555, 2)).toBe(-1.55);
  });

  it('handles 0 decimals with integer', () => {
    expect(roundTo(5, 0)).toBe(5);
  });
});
