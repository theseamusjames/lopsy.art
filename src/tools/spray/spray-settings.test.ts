import { describe, it, expect } from 'vitest';
import { clampSpraySetting, DEFAULT_SPRAY_SETTINGS } from './spray-settings';

describe('spray-settings', () => {
  it('defaults match the legacy flat-store spray defaults', () => {
    expect(DEFAULT_SPRAY_SETTINGS).toEqual({
      size: 40,
      density: 20,
      opacity: 60,
      hardness: 30,
    });
  });

  it('clamps size into [1, 5000]', () => {
    expect(clampSpraySetting('size', 0)).toBe(1);
    expect(clampSpraySetting('size', 1)).toBe(1);
    expect(clampSpraySetting('size', 40)).toBe(40);
    expect(clampSpraySetting('size', 5000)).toBe(5000);
    expect(clampSpraySetting('size', 99999)).toBe(5000);
  });

  it('clamps density into [1, 100]', () => {
    expect(clampSpraySetting('density', 0)).toBe(1);
    expect(clampSpraySetting('density', 1)).toBe(1);
    expect(clampSpraySetting('density', 50)).toBe(50);
    expect(clampSpraySetting('density', 100)).toBe(100);
    expect(clampSpraySetting('density', 9999)).toBe(100);
  });

  it('clamps opacity into [1, 100] — 0 would be a no-op stroke', () => {
    // Legacy setSprayOpacity used [1, 100] not [0, 100]; preserve that.
    // The percent-vs-normalised warn-once dedupe lives at the store
    // edge (setSpraySetting) because it needs setter-name context, so
    // the clamp helper itself is value-only.
    expect(clampSpraySetting('opacity', -10)).toBe(1);
    expect(clampSpraySetting('opacity', 0)).toBe(1);
    expect(clampSpraySetting('opacity', 60)).toBe(60);
    expect(clampSpraySetting('opacity', 100)).toBe(100);
    expect(clampSpraySetting('opacity', 999)).toBe(100);
  });

  it('clamps hardness into [0, 100] — surfaced as "Softness" with min 0', () => {
    expect(clampSpraySetting('hardness', -10)).toBe(0);
    expect(clampSpraySetting('hardness', 0)).toBe(0);
    expect(clampSpraySetting('hardness', 50)).toBe(50);
    expect(clampSpraySetting('hardness', 100)).toBe(100);
    expect(clampSpraySetting('hardness', 999)).toBe(100);
  });
});
