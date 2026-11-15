import { describe, expect, it } from 'vitest';
import { formatDimension, fromPixels, toPixels } from './dimension-units';

describe('toPixels', () => {
  it('returns rounded pixels when unit is px (dpi ignored)', () => {
    expect(toPixels(1920, 'px', 72)).toBe(1920);
    expect(toPixels(1920.6, 'px', 300)).toBe(1921);
  });

  it('multiplies inches by dpi', () => {
    expect(toPixels(1, 'in', 72)).toBe(72);
    expect(toPixels(8.5, 'in', 300)).toBe(2550);
    expect(toPixels(11, 'in', 300)).toBe(3300);
  });
});

describe('fromPixels', () => {
  it('returns pixels unchanged for px', () => {
    expect(fromPixels(1920, 'px', 72)).toBe(1920);
  });

  it('divides by dpi for inches', () => {
    expect(fromPixels(72, 'in', 72)).toBe(1);
    expect(fromPixels(2550, 'in', 300)).toBe(8.5);
  });
});

describe('formatDimension', () => {
  it('returns integer string for px', () => {
    expect(formatDimension(1920, 'px', 72)).toBe('1920');
  });

  it('returns two-decimal inches string', () => {
    expect(formatDimension(2550, 'in', 300)).toBe('8.50');
    expect(formatDimension(72, 'in', 72)).toBe('1.00');
  });
});
