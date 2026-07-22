/**
 * Coalesce keyboard-nudge accumulation across a key-hold.
 *
 * Holding an arrow key fires ~15–30 `keydown` auto-repeat events per second.
 * Each one previously ran a full-document CPU mask rebuild and a
 * full-document GPU mask upload (issue #684). Rendering only shows the final
 * position per frame, so applying every event is pure waste — and it also
 * spammed the undo stack with one entry per repeat.
 *
 * This module accumulates dx/dy across all events that arrive between two
 * animation frames and applies them once, and pushes one history entry per
 * key-hold rather than per event.
 */

import { useEditorStore } from '../editor-store';

type ApplyFn = (dx: number, dy: number) => void;

let pendingDx = 0;
let pendingDy = 0;
let rafId: number | null = null;
let pendingApply: ApplyFn | null = null;
let pushedHistory = false;
const heldArrows = new Set<string>();

function schedule(): void {
  if (rafId !== null) return;
  rafId = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(run)
    : (setTimeout(() => run(), 16) as unknown as number);
}

function cancelScheduled(): void {
  if (rafId === null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  else clearTimeout(rafId as unknown as ReturnType<typeof setTimeout>);
  rafId = null;
}

function run(): void {
  rafId = null;
  const dx = pendingDx;
  const dy = pendingDy;
  const apply = pendingApply;
  pendingDx = 0;
  pendingDy = 0;
  if (!apply || (dx === 0 && dy === 0)) return;
  apply(dx, dy);
}

/**
 * Queue a nudge for the current animation frame. Multiple calls in the same
 * frame accumulate. `isRepeat` should be the DOM `KeyboardEvent.repeat` flag
 * — when false and no history has yet been pushed for this key-hold, one
 * "Nudge" history entry is pushed synchronously before the accumulator
 * starts collecting.
 */
export function scheduleNudge(
  key: string,
  isRepeat: boolean,
  dx: number,
  dy: number,
  apply: ApplyFn,
): void {
  heldArrows.add(key);
  if (!isRepeat && !pushedHistory) {
    useEditorStore.getState().pushHistory('Nudge');
    pushedHistory = true;
  }
  pendingDx += dx;
  pendingDy += dy;
  pendingApply = apply;
  schedule();
}

/**
 * Called on `keyup` for an arrow key. When the last held arrow releases,
 * any pending accumulator is flushed synchronously so the final position
 * isn't lost, and the "already pushed history" latch resets so the next
 * key-hold gets a fresh undo entry.
 */
export function releaseNudgeKey(key: string): void {
  if (!heldArrows.delete(key)) return;
  if (heldArrows.size > 0) return;
  cancelScheduled();
  run();
  pushedHistory = false;
  pendingApply = null;
}

/** Test seam: reset internal state without triggering an apply. */
export function _resetNudgeCoalescer(): void {
  cancelScheduled();
  pendingDx = 0;
  pendingDy = 0;
  pendingApply = null;
  pushedHistory = false;
  heldArrows.clear();
}
