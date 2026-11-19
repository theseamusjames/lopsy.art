import { describe, expect, it } from 'vitest';
import { clampStrokePathWidth } from './stroke-path-width';

describe('clampStrokePathWidth', () => {
  it('rounds to a whole pixel and clamps to 1-50, as the Stroke Path dialog does', () => {
    expect(clampStrokePathWidth(2.5)).toBe(3);
    expect(clampStrokePathWidth(0.2)).toBe(1);
    expect(clampStrokePathWidth(80)).toBe(50);
    expect(clampStrokePathWidth(12)).toBe(12);
  });
});
