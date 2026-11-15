/** Longest gap between the presses of a double-click, in ms. */
export const REPEAT_PRESS_MS = 500;
/** Furthest the pointer may drift between the presses, in CSS px. */
export const REPEAT_PRESS_SLOP_PX = 4;

export interface PressSample {
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Tells the later presses of a multi-click from a fresh press. Chromium
 * leaves `detail` at 0 on `pointerdown`, so the click count is not available
 * when a press starts and has to be inferred from timing and position.
 */
export function createRepeatPressDetector(): (press: PressSample) => boolean {
  let last: PressSample | null = null;
  return (press) => {
    const isRepeat = last !== null
      && press.time - last.time <= REPEAT_PRESS_MS
      && Math.hypot(press.x - last.x, press.y - last.y) <= REPEAT_PRESS_SLOP_PX;
    last = press;
    return isRepeat;
  };
}
