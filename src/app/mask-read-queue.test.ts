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
    // Ensure the queue picks the setTimeout fallback so tests can advance it.
    const g = globalThis as unknown as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    g.requestIdleCallback = undefined;
    g.cancelIdleCallback = undefined;
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
