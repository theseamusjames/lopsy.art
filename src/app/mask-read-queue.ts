/**
 * Deferred queue for layer-mask GPU readbacks.
 *
 * `readMaskTexture` is a synchronous `glReadPixels` that forces a GPU
 * pipeline flush. A full-canvas mask stroke queues a lot of GPU work
 * (dab batches + full-frame composites); if the readback fires before
 * that queue drains, it blocks the main thread for the entire time the
 * GPU is still catching up — 2–2.7 s on a 4K canvas (#756, #760). A
 * fixed 200 ms `requestIdleCallback` timeout does not help: the browser
 * hits the timeout long before the GPU is done and the read stalls
 * anyway (#760).
 *
 * The bytes are only needed on the JS side for the mask thumbnail,
 * project save, PSD export, and duplicating a masked layer. None of these
 * need the current frame — and since #780 neither undo (history holds GPU
 * mask snapshots) nor the next mask stroke (it paints into the GPU mask)
 * needs them at all. This module waits for a stretch of quiet animation
 * frames — the browser only paces rAF at ~16 ms when it is *not* waiting
 * on the GPU, so a run of quick frames is a reliable proxy for "GPU has
 * caught up". When the app stays busy, a hard cap fires the read anyway.
 *
 * `mask-data-sync.ts` owns the layer-mask use of this queue, including
 * the on-demand `materializeMaskData` for readers that need current bytes.
 */

export type MaskReader = () => Uint8ClampedArray | null;
export type MaskCallback = (data: Uint8ClampedArray) => void;

interface QueuedRead {
  reader: MaskReader;
  cb: MaskCallback;
}

/**
 * rAF frame duration considered "quiet". At 60 fps the browser paces
 * rAF at ~16.7 ms; when the GPU is bottlenecked, the browser waits
 * for it and the observed rAF-to-rAF gap grows. 32 ms comfortably
 * covers a paced 60 fps frame plus jitter without letting a stalled
 * frame slip through.
 */
const QUIET_FRAME_MS = 32;
/** Consecutive quiet frames before the read fires. */
const QUIET_FRAMES_NEEDED = 2;
/** Hard cap so a persistently busy app still gets a read eventually. */
const MAX_WAIT_MS = 3000;
/**
 * Fallback delay used when neither rAF nor setTimeout are available in
 * a useful form — matches the previous behavior so existing callers do
 * not observe a regression in edge cases.
 */
const FALLBACK_DELAY_MS = 200;

interface WindowWithRaf {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
}

interface Handle {
  cancel: () => void;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Wait until rAF has been steady for `QUIET_FRAMES_NEEDED` consecutive
 * frames or `MAX_WAIT_MS` elapses, then call `cb`. Falls back to a
 * simple setTimeout when rAF is unavailable (Node, tests, workers).
 */
function scheduleFlush(cb: () => void): Handle {
  const w = globalThis as unknown as WindowWithRaf;
  const raf = w.requestAnimationFrame;
  const cancelRaf = w.cancelAnimationFrame;

  const startedAt = now();

  if (typeof raf !== 'function') {
    const id = setTimeout(cb, FALLBACK_DELAY_MS);
    return { cancel: () => clearTimeout(id) };
  }

  let rafId: number | null = null;
  let cancelled = false;
  let lastFrame = -1;
  let quietFrames = 0;

  const tick = (t: number): void => {
    if (cancelled) return;
    rafId = null;
    if (lastFrame >= 0) {
      const gap = t - lastFrame;
      if (gap <= QUIET_FRAME_MS) {
        quietFrames++;
      } else {
        quietFrames = 0;
      }
    }
    lastFrame = t;
    const elapsed = now() - startedAt;
    if (quietFrames >= QUIET_FRAMES_NEEDED || elapsed >= MAX_WAIT_MS) {
      cb();
      return;
    }
    rafId = raf.call(w, tick);
  };

  rafId = raf.call(w, tick);
  return {
    cancel: () => {
      cancelled = true;
      if (rafId !== null && typeof cancelRaf === 'function') cancelRaf.call(w, rafId);
      rafId = null;
    },
  };
}

const pending = new Map<string, QueuedRead>();
let scheduled: Handle | null = null;

function drainOne(layerId: string): void {
  const entry = pending.get(layerId);
  if (!entry) return;
  pending.delete(layerId);
  if (pending.size === 0 && scheduled !== null) {
    scheduled.cancel();
    scheduled = null;
  }
  let data: Uint8ClampedArray | null = null;
  try {
    data = entry.reader();
  } catch (e) {
    console.error('[Lopsy] mask readback failed:', e);
    return;
  }
  if (!data) return;
  try {
    entry.cb(data);
  } catch (e) {
    console.error('[Lopsy] mask readback callback failed:', e);
  }
}

function flushAll(): void {
  scheduled = null;
  if (pending.size === 0) return;
  const ids: string[] = [];
  for (const id of pending.keys()) ids.push(id);
  for (const id of ids) drainOne(id);
}

/**
 * Enqueue a mask readback for `layerId`. If a read is already queued
 * for the same layer, the earlier request is dropped and only the
 * latest reader/callback are used. The read fires once the browser's
 * rAF loop has been steady for a few frames (a proxy for the GPU
 * having caught up with its backlog), or `MAX_WAIT_MS` at latest.
 */
export function requestMaskRead(
  layerId: string,
  reader: MaskReader,
  cb: MaskCallback,
): void {
  pending.set(layerId, { reader, cb });
  if (scheduled === null) {
    scheduled = scheduleFlush(flushAll);
  }
}

/** Synchronously drain the queued read (if any) for `layerId`. */
export function flushPendingMaskRead(layerId: string): void {
  if (!pending.has(layerId)) return;
  drainOne(layerId);
}

/** Synchronously drain every queued read. */
export function flushAllPendingMaskReads(): void {
  if (pending.size === 0) return;
  const handle = scheduled;
  scheduled = null;
  if (handle) handle.cancel();
  const ids: string[] = [];
  for (const id of pending.keys()) ids.push(id);
  for (const id of ids) drainOne(id);
}

/** Drop a queued read without running it (e.g. layer was deleted). */
export function cancelMaskRead(layerId: string): void {
  if (!pending.delete(layerId)) return;
  if (pending.size === 0 && scheduled !== null) {
    scheduled.cancel();
    scheduled = null;
  }
}

/** Test-only: number of queued readbacks. */
export function pendingMaskReadCount(): number {
  return pending.size;
}

/** Test-only: reset everything without running any callbacks. */
export function __resetMaskReadQueueForTest(): void {
  if (scheduled !== null) {
    scheduled.cancel();
    scheduled = null;
  }
  pending.clear();
}
