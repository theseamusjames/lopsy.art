import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPRAY_SETTINGS,
  clampSpraySetting,
  type SpraySettings,
} from './spray-settings';

describe('DEFAULT_SPRAY_SETTINGS', () => {
  it('matches the documented per-tool defaults', () => {
    expect(DEFAULT_SPRAY_SETTINGS).toEqual<SpraySettings>({
      size: 40,
      density: 20,
      opacity: 60,
      hardness: 30,
    });
  });
});

describe('clampSpraySetting', () => {
  it('clamps size into [1, 5000]', () => {
    expect(clampSpraySetting('size', 0)).toBe(1);
    expect(clampSpraySetting('size', -10)).toBe(1);
    expect(clampSpraySetting('size', 250)).toBe(250);
    expect(clampSpraySetting('size', 99999)).toBe(5000);
  });

  it('clamps density into [1, 100]', () => {
    expect(clampSpraySetting('density', 0)).toBe(1);
    expect(clampSpraySetting('density', -5)).toBe(1);
    expect(clampSpraySetting('density', 25)).toBe(25);
    expect(clampSpraySetting('density', 1000)).toBe(100);
  });

  it('clamps opacity into [1, 100] — never 0, no silent no-op strokes', () => {
    // Same shape as the eraser/healing/brush percent setters: a caller
    // passing 0 (or a normalised 0–1 value) gets the floor 1 back, so the
    // GPU dispatch never emits a silently invisible spray.
    expect(clampSpraySetting('opacity', 0)).toBe(1);
    expect(clampSpraySetting('opacity', -5)).toBe(1);
    expect(clampSpraySetting('opacity', 0.5)).toBe(1);
    expect(clampSpraySetting('opacity', 60)).toBe(60);
    expect(clampSpraySetting('opacity', 250)).toBe(100);
  });

  it('clamps hardness into [0, 100] — 0 is the legitimate softest floor', () => {
    expect(clampSpraySetting('hardness', 0)).toBe(0);
    expect(clampSpraySetting('hardness', -10)).toBe(0);
    expect(clampSpraySetting('hardness', 30)).toBe(30);
    expect(clampSpraySetting('hardness', 250)).toBe(100);
  });

  it('preserves sub-integer precision for slider drags', () => {
    expect(clampSpraySetting('size', 12.7)).toBeCloseTo(12.7);
    expect(clampSpraySetting('density', 47.3)).toBeCloseTo(47.3);
  });
});
