import { describe, it, expect } from 'vitest';
import {
  clampBrushSpeedSetting,
  DEFAULT_BRUSH_SPEED_SETTINGS,
} from './brush-speed-settings';

describe('brush-speed-settings', () => {
  it('defaults match the legacy flat-store brush-speed defaults', () => {
    expect(DEFAULT_BRUSH_SPEED_SETTINGS).toEqual({
      size: 0,
      sizeInvert: false,
      sensitivity: 'med',
    });
  });

  it('clamps size into [0, 300]', () => {
    // Range matches the legacy setBrushSpeedSize: [0, 300]. The UI
    // surfaces [0, 100] when `sizeInvert` is false and [0, 300] when
    // it's true, but the store-level clamp is the looser bound so the
    // UI can flip the toggle without truncating the value.
    expect(clampBrushSpeedSetting('size', -10)).toBe(0);
    expect(clampBrushSpeedSetting('size', 0)).toBe(0);
    expect(clampBrushSpeedSetting('size', 100)).toBe(100);
    expect(clampBrushSpeedSetting('size', 300)).toBe(300);
    expect(clampBrushSpeedSetting('size', 9999)).toBe(300);
  });

  it('coerces sizeInvert to a boolean', () => {
    expect(clampBrushSpeedSetting('sizeInvert', true)).toBe(true);
    expect(clampBrushSpeedSetting('sizeInvert', false)).toBe(false);
  });

  it('accepts low / med / high for sensitivity and falls back to med for unknown strings', () => {
    // brush-stroke.ts maps sensitivity to a moving-average window
    // (low → 6, med → 3, high → 2). An unrecognised enum would leave
    // that ternary on the `med` branch silently, so the clamp
    // collapses unknown strings to 'med' explicitly.
    expect(clampBrushSpeedSetting('sensitivity', 'low')).toBe('low');
    expect(clampBrushSpeedSetting('sensitivity', 'med')).toBe('med');
    expect(clampBrushSpeedSetting('sensitivity', 'high')).toBe('high');
    expect(
      clampBrushSpeedSetting(
        'sensitivity',
        'medium' as unknown as 'low' | 'med' | 'high',
      ),
    ).toBe('med');
  });
});
