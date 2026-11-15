import { describe, it, expect } from 'vitest';
import { pointerToWheel, stepWheel, wheelToPuck } from './color-wheel';

describe('pointerToWheel', () => {
  it.each([
    ['right', 50, 0, 0],
    ['up', 0, -50, 90],
    ['left', -50, 0, 180],
    ['down', 0, 50, 270],
  ])('puts the rim at %s on the matching hue', (_name, dx, dy, hue) => {
    expect(pointerToWheel(dx, dy, 50)).toEqual({ hue, saturation: 100 });
  });

  it('reads saturation from the distance to the centre', () => {
    expect(pointerToWheel(25, 0, 50).saturation).toBe(50);
  });

  it('clamps a drag past the rim to full saturation and keeps its hue', () => {
    expect(pointerToWheel(0, -500, 50)).toEqual({ hue: 90, saturation: 100 });
  });

  it('snaps to neutral close to the centre', () => {
    expect(pointerToWheel(1, 0, 50).saturation).toBe(0);
    expect(pointerToWheel(2, 0, 50).saturation).toBe(4);
  });

  it('never reports a hue of 360', () => {
    expect(pointerToWheel(50, 0.01, 50).hue).toBe(0);
  });
});

describe('wheelToPuck', () => {
  it('stays in the centre at zero saturation', () => {
    const { x, y } = wheelToPuck(123, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('is the inverse of pointerToWheel', () => {
    const { x, y } = wheelToPuck(210, 60);
    expect(pointerToWheel(x * 100, y * 100, 100)).toEqual({ hue: 210, saturation: 60 });
  });
});

describe('stepWheel', () => {
  const value = { hue: 10, saturation: 50 };

  it('wraps hue around the rim in both directions', () => {
    expect(stepWheel(value, 'ArrowLeft', 15)?.hue).toBe(355);
    expect(stepWheel({ ...value, hue: 355 }, 'ArrowRight', 15)?.hue).toBe(10);
  });

  it('clamps saturation at both ends', () => {
    expect(stepWheel({ ...value, saturation: 95 }, 'ArrowUp', 10)?.saturation).toBe(100);
    expect(stepWheel({ ...value, saturation: 5 }, 'ArrowDown', 10)?.saturation).toBe(0);
  });

  it('leaves other keys to the caller', () => {
    expect(stepWheel(value, 'Enter', 1)).toBeNull();
  });
});
