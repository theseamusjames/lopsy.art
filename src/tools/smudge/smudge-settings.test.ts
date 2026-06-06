import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SMUDGE_SETTINGS,
  clampSmudgeSetting,
  type SmudgeSettings,
} from './smudge-settings';

describe('smudge-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag values', () => {
    const defaults: SmudgeSettings = DEFAULT_SMUDGE_SETTINGS;
    expect(defaults).toEqual({ size: 30, strength: 50 });
  });

  it('clampSmudgeSetting clamps size into [1, 5000]', () => {
    expect(clampSmudgeSetting('size', 0)).toBe(1);
    expect(clampSmudgeSetting('size', -10)).toBe(1);
    expect(clampSmudgeSetting('size', 1)).toBe(1);
    expect(clampSmudgeSetting('size', 100)).toBe(100);
    expect(clampSmudgeSetting('size', 5000)).toBe(5000);
    expect(clampSmudgeSetting('size', 99999)).toBe(5000);
  });

  it('clampSmudgeSetting clamps strength into [0, 100]', () => {
    expect(clampSmudgeSetting('strength', -10)).toBe(0);
    expect(clampSmudgeSetting('strength', 0)).toBe(0);
    expect(clampSmudgeSetting('strength', 50)).toBe(50);
    expect(clampSmudgeSetting('strength', 100)).toBe(100);
    expect(clampSmudgeSetting('strength', 9999)).toBe(100);
  });
});
