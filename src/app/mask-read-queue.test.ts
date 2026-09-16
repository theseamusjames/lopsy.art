import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  requestMaskRead,
  flushPendingMaskRead,
  flushAllPendingMaskReads,
  cancelMaskRead,
  pendingMaskReadCount,
  __resetMaskReadQueueForTest,
} from './mask-read-queue';

describe('mask-read-queue', () => {
  beforeEach(() => {
    __resetMaskReadQueueForTest();
    vi.useFakeTimers();
    // Force the queue's setTimeout fallback path so tests can advance
    // deterministically via vi.advanceTimersByTime. rAF is not paced by
    // fake timers in jsdom, so leaving it defined would leave the queue
    // waiting on a callback that never fires.
    const g = globalThis as unknown as {
      requestIdleCallback?: unknown; cancelIdleCallback?: unknown;
      requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown;
    };
    g.requestIdleCallback = undefined;
    g.cancelIdleCallback = undefined;
    g.requestAnimationFrame = undefined;
    g.cancelAnimationFrame = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetMaskReadQueueForTest();
  });

  it('does not invoke the reader synchronously', () => {
    const reader = vi.fn(() => new Uint8ClampedArray(4));
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    expect(reader).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(pendingMaskReadCount()).toBe(1);
  });

  it('runs the read on the idle fallback timer', () => {
    const bytes = new Uint8ClampedArray([1, 2, 3, 4]);
    const reader = vi.fn(() => bytes);
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    vi.advanceTimersByTime(300);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(bytes);
    expect(pendingMaskReadCount()).toBe(0);
  });

  it('coalesces multiple requests for the same layer', () => {
    const first = vi.fn(() => new Uint8ClampedArray(4));
    const second = vi.fn(() => new Uint8ClampedArray(4));
    const firstCb = vi.fn();
    const secondCb = vi.fn();
    requestMaskRead('l1', first, firstCb);
    requestMaskRead('l1', second, secondCb);
    vi.advanceTimersByTime(300);
    expect(first).not.toHaveBeenCalled();
    expect(firstCb).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(secondCb).toHaveBeenCalledTimes(1);
  });

  it('flushPendingMaskRead runs one layer synchronously', () => {
    const bytes = new Uint8ClampedArray([9, 9, 9, 9]);
    const reader = vi.fn(() => bytes);
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    flushPendingMaskRead('l1');
    expect(reader).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(bytes);
    expect(pendingMaskReadCount()).toBe(0);
    // Subsequent timer fire is a no-op.
    vi.advanceTimersByTime(300);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('flushPendingMaskRead is a no-op when no read is queued', () => {
    flushPendingMaskRead('missing');
    expect(pendingMaskReadCount()).toBe(0);
  });

  it('flushAllPendingMaskReads drains every queued layer', () => {
    const readerA = vi.fn(() => new Uint8ClampedArray(4));
    const readerB = vi.fn(() => new Uint8ClampedArray(4));
    const cbA = vi.fn();
    const cbB = vi.fn();
    requestMaskRead('a', readerA, cbA);
    requestMaskRead('b', readerB, cbB);
    flushAllPendingMaskReads();
    expect(readerA).toHaveBeenCalledTimes(1);
    expect(readerB).toHaveBeenCalledTimes(1);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(pendingMaskReadCount()).toBe(0);
  });

  it('cancelMaskRead drops a pending read without running it', () => {
    const reader = vi.fn(() => new Uint8ClampedArray(4));
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    cancelMaskRead('l1');
    vi.advanceTimersByTime(300);
    expect(reader).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(pendingMaskReadCount()).toBe(0);
  });

  it('skips the callback when the reader returns null', () => {
    const cb = vi.fn();
    requestMaskRead('l1', () => null, cb);
    vi.advanceTimersByTime(300);
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not throw when a reader throws — the queue keeps working', () => {
    const goodCb = vi.fn();
    requestMaskRead('bad', () => { throw new Error('boom'); }, () => {});
    requestMaskRead('good', () => new Uint8ClampedArray([1, 2, 3, 4]), goodCb);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    flushAllPendingMaskReads();
    expect(goodCb).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not schedule when the queue empties from a cancel', () => {
    requestMaskRead('l1', () => new Uint8ClampedArray(4), () => {});
    cancelMaskRead('l1');
    vi.advanceTimersByTime(300);
    expect(pendingMaskReadCount()).toBe(0);
  });
});

/**
 * Issue #760 — a fixed 200 ms `requestIdleCallback` timeout fires the
 * read before the GPU has drained, so `readPixels` blocks for the full
 * 2–3 s the backlog needs to clear. The queue now polls `rAF` and only
 * fires once several consecutive frames arrive on schedule (a proxy for
 * the browser no longer waiting on the GPU). These tests drive rAF by
 * hand.
 */
describe('mask-read-queue — rAF quiescence detection (#760)', () => {
  let now = 0;
  let rafCbs: Array<(t: number) => void> = [];
  let realPerformanceNow: (() => number) | null = null;

  beforeEach(() => {
    __resetMaskReadQueueForTest();
    now = 1000;
    rafCbs = [];
    const g = globalThis as unknown as {
      requestAnimationFrame: (cb: (t: number) => void) => number;
      cancelAnimationFrame: (id: number) => void;
      requestIdleCallback?: unknown;
      cancelIdleCallback?: unknown;
    };
    g.requestIdleCallback = undefined;
    g.cancelIdleCallback = undefined;
    let next = 1;
    g.requestAnimationFrame = (cb) => {
      const id = next++;
      rafCbs.push(cb);
      return id;
    };
    g.cancelAnimationFrame = () => { /* not exercised */ };
    // The queue's hard cap uses performance.now(); anchor it to the same
    // clock the tests drive so ticks control both signals.
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      realPerformanceNow = performance.now.bind(performance);
      (performance as unknown as { now: () => number }).now = () => now;
    }
  });

  afterEach(() => {
    __resetMaskReadQueueForTest();
    const g = globalThis as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
    g.requestAnimationFrame = undefined;
    g.cancelAnimationFrame = undefined;
    if (realPerformanceNow) {
      (performance as unknown as { now: () => number }).now = realPerformanceNow;
      realPerformanceNow = null;
    }
  });

  function tick(deltaMs: number): void {
    now += deltaMs;
    const cbs = rafCbs;
    rafCbs = [];
    for (const cb of cbs) cb(now);
  }

  it('does not fire the read while frames are long (GPU is bottlenecked)', () => {
    const reader = vi.fn(() => new Uint8ClampedArray(4));
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    // Simulate slow frames (100 ms each) — quiescence never reached.
    for (let i = 0; i < 10; i++) tick(100);
    expect(reader).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(pendingMaskReadCount()).toBe(1);
  });

  it('fires the read after two consecutive quick frames', () => {
    const reader = vi.fn(() => new Uint8ClampedArray(4));
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    // First tick just records the timestamp (no delta yet), then two quiet
    // frames (~17 ms each) — the read should fire on the third.
    tick(0);
    tick(17);
    tick(17);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('quiet-frame counter resets after a long frame', () => {
    const reader = vi.fn(() => new Uint8ClampedArray(4));
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    tick(0);
    tick(17);      // 1 quiet frame
    tick(100);     // long frame — reset
    tick(17);      // 1 quiet frame — not yet enough
    expect(reader).not.toHaveBeenCalled();
    tick(17);      // 2 quiet frames — fire
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('force-fires after the 3 s hard cap even if frames stay slow', () => {
    const reader = vi.fn(() => new Uint8ClampedArray(4));
    const cb = vi.fn();
    requestMaskRead('l1', reader, cb);
    // ~30 slow frames each 100 ms → 3 s total.
    for (let i = 0; i < 32; i++) tick(100);
    expect(reader).toHaveBeenCalledTimes(1);
  });
});
