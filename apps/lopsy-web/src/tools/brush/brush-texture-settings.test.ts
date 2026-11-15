import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BRUSH_TEXTURE_SETTINGS,
  clampBrushTextureSetting,
  type BrushTextureSettings,
} from './brush-texture-settings';
import type { BrushTextureData } from '../../types/brush';

describe('brush-texture-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_BRUSH_TEXTURE_SETTINGS).toEqual({
      data: null,
      blendMode: 'multiply',
      scale: 100,
    } satisfies BrushTextureSettings);
  });

  it('clamps scale into [10, 300]', () => {
    // The legacy setBrushTextureScale floored at 10 (not 0) — a 0 scale
    // collapses the texture sampler to a single texel and silently
    // produces an unusable preview. Preserve that range under the slice.
    expect(clampBrushTextureSetting('scale', 0)).toBe(10);
    expect(clampBrushTextureSetting('scale', -50)).toBe(10);
    expect(clampBrushTextureSetting('scale', 9999)).toBe(300);
    expect(clampBrushTextureSetting('scale', 100)).toBe(100);
    expect(clampBrushTextureSetting('scale', 10)).toBe(10);
    expect(clampBrushTextureSetting('scale', 300)).toBe(300);
  });

  it('does not round scale — preserves fractional values', () => {
    // Sub-percent texture scaling is meaningful for tuning the seamless
    // tile period precisely, so the clamp range guards the bounds
    // without forcing integer values.
    expect(clampBrushTextureSetting('scale', 100.5)).toBe(100.5);
    expect(clampBrushTextureSetting('scale', 42.25)).toBe(42.25);
  });

  it('passes blendMode through untouched', () => {
    expect(clampBrushTextureSetting('blendMode', 'multiply')).toBe('multiply');
    expect(clampBrushTextureSetting('blendMode', 'subtract')).toBe('subtract');
    expect(clampBrushTextureSetting('blendMode', 'overlay')).toBe('overlay');
  });

  it('passes data through untouched (including null)', () => {
    expect(clampBrushTextureSetting('data', null)).toBe(null);
    const tex: BrushTextureData = {
      id: 'texture-test',
      name: 'Test',
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(16),
    };
    expect(clampBrushTextureSetting('data', tex)).toBe(tex);
  });
});
