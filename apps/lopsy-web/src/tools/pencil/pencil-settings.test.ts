import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PENCIL_SETTINGS,
  clampPencilSetting,
  type PencilSettings,
} from './pencil-settings';

describe('pencil-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag value', () => {
    const defaults: PencilSettings = DEFAULT_PENCIL_SETTINGS;
    expect(defaults).toEqual({ size: 1 });
  });

  it('clampPencilSetting clamps size into [1, 5000]', () => {
    expect(clampPencilSetting('size', 0)).toBe(1);
    expect(clampPencilSetting('size', -10)).toBe(1);
    expect(clampPencilSetting('size', 1)).toBe(1);
    expect(clampPencilSetting('size', 100)).toBe(100);
    expect(clampPencilSetting('size', 5000)).toBe(5000);
    expect(clampPencilSetting('size', 99999)).toBe(5000);
  });
});
