import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPONGE_SETTINGS,
  clampSpongeSetting,
  type SpongeSettings,
} from './sponge-settings';

describe('sponge-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag values', () => {
    const defaults: SpongeSettings = DEFAULT_SPONGE_SETTINGS;
    expect(defaults).toEqual({ mode: 'desaturate', strength: 50, size: 30 });
  });

  it('clampSpongeSetting clamps strength into [1, 100]', () => {
    expect(clampSpongeSetting('strength', 0)).toBe(1);
    expect(clampSpongeSetting('strength', -10)).toBe(1);
    expect(clampSpongeSetting('strength', 1)).toBe(1);
    expect(clampSpongeSetting('strength', 50)).toBe(50);
    expect(clampSpongeSetting('strength', 100)).toBe(100);
    expect(clampSpongeSetting('strength', 9999)).toBe(100);
  });

  it('clampSpongeSetting clamps size into [1, 5000]', () => {
    expect(clampSpongeSetting('size', 0)).toBe(1);
    expect(clampSpongeSetting('size', -10)).toBe(1);
    expect(clampSpongeSetting('size', 1)).toBe(1);
    expect(clampSpongeSetting('size', 30)).toBe(30);
    expect(clampSpongeSetting('size', 5000)).toBe(5000);
    expect(clampSpongeSetting('size', 99999)).toBe(5000);
  });

  it('clampSpongeSetting passes the mode enum through unchanged', () => {
    expect(clampSpongeSetting('mode', 'saturate')).toBe('saturate');
    expect(clampSpongeSetting('mode', 'desaturate')).toBe('desaturate');
  });
});
