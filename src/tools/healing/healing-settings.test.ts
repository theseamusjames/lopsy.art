import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HEALING_SETTINGS,
  clampHealingSetting,
  type HealingSettings,
} from './healing-settings';

describe('healing-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_HEALING_SETTINGS).toEqual({
      size: 20,
      opacity: 100,
    } satisfies HealingSettings);
  });

  it('clamps size into [1, 5000]', () => {
    expect(clampHealingSetting('size', 0)).toBe(1);
    expect(clampHealingSetting('size', -5)).toBe(1);
    expect(clampHealingSetting('size', 99999)).toBe(5000);
    expect(clampHealingSetting('size', 20)).toBe(20);
    expect(clampHealingSetting('size', 5000)).toBe(5000);
    expect(clampHealingSetting('size', 1)).toBe(1);
  });

  it('clamps opacity into [1, 100]', () => {
    // Range starts at 1, not 0 — a 0 here would silently produce a no-op
    // stroke, the same percent-vs-normalised footgun guarded by the
    // warn-once dedupe in the store.
    expect(clampHealingSetting('opacity', -10)).toBe(1);
    expect(clampHealingSetting('opacity', 0)).toBe(1);
    expect(clampHealingSetting('opacity', 200)).toBe(100);
    expect(clampHealingSetting('opacity', 50)).toBe(50);
    expect(clampHealingSetting('opacity', 1)).toBe(1);
    expect(clampHealingSetting('opacity', 100)).toBe(100);
  });

  it('does not round numeric fields — preserves fractional values inside the range', () => {
    // Sub-pixel sizes are meaningful for HDPI rendering and animations,
    // so the clamp range guards the bounds without forcing integers.
    expect(clampHealingSetting('size', 20.5)).toBe(20.5);
    expect(clampHealingSetting('opacity', 75.25)).toBe(75.25);
  });
});
