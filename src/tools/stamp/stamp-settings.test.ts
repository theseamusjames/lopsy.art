import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STAMP_SETTINGS,
  clampStampSetting,
  type StampSettings,
} from './stamp-settings';

describe('stamp-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag value', () => {
    const defaults: StampSettings = DEFAULT_STAMP_SETTINGS;
    expect(defaults).toEqual({ size: 20 });
  });

  it('clampStampSetting clamps size into [1, 5000]', () => {
    expect(clampStampSetting('size', 0)).toBe(1);
    expect(clampStampSetting('size', -10)).toBe(1);
    expect(clampStampSetting('size', 1)).toBe(1);
    expect(clampStampSetting('size', 25)).toBe(25);
    expect(clampStampSetting('size', 5000)).toBe(5000);
    expect(clampStampSetting('size', 99999)).toBe(5000);
  });
});
