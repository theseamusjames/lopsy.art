import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DODGE_SETTINGS,
  clampDodgeSetting,
  type DodgeSettings,
} from './dodge-settings';

describe('dodge-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_DODGE_SETTINGS).toEqual({
      mode: 'dodge',
      exposure: 50,
    } satisfies DodgeSettings);
  });

  it('clamps exposure into [1, 100]', () => {
    // Range starts at 1, not 0 — a 0 here would silently produce a
    // no-op dodge stroke, the same percent-vs-normalised footgun
    // guarded for opacity setters by the warn-once dedupe.
    expect(clampDodgeSetting('exposure', -10)).toBe(1);
    expect(clampDodgeSetting('exposure', 0)).toBe(1);
    expect(clampDodgeSetting('exposure', 200)).toBe(100);
    expect(clampDodgeSetting('exposure', 50)).toBe(50);
    expect(clampDodgeSetting('exposure', 1)).toBe(1);
    expect(clampDodgeSetting('exposure', 100)).toBe(100);
  });

  it('passes mode through untouched', () => {
    expect(clampDodgeSetting('mode', 'dodge')).toBe('dodge');
    expect(clampDodgeSetting('mode', 'burn')).toBe('burn');
  });

  it('does not round exposure — preserves fractional values inside the range', () => {
    expect(clampDodgeSetting('exposure', 42.5)).toBe(42.5);
    expect(clampDodgeSetting('exposure', 75.25)).toBe(75.25);
  });
});
