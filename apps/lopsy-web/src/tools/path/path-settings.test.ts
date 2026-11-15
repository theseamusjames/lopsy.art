import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PATH_SETTINGS,
  clampPathSetting,
  type PathSettings,
} from './path-settings';

describe('path-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag value', () => {
    const defaults: PathSettings = DEFAULT_PATH_SETTINGS;
    expect(defaults).toEqual({ strokeWidth: 2 });
  });

  it('clampPathSetting clamps strokeWidth into [1, 50]', () => {
    expect(clampPathSetting('strokeWidth', 0)).toBe(1);
    expect(clampPathSetting('strokeWidth', -10)).toBe(1);
    expect(clampPathSetting('strokeWidth', 1)).toBe(1);
    expect(clampPathSetting('strokeWidth', 25)).toBe(25);
    expect(clampPathSetting('strokeWidth', 50)).toBe(50);
    expect(clampPathSetting('strokeWidth', 9999)).toBe(50);
  });
});
