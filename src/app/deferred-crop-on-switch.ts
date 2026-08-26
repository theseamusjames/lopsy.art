/**
 * Off-render-path scheduler for `cropLayerToContent` on layer switch.
 *
 * The crop is a 61 MB GPU→CPU readback and 16-million-pixel alpha scan at
 * 4K (#740). Running it inline on the switch frame stalls the frame the
 * user just clicked. This module defers each crop to `requestIdleCallback`
 * (with a `setTimeout` fallback) and cancels any pending crop for a layer
 * as soon as the user activates it again — so a bounce off and back never
 * pays the cost, and the crop never runs mid-edit.
 *
 * At most one crop is queued per layer id at any time; re-scheduling a
 * layer that already has one pending drops the earlier callback in favour
 * of the new one.
 */

type IdleHandle = { kind: 'idle'; id: number } | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

interface WindowWithIdle {
  requestIdleCallback?: (
    cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    opts?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
}

function scheduleIdle(cb: () => void, timeout: number): IdleHandle {
  const w = globalThis as unknown as WindowWithIdle;
  if (typeof w.requestIdleCallback === 'function') {
    return { kind: 'idle', id: w.requestIdleCallback(() => cb(), { timeout }) };
  }
  return { kind: 'timeout', id: setTimeout(cb, Math.max(0, Math.min(timeout, 1000))) };
}

function cancelIdle(handle: IdleHandle): void {
  if (handle.kind === 'idle') {
    const w = globalThis as unknown as WindowWithIdle;
    w.cancelIdleCallback?.(handle.id);
    return;
  }
  clearTimeout(handle.id);
}

const pending = new Map<string, IdleHandle>();

/** Schedule a crop for `layerId`. Cancels any prior pending crop for the same id. */
export function scheduleDeferredCrop(layerId: string, run: () => void): void {
  cancelDeferredCropIfPending(layerId);
  const handle = scheduleIdle(() => {
    pending.delete(layerId);
    try {
      run();
    } catch (e) {
      console.error('[Lopsy] deferred layer crop failed:', e);
    }
  }, 500);
  pending.set(layerId, handle);
}

/** Cancel a pending crop for `layerId`. Returns true if one was queued. */
export function cancelDeferredCropIfPending(layerId: string): boolean {
  const handle = pending.get(layerId);
  if (handle === undefined) return false;
  cancelIdle(handle);
  pending.delete(layerId);
  return true;
}

/** Test-only: number of currently-queued crops. */
export function pendingDeferredCropCount(): number {
  return pending.size;
}

/** Test-only: drop all queued crops. */
export function __resetDeferredCropForTest(): void {
  for (const handle of pending.values()) {
    cancelIdle(handle);
  }
  pending.clear();
}
