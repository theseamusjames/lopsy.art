import { describe, it, expect } from 'vitest';
import { resolveRasterTextBounds } from './rasterize-text-bounds';

describe('resolveRasterTextBounds', () => {
  it('uses engine bounds when they describe a non-empty texture', () => {
    const result = resolveRasterTextBounds(100, 50, [-20, -10, 800, 600], [800, 600]);
    expect(result).toEqual({ x: -20, y: -10, width: 800, height: 600 });
  });

  it('prefers engine bounds over JS x/y to fix issue #496 (text jumps after rasterize)', () => {
    // Simulates: layer at JS (100, 50), but Rust expanded texture and reset
    // desc.x/desc.y to (0, 0). Rasterize must use the engine truth so the
    // resulting raster lines up with the actual texture content.
    const result = resolveRasterTextBounds(100, 50, [0, 0, 400, 400], [400, 400]);
    expect(result?.x).toBe(0);
    expect(result?.y).toBe(0);
  });

  it('falls back to texture dims + engine x/y when engine size is missing', () => {
    const result = resolveRasterTextBounds(100, 50, [10, 20, 0, 0], [300, 200]);
    expect(result).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('falls back to JS x/y when engine returns no bounds at all', () => {
    const result = resolveRasterTextBounds(100, 50, [], [300, 200]);
    expect(result).toEqual({ x: 100, y: 50, width: 300, height: 200 });
  });

  it('returns null when neither engine nor texture has size', () => {
    expect(resolveRasterTextBounds(100, 50, [], [0, 0])).toBeNull();
    expect(resolveRasterTextBounds(100, 50, [0, 0, 0, 0], [0, 0])).toBeNull();
  });

  it('handles texture dims provided as Uint32Array-like with first value zero', () => {
    expect(resolveRasterTextBounds(100, 50, [], [0, 200])).toBeNull();
    expect(resolveRasterTextBounds(100, 50, [], [200, 0])).toBeNull();
  });
});
