import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scheduleDeferredCrop,
  cancelDeferredCropIfPending,
  pendingDeferredCropCount,
  __resetDeferredCropForTest,
} from './deferred-crop-on-switch';

describe('deferred-crop-on-switch', () => {
  beforeEach(() => {
    __resetDeferredCropForTest();
    vi.useFakeTimers();
    // Force the setTimeout fallback path — no requestIdleCallback in jsdom.
    (globalThis as Record<string, unknown>).requestIdleCallback = undefined;
    (globalThis as Record<string, unknown>).cancelIdleCallback = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetDeferredCropForTest();
  });

  it('runs the callback on the idle deadline, not synchronously', () => {
    const run = vi.fn();
    scheduleDeferredCrop('a', run);
    // The crop must NEVER run inline on the render frame that scheduled it —
    // that was the whole point of #740's stall.
    expect(run).not.toHaveBeenCalled();
    expect(pendingDeferredCropCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(pendingDeferredCropCount()).toBe(0);
  });

  it('re-scheduling the same layer replaces the pending callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    scheduleDeferredCrop('a', first);
    scheduleDeferredCrop('a', second);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancelDeferredCropIfPending drops a queued callback and reports it', () => {
    const run = vi.fn();
    scheduleDeferredCrop('a', run);
    expect(cancelDeferredCropIfPending('a')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    expect(pendingDeferredCropCount()).toBe(0);
  });

  it('cancelDeferredCropIfPending returns false when nothing is queued', () => {
    expect(cancelDeferredCropIfPending('missing')).toBe(false);
  });

  it('cancels for the given layer only', () => {
    const runA = vi.fn();
    const runB = vi.fn();
    scheduleDeferredCrop('a', runA);
    scheduleDeferredCrop('b', runB);
    expect(cancelDeferredCropIfPending('a')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(runA).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it('swallows a callback error without leaking a pending entry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    scheduleDeferredCrop('a', () => {
      throw new Error('boom');
    });
    vi.advanceTimersByTime(1000);
    expect(pendingDeferredCropCount()).toBe(0);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
