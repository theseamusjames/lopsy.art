/**
 * Coalesce Cmd+Z / Cmd+Shift+Z auto-repeat across a key-hold.
 *
 * Holding Cmd+Z fires 15–30 `keydown` auto-repeat events per second. The
 * previous handler called `undo()` straight from `keydown`, so every event
 * ran a full `resetTrackedState` + `syncLayers` — re-uploading every layer
 * mask and the selection mask once per repeat. On a 4K document with 3
 * masks, six repeats moved 384 MB across the WASM bridge in ~4.6 s of
 * main-thread work (#761).
 *
 * This module accumulates the repeat count and calls `undoBy(N)` /
 * `redoBy(N)` once per animation frame. The batched history primitives
 * do one restore + one sync, so a held key pays the mask upload once
 * instead of once per step.
 */

import { useEditorStore } from '../editor-store';

type Dir = 'undo' | 'redo';

let pending: Dir | null = null;
let pendingSteps = 0;
let rafId: number | null = null;

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
  const dir = pending;
  const n = pendingSteps;
  pending = null;
  pendingSteps = 0;
  if (!dir || n <= 0) return;
  const store = useEditorStore.getState();
  if (dir === 'undo') store.undoBy(n);
  else store.redoBy(n);
}

/**
 * Queue an undo/redo step for the current animation frame. Called for both
 * the initial keydown and every auto-repeat. Multiple calls in the same
 * frame accumulate and apply once via `undoBy(N)` / `redoBy(N)`.
 */
export function scheduleUndoRedo(dir: Dir): void {
  // If the direction flipped mid-flight, apply the pending batch now so
  // the two directions don't cancel each other silently.
  if (pending && pending !== dir) {
    cancelScheduled();
    run();
  }
  pending = dir;
  pendingSteps += 1;
  schedule();
}

/** Test seam: reset internal state without triggering an apply. */
export function _resetUndoCoalescerForTest(): void {
  cancelScheduled();
  pending = null;
  pendingSteps = 0;
}
