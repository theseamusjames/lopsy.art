import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BRUSH_JITTER_SETTINGS,
  clampBrushJitterSetting,
  type BrushJitterSettings,
} from './brush-jitter-settings';

describe('brush-jitter-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_BRUSH_JITTER_SETTINGS).toEqual({
      size: 0,
      hardness: 0,
      angle: 0,
      opacity: 0,
    } satisfies BrushJitterSettings);
  });

  it('clamps every field into [0, 100]', () => {
    for (const key of ['size', 'hardness', 'angle', 'opacity'] as const) {
      expect(clampBrushJitterSetting(key, -10)).toBe(0);
      expect(clampBrushJitterSetting(key, 0)).toBe(0);
      expect(clampBrushJitterSetting(key, 50)).toBe(50);
      expect(clampBrushJitterSetting(key, 100)).toBe(100);
      expect(clampBrushJitterSetting(key, 999)).toBe(100);
    }
  });

  it('preserves sub-percent fractional values inside the range', () => {
    // Slider input is integer, but the paint handlers divide by 100
    // and operate on the resulting normalised value, so the slice
    // must round-trip fractional inputs without quantising them.
    expect(clampBrushJitterSetting('size', 12.5)).toBe(12.5);
    expect(clampBrushJitterSetting('hardness', 33.3)).toBe(33.3);
    expect(clampBrushJitterSetting('angle', 0.5)).toBe(0.5);
    expect(clampBrushJitterSetting('opacity', 99.9)).toBe(99.9);
  });
});
