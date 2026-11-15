import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ERASER_SETTINGS,
  clampEraserSetting,
  type EraserSettings,
} from './eraser-settings';

describe('eraser-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag values', () => {
    const defaults: EraserSettings = DEFAULT_ERASER_SETTINGS;
    expect(defaults).toEqual({ size: 10, opacity: 100 });
  });

  it('clampEraserSetting clamps size into [1, 5000]', () => {
    expect(clampEraserSetting('size', 0)).toBe(1);
    expect(clampEraserSetting('size', -10)).toBe(1);
    expect(clampEraserSetting('size', 1)).toBe(1);
    expect(clampEraserSetting('size', 100)).toBe(100);
    expect(clampEraserSetting('size', 5000)).toBe(5000);
    expect(clampEraserSetting('size', 99999)).toBe(5000);
  });

  it('clampEraserSetting clamps opacity into [1, 100]', () => {
    // The legacy setEraserOpacity clamped to [1, 100] (not [0, 100]),
    // matching the percent-vs-normalised footgun guard — a caller who
    // passed 0 would otherwise get a silent no-op stroke.
    expect(clampEraserSetting('opacity', -10)).toBe(1);
    expect(clampEraserSetting('opacity', 0)).toBe(1);
    expect(clampEraserSetting('opacity', 1)).toBe(1);
    expect(clampEraserSetting('opacity', 50)).toBe(50);
    expect(clampEraserSetting('opacity', 100)).toBe(100);
    expect(clampEraserSetting('opacity', 200)).toBe(100);
  });
});
