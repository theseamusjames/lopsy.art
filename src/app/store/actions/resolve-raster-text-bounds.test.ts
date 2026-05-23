import { describe, it, expect } from 'vitest';
import { resolveRasterTextBounds } from './resolve-raster-text-bounds';

describe('resolveRasterTextBounds', () => {
  it('prefers engine bounds when they are valid', () => {
    const result = resolveRasterTextBounds([50, 60, 200, 150], 0, 0, 100, 100);
    expect(result).toEqual({ x: 50, y: 60, width: 200, height: 150 });
  });

  it('handles Int32Array engine bounds', () => {
    const bounds = new Int32Array([10, 20, 64, 32]);
    const result = resolveRasterTextBounds(bounds, 0, 0, 100, 100);
    expect(result).toEqual({ x: 10, y: 20, width: 64, height: 32 });
  });

  it('falls back to JS coordinates when engine returns empty', () => {
    const result = resolveRasterTextBounds([], 25, 35, 100, 80);
    expect(result).toEqual({ x: 25, y: 35, width: 100, height: 80 });
  });

  it('falls back to JS coordinates when engine returns null', () => {
    const result = resolveRasterTextBounds(null, 25, 35, 100, 80);
    expect(result).toEqual({ x: 25, y: 35, width: 100, height: 80 });
  });

  it('falls back when engine reports zero-sized bounds', () => {
    const result = resolveRasterTextBounds([0, 0, 0, 0], 25, 35, 100, 80);
    expect(result).toEqual({ x: 25, y: 35, width: 100, height: 80 });
  });

  it('returns null when engine bounds invalid AND fallback dims are zero', () => {
    expect(resolveRasterTextBounds([], 25, 35, 0, 0)).toBeNull();
    expect(resolveRasterTextBounds(null, 25, 35, 0, 100)).toBeNull();
    expect(resolveRasterTextBounds(null, 25, 35, 100, 0)).toBeNull();
  });

  it('returns null when engine bounds have wrong length', () => {
    const result = resolveRasterTextBounds([1, 2, 3], 0, 0, 0, 0);
    expect(result).toBeNull();
  });

  it('engine bounds with negative origin (texture shifted outside canvas) are preserved', () => {
    const result = resolveRasterTextBounds([-10, -20, 200, 200], 0, 0, 100, 100);
    expect(result).toEqual({ x: -10, y: -20, width: 200, height: 200 });
  });
});
