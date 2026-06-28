import { describe, it, expect } from 'vitest';
import { clampQuickSelectSetting, DEFAULT_QUICK_SELECT_SETTINGS } from './quick-select-settings';

describe('quick-select-settings', () => {
  it('defaults match the legacy flat-store quick-select defaults', () => {
    expect(DEFAULT_QUICK_SELECT_SETTINGS).toEqual({
      size: 20,
      tolerance: 32,
      edgeStrength: 50,
      mode: 'add',
    });
  });

  it('clamps size into [1, 100] and rounds', () => {
    expect(clampQuickSelectSetting('size', 0)).toBe(1);
    expect(clampQuickSelectSetting('size', -100)).toBe(1);
    expect(clampQuickSelectSetting('size', 1)).toBe(1);
    expect(clampQuickSelectSetting('size', 50)).toBe(50);
    expect(clampQuickSelectSetting('size', 100)).toBe(100);
    expect(clampQuickSelectSetting('size', 999)).toBe(100);
    expect(clampQuickSelectSetting('size', 12.4)).toBe(12);
    expect(clampQuickSelectSetting('size', 12.6)).toBe(13);
  });

  it('clamps tolerance into the 0–255 byte range (not 0–100 percent) and rounds', () => {
    // Tolerance lives in the same units as RGBA channels because the
    // stroke compares pixel deltas against it directly.
    expect(clampQuickSelectSetting('tolerance', -10)).toBe(0);
    expect(clampQuickSelectSetting('tolerance', 0)).toBe(0);
    expect(clampQuickSelectSetting('tolerance', 128)).toBe(128);
    expect(clampQuickSelectSetting('tolerance', 255)).toBe(255);
    expect(clampQuickSelectSetting('tolerance', 9999)).toBe(255);
    expect(clampQuickSelectSetting('tolerance', 60.6)).toBe(61);
  });

  it('clamps edgeStrength into [0, 100] and rounds', () => {
    expect(clampQuickSelectSetting('edgeStrength', -10)).toBe(0);
    expect(clampQuickSelectSetting('edgeStrength', 0)).toBe(0);
    expect(clampQuickSelectSetting('edgeStrength', 50)).toBe(50);
    expect(clampQuickSelectSetting('edgeStrength', 100)).toBe(100);
    expect(clampQuickSelectSetting('edgeStrength', 999)).toBe(100);
    expect(clampQuickSelectSetting('edgeStrength', 42.3)).toBe(42);
  });

  it('normalises mode to a known tag, collapsing unknown values to add', () => {
    expect(clampQuickSelectSetting('mode', 'add')).toBe('add');
    expect(clampQuickSelectSetting('mode', 'subtract')).toBe('subtract');
    // Unknown strings collapse to 'add' rather than silently passing
    // through — guards against a typed-string @ts-ignore bypass leaving
    // the selection in an unhandled state.
    expect(
      (clampQuickSelectSetting as (k: 'mode', v: string) => string)('mode', 'replace'),
    ).toBe('add');
  });
});
