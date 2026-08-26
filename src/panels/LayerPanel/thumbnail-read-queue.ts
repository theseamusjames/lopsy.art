/**
 * Coalescing idle-time queue for GPU thumbnail readbacks.
 *
 * `readLayerThumbnail` is a synchronous `glReadPixels` — the bytes are
 * tiny (24*24*4 = 2304), but the read forces a GPU pipeline flush, so it
 * blocks on every queued draw call the compositor still has in flight.
 * Firing it from a `useEffect` that reacts to a pixel-version bump lands
 * the stall on the frame right after the user lifts the pen (#741).
 *
 * This module batches those requests. Each `requestThumbnailRead` adds a
 * layer id to a queue and dedups against any prior pending request for
 * the same id — only the most-recent callback and size survive. When the
 * browser is idle (or after a short timeout on browsers without
 * `requestIdleCallback`), every queued layer is read back in a single
 * tick. The first read pays the pipeline sync; the rest complete in a
 * fraction of a millisecond because the GPU is already drained.
 */

import { readLayerThumbnail } from '../../engine-wasm/gpu-pixel-access';

type ThumbnailCallback = (thumb: ImageData | null) => void;

interface QueuedRead {
  size: number;
  cb: ThumbnailCallback;
}

type IdleHandle = { kind: 'idle'; id: number } | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

interface WindowWithIdle {
  requestIdleCallback?: (
    cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    opts?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
}

function scheduleFlush(cb: () => void, timeout: number): IdleHandle {
  const w = globalThis as unknown as WindowWithIdle;
  if (typeof w.requestIdleCallback === 'function') {
    return { kind: 'idle', id: w.requestIdleCallback(() => cb(), { timeout }) };
  }
  return { kind: 'timeout', id: setTimeout(cb, Math.max(0, timeout)) };
}

function cancelFlush(handle: IdleHandle): void {
  if (handle.kind === 'idle') {
    const w = globalThis as unknown as WindowWithIdle;
    w.cancelIdleCallback?.(handle.id);
    return;
  }
  clearTimeout(handle.id);
}

const pending = new Map<string, QueuedRead>();
let scheduled: IdleHandle | null = null;

function flush(): void {
  scheduled = null;
  if (pending.size === 0) return;
  // Snapshot then clear so callbacks that re-request a read (retry on
  // null) queue for the next tick instead of the current flush.
  const entries: Array<[string, QueuedRead]> = [];
  for (const entry of pending) entries.push(entry);
  pending.clear();
  for (const [layerId, req] of entries) {
    let thumb: ImageData | null = null;
    try {
      thumb = readLayerThumbnail(layerId, req.size);
    } catch (e) {
      console.error('[Lopsy] thumbnail readback failed:', e);
      thumb = null;
    }
    try {
      req.cb(thumb);
    } catch (e) {
      console.error('[Lopsy] thumbnail callback failed:', e);
    }
  }
}

/**
 * Queue a thumbnail readback for the given layer. If a read is already
 * pending for `layerId`, the earlier request is dropped and only the
 * latest `size` and `cb` are used.
 *
 * Reads run on the next idle callback (or after a short timeout as
 * fallback). If the queue is empty, one flush is scheduled.
 */
export function requestThumbnailRead(layerId: string, size: number, cb: ThumbnailCallback): void {
  pending.set(layerId, { size, cb });
  if (scheduled === null) {
    scheduled = scheduleFlush(flush, 200);
  }
}

/** Drop a pending read for the given layer id. */
export function cancelThumbnailRead(layerId: string): void {
  pending.delete(layerId);
  if (pending.size === 0 && scheduled !== null) {
    cancelFlush(scheduled);
    scheduled = null;
  }
}

/** Test-only: number of layers with a queued read. */
export function pendingThumbnailReadCount(): number {
  return pending.size;
}

/** Test-only: drop all queued reads and any scheduled flush. */
export function __resetThumbnailReadQueueForTest(): void {
  if (scheduled !== null) {
    cancelFlush(scheduled);
    scheduled = null;
  }
  pending.clear();
}
