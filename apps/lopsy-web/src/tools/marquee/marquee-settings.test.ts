import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MARQUEE_SETTINGS,
  clampMarqueeSetting,
  type MarqueeSettings,
} from './marquee-settings';

describe('marquee-settings (#453 per-tool slice)', () => {
  it('defaults match the legacy flat-bag values', () => {
    const defaults: MarqueeSettings = DEFAULT_MARQUEE_SETTINGS;
    expect(defaults).toEqual({ feather: 0 });
  });

  it('clampMarqueeSetting clamps feather to [0, 250]', () => {
    expect(clampMarqueeSetting('feather', -1)).toBe(0);
    expect(clampMarqueeSetting('feather', 0)).toBe(0);
    expect(clampMarqueeSetting('feather', 125)).toBe(125);
    expect(clampMarqueeSetting('feather', 250)).toBe(250);
    expect(clampMarqueeSetting('feather', 9999)).toBe(250);
  });

  it('clampMarqueeSetting rounds feather to an integer', () => {
    // The legacy setter rounds — see setMarqueeFeather in
    // tool-settings-store.ts prior to this slice. Preserve that
    // behaviour so feather values stay integer-valued downstream.
    expect(clampMarqueeSetting('feather', 10.4)).toBe(10);
    expect(clampMarqueeSetting('feather', 10.6)).toBe(11);
    expect(clampMarqueeSetting('feather', 249.7)).toBe(250);
  });
});
