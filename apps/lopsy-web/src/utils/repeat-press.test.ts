import { describe, expect, it } from 'vitest';
import { createRepeatPressDetector, REPEAT_PRESS_MS } from './repeat-press';

describe('createRepeatPressDetector', () => {
  it('treats the first press as fresh', () => {
    const isRepeat = createRepeatPressDetector();
    expect(isRepeat({ time: 0, x: 10, y: 10 })).toBe(false);
  });

  it('flags a quick second press at the same spot', () => {
    const isRepeat = createRepeatPressDetector();
    isRepeat({ time: 0, x: 10, y: 10 });
    expect(isRepeat({ time: 120, x: 11, y: 10 })).toBe(true);
  });

  it('treats a slow second press as fresh', () => {
    const isRepeat = createRepeatPressDetector();
    isRepeat({ time: 0, x: 10, y: 10 });
    expect(isRepeat({ time: REPEAT_PRESS_MS + 1, x: 10, y: 10 })).toBe(false);
  });

  it('treats a quick press elsewhere as fresh', () => {
    const isRepeat = createRepeatPressDetector();
    isRepeat({ time: 0, x: 10, y: 10 });
    expect(isRepeat({ time: 50, x: 40, y: 10 })).toBe(false);
  });

  it('measures each press against the one before it', () => {
    const isRepeat = createRepeatPressDetector();
    isRepeat({ time: 0, x: 10, y: 10 });
    isRepeat({ time: 400, x: 10, y: 10 });
    expect(isRepeat({ time: 800, x: 10, y: 10 })).toBe(true);
  });
});
