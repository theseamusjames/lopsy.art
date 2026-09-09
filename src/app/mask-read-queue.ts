/**
 * Idle-time queue for layer-mask GPU readbacks.
 *
 * `readMaskTexture` is a synchronous `glReadPixels` that forces a GPU
 * pipeline flush — the transfer itself takes ~20 ms even for a 4K mask,
 * but drops onto a pointer-up frame where a full-canvas mask stroke has
 * left a backlog of compositing work behind it, blocking the main
 * thread for 15–20 s in the worst case (#756).
 *
 * The bytes are only needed on the JS side for (a) the mask thumbnail,
 * (b) history snapshots, (c) project save, and (d) subsequent mask
 * paint/fill/gradient operations that upload `layer.mask.data` back to
 * the GPU at stroke start. None of these need to happen on the same
 * frame as pointer-up. Deferring to idle lets the queued draw calls
 * drain first, so the read pays only its own cost.
 *
 * Callers that need the mask data to be current in `layer.mask.data`
 * (paint handlers about to upload it, `pushHistory` about to snapshot
 * the document, project save about to write it to disk) must call
 * `flushPendingMaskRead(layerId)` — or `flushAllPendingMaskReads()` —
 * first. Those flushes pay the readback cost synchronously, but they
 * are at moments the frame budget is already spent, not at the
 * gesture boundary.
 */

export type MaskReader = () => Uint8ClampedArray | null;
export type MaskCallback = (data: Uint8ClampedArray) => void;

interface QueuedRead {
  reader: MaskReader;
  cb: MaskCallback;
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

function cancelHandle(handle: IdleHandle): void {
  if (handle.kind === 'idle') {
    const w = globalThis as unknown as WindowWithIdle;
    w.cancelIdleCallback?.(handle.id);
    return;
  }
  clearTimeout(handle.id);
}

const pending = new Map<string, QueuedRead>();
let scheduled: IdleHandle | null = null;

function drainOne(layerId: string): void {
  const entry = pending.get(layerId);
  if (!entry) return;
  pending.delete(layerId);
  if (pending.size === 0 && scheduled !== null) {
    cancelHandle(scheduled);
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
 * latest reader/callback are used. Reads run on the next idle callback
 * (or after ~200 ms as fallback).
 */
export function requestMaskRead(
  layerId: string,
  reader: MaskReader,
  cb: MaskCallback,
): void {
  pending.set(layerId, { reader, cb });
  if (scheduled === null) {
    scheduled = scheduleFlush(flushAll, 200);
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
  if (handle) cancelHandle(handle);
  const ids: string[] = [];
  for (const id of pending.keys()) ids.push(id);
  for (const id of ids) drainOne(id);
}

/** Drop a queued read without running it (e.g. layer was deleted). */
export function cancelMaskRead(layerId: string): void {
  if (!pending.delete(layerId)) return;
  if (pending.size === 0 && scheduled !== null) {
    cancelHandle(scheduled);
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
    cancelHandle(scheduled);
    scheduled = null;
  }
  pending.clear();
}
