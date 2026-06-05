import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DODGE_SETTINGS,
  clampDodgeSetting,
  type DodgeSettings,
} from './dodge-settings';

describe('dodge-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag values', () => {
    const defaults: DodgeSettings = DEFAULT_DODGE_SETTINGS;
    expect(defaults).toEqual({ exposure: 50, mode: 'dodge' });
  });

  it('clampDodgeSetting clamps exposure to [1, 100]', () => {
    // Legacy setDodgeExposure clamped to [1, 100] — preserve that so
    // exposure / 100 in dodge-interaction.ts stays in (0, 1].
    expect(clampDodgeSetting('exposure', -10)).toBe(1);
    expect(clampDodgeSetting('exposure', 0)).toBe(1);
    expect(clampDodgeSetting('exposure', 1)).toBe(1);
    expect(clampDodgeSetting('exposure', 50)).toBe(50);
    expect(clampDodgeSetting('exposure', 100)).toBe(100);
    expect(clampDodgeSetting('exposure', 9999)).toBe(100);
  });

  it('passes mode through unchanged', () => {
    expect(clampDodgeSetting('mode', 'dodge')).toBe('dodge');
    expect(clampDodgeSetting('mode', 'burn')).toBe('burn');
  });
});
