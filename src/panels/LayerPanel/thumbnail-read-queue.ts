/**
 * Coalescing idle-time queue for GPU thumbnail readbacks.
 *
 * Thumbnail readbacks (`readLayerThumbnail`, `readChannelThumbnail`) are
 * synchronous `glReadPixels` calls. The bytes are tiny — a 24×24 thumb
 * is 2304 bytes — but the read forces a GPU pipeline flush, so it blocks
 * on every queued draw call the compositor still has in flight. Firing
 * one from a `useEffect` that reacts to a pixel-version bump lands the
 * stall on the frame right after the user lifts the pen (#741). Firing
 * five (ChannelsPanel: RGB + R/G/B/A) at once pays it five times over
 * (#747).
 *
 * This module batches those requests. The caller supplies a stable
 * `key` (used to dedup — for a layer thumbnail the layer id is enough;
 * for a channel thumbnail the key must include the channel) and a
 * reader function. When the browser is idle (or after a short timeout
 * on browsers without `requestIdleCallback`), every queued reader is
 * invoked in a single tick. The first read pays the pipeline sync; the
 * rest complete in a fraction of a millisecond because the GPU is
 * already drained.
 */

type ThumbnailReader = () => ImageData | null;
type ThumbnailCallback = (thumb: ImageData | null) => void;

interface QueuedRead {
  reader: ThumbnailReader;
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
  for (const [, req] of entries) {
    let thumb: ImageData | null = null;
    try {
      thumb = req.reader();
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
 * Queue a thumbnail readback. If a read is already pending for `key`,
 * the earlier request is dropped and only the latest reader and cb are
 * used. The key must uniquely identify the readback — for a per-layer
 * thumbnail the layer id is enough; for a per-channel thumbnail the
 * key must also include the channel (e.g. `${layerId}:${channel}`).
 *
 * Reads run on the next idle callback (or after a short timeout as
 * fallback). If the queue is empty, one flush is scheduled.
 */
export function requestThumbnailRead(
  key: string,
  reader: ThumbnailReader,
  cb: ThumbnailCallback,
): void {
  pending.set(key, { reader, cb });
  if (scheduled === null) {
    scheduled = scheduleFlush(flush, 200);
  }
}

/** Drop a pending read for the given key. */
export function cancelThumbnailRead(key: string): void {
  pending.delete(key);
  if (pending.size === 0 && scheduled !== null) {
    cancelFlush(scheduled);
    scheduled = null;
  }
}

/** Test-only: number of entries with a queued read. */
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
