import { describe, expect, it } from 'vitest';
import { nextZoomLevel } from './zoom-levels';

describe('nextZoomLevel', () => {
  it('steps through exact ratios from 100%', () => {
    expect(nextZoomLevel(1, 'in')).toBe(2);
    expect(nextZoomLevel(2, 'in')).toBe(3);
    expect(nextZoomLevel(1, 'out')).toBe(0.6667);
    expect(nextZoomLevel(0.6667, 'out')).toBe(0.5);
  });

  it('snaps a fractional fit zoom to the neighbouring stop', () => {
    expect(nextZoomLevel(0.42, 'in')).toBe(0.5);
    expect(nextZoomLevel(0.42, 'out')).toBe(0.3333);
    expect(nextZoomLevel(1.3, 'in')).toBe(2);
    expect(nextZoomLevel(1.3, 'out')).toBe(1);
  });

  it('treats float noise as already being on a stop', () => {
    expect(nextZoomLevel(0.49999, 'in')).toBe(0.6667);
    expect(nextZoomLevel(0.50001, 'out')).toBe(0.3333);
  });

  it('clamps at both ends', () => {
    expect(nextZoomLevel(64, 'in')).toBe(64);
    expect(nextZoomLevel(0.01, 'out')).toBe(0.01);
  });
});
