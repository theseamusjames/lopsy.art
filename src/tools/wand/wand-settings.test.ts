import { describe, it, expect } from 'vitest';
import { clampWandSetting, DEFAULT_WAND_SETTINGS } from './wand-settings';

describe('wand-settings', () => {
  it('defaults match the legacy flat-store wand defaults', () => {
    expect(DEFAULT_WAND_SETTINGS).toEqual({
      tolerance: 32,
      contiguous: true,
      graduated: false,
    });
  });

  it('clamps tolerance into [0, 255]', () => {
    expect(clampWandSetting('tolerance', -10)).toBe(0);
    expect(clampWandSetting('tolerance', 0)).toBe(0);
    expect(clampWandSetting('tolerance', 128)).toBe(128);
    expect(clampWandSetting('tolerance', 255)).toBe(255);
    expect(clampWandSetting('tolerance', 9999)).toBe(255);
  });

  it('passes boolean settings through unchanged', () => {
    expect(clampWandSetting('contiguous', true)).toBe(true);
    expect(clampWandSetting('contiguous', false)).toBe(false);
    expect(clampWandSetting('graduated', true)).toBe(true);
    expect(clampWandSetting('graduated', false)).toBe(false);
  });
});
