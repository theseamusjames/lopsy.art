import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestThumbnailRead,
  cancelThumbnailRead,
  pendingThumbnailReadCount,
  __resetThumbnailReadQueueForTest,
} from './thumbnail-read-queue';

function mkThumb(): ImageData {
  return { data: new Uint8ClampedArray(24 * 24 * 4), width: 24, height: 24 } as ImageData;
}

describe('thumbnail-read-queue', () => {
  beforeEach(() => {
    __resetThumbnailReadQueueForTest();
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).requestIdleCallback = undefined;
    (globalThis as Record<string, unknown>).cancelIdleCallback = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetThumbnailReadQueueForTest();
  });

  it('does not fire the readback synchronously — the pipeline stall must land off-frame', () => {
    const reader = vi.fn(() => mkThumb());
    const cb = vi.fn();
    requestThumbnailRead('a', reader, cb);
    // The whole point of #741: this call must not run before the browser is idle.
    expect(reader).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(pendingThumbnailReadCount()).toBe(1);
  });

  it('coalesces bursts across keys into a single flush tick', () => {
    const readerA = vi.fn(() => mkThumb());
    const readerB = vi.fn(() => mkThumb());
    const readerC = vi.fn(() => mkThumb());
    const cbA = vi.fn();
    const cbB = vi.fn();
    const cbC = vi.fn();
    requestThumbnailRead('a', readerA, cbA);
    requestThumbnailRead('b', readerB, cbB);
    requestThumbnailRead('c', readerC, cbC);
    expect(pendingThumbnailReadCount()).toBe(3);
    vi.advanceTimersByTime(300);
    expect(readerA).toHaveBeenCalledTimes(1);
    expect(readerB).toHaveBeenCalledTimes(1);
    expect(readerC).toHaveBeenCalledTimes(1);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbC).toHaveBeenCalledTimes(1);
    expect(pendingThumbnailReadCount()).toBe(0);
  });

  it('dedupes: re-requesting the same key keeps only the latest reader and callback', () => {
    const firstReader = vi.fn(() => mkThumb());
    const secondReader = vi.fn(() => mkThumb());
    const first = vi.fn();
    const second = vi.fn();
    requestThumbnailRead('a', firstReader, first);
    requestThumbnailRead('a', secondReader, second);
    vi.advanceTimersByTime(300);
    expect(firstReader).not.toHaveBeenCalled();
    expect(secondReader).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  // #747: five channel thumbnails (RGB + R/G/B/A) share the same layer id,
  // so a bare layer-id key would collapse them to one. The composite key
  // must keep all five distinct entries.
  it('keeps distinct entries for composite keys sharing a layer id', () => {
    const cbs = new Map<string, ReturnType<typeof vi.fn>>();
    for (const channel of ['rgb', 'r', 'g', 'b', 'a']) {
      const cb = vi.fn();
      cbs.set(channel, cb);
      requestThumbnailRead(`layer-1:${channel}`, () => mkThumb(), cb);
    }
    expect(pendingThumbnailReadCount()).toBe(5);
    vi.advanceTimersByTime(300);
    for (const cb of cbs.values()) expect(cb).toHaveBeenCalledTimes(1);
    expect(pendingThumbnailReadCount()).toBe(0);
  });

  it('cancelThumbnailRead drops the pending read for that key', () => {
    const reader = vi.fn(() => mkThumb());
    const cb = vi.fn();
    requestThumbnailRead('a', reader, cb);
    cancelThumbnailRead('a');
    vi.advanceTimersByTime(300);
    expect(reader).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it('passes null through when the reader returns null', () => {
    const reader = vi.fn(() => null);
    const cb = vi.fn();
    requestThumbnailRead('a', reader, cb);
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('re-requests scheduled from inside a callback go on the next tick, not the current flush', () => {
    let call = 0;
    const reader = vi.fn(() => (call++ === 0 ? null : mkThumb()));
    let attempts = 0;
    const cb = vi.fn((thumb: ImageData | null) => {
      attempts++;
      if (thumb === null && attempts === 1) {
        requestThumbnailRead('a', reader, cb);
      }
    });
    requestThumbnailRead('a', reader, cb);
    vi.advanceTimersByTime(300);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(pendingThumbnailReadCount()).toBe(1);
    vi.advanceTimersByTime(300);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(attempts).toBe(2);
  });

  it('a thrown reader still fires the callback with null and does not block other reads', () => {
    const badReader = vi.fn(() => { throw new Error('boom'); });
    const goodReader = vi.fn(() => mkThumb());
    const badCb = vi.fn();
    const goodCb = vi.fn();
    // Suppress console.error noise for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      requestThumbnailRead('bad', badReader, badCb);
      requestThumbnailRead('good', goodReader, goodCb);
      vi.advanceTimersByTime(300);
      expect(badCb).toHaveBeenCalledWith(null);
      expect(goodCb).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
