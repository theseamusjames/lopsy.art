import { describe, it, expect } from 'vitest';
import { clampFillSetting, DEFAULT_FILL_SETTINGS } from './fill-settings';

describe('fill-settings', () => {
  it('defaults match the legacy flat-store fill defaults', () => {
    expect(DEFAULT_FILL_SETTINGS).toEqual({
      tolerance: 32,
      contiguous: true,
    });
  });

  it('clamps tolerance into [0, 255]', () => {
    expect(clampFillSetting('tolerance', -10)).toBe(0);
    expect(clampFillSetting('tolerance', 0)).toBe(0);
    expect(clampFillSetting('tolerance', 128)).toBe(128);
    expect(clampFillSetting('tolerance', 255)).toBe(255);
    expect(clampFillSetting('tolerance', 9999)).toBe(255);
  });

  it('passes boolean settings through unchanged', () => {
    expect(clampFillSetting('contiguous', true)).toBe(true);
    expect(clampFillSetting('contiguous', false)).toBe(false);
  });
});
