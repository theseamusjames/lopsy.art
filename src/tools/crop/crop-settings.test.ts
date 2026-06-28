import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CROP_SETTINGS,
  clampCropSetting,
  type CropSettings,
} from './crop-settings';

describe('crop-settings clamps and defaults (#453)', () => {
  it('defaults match the values the flat-bag store carried', () => {
    expect(DEFAULT_CROP_SETTINGS).toEqual({
      mode: 'normal',
    } satisfies CropSettings);
  });

  it('passes through valid modes unchanged', () => {
    expect(clampCropSetting('mode', 'normal')).toBe('normal');
    expect(clampCropSetting('mode', 'perspective')).toBe('perspective');
  });

  it('falls back to "normal" for unknown mode values', () => {
    // The setter is typed as CropSettings['mode'] but JS callers (and
    // any `as` cast in TS) can pass anything. The clamp must reject
    // unknown values so the crop dispatcher doesn't read a state that
    // neither the rect nor the perspective handler will service.
    expect(clampCropSetting('mode', 'rect' as CropSettings['mode'])).toBe('normal');
    expect(clampCropSetting('mode', '' as CropSettings['mode'])).toBe('normal');
    expect(clampCropSetting('mode', 'free' as CropSettings['mode'])).toBe('normal');
  });
});
