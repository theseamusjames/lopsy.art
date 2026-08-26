import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readLayerThumbnail = vi.fn((_layerId: string, _size: number): ImageData | null => null);

vi.mock('../../engine-wasm/gpu-pixel-access', () => ({
  readLayerThumbnail: (layerId: string, size: number) => readLayerThumbnail(layerId, size),
}));

// Import AFTER the mock so the queue captures the mocked function.
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
    readLayerThumbnail.mockReset();
    readLayerThumbnail.mockReturnValue(mkThumb());
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetThumbnailReadQueueForTest();
  });

  it('does not fire the readback synchronously — the pipeline stall must land off-frame', () => {
    const cb = vi.fn();
    requestThumbnailRead('a', 24, cb);
    // The whole point of #741: this call must not run before the browser is idle.
    expect(readLayerThumbnail).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(pendingThumbnailReadCount()).toBe(1);
  });

  it('coalesces bursts across layers into a single flush tick', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    const cbC = vi.fn();
    requestThumbnailRead('a', 24, cbA);
    requestThumbnailRead('b', 24, cbB);
    requestThumbnailRead('c', 24, cbC);
    expect(pendingThumbnailReadCount()).toBe(3);
    vi.advanceTimersByTime(300);
    expect(readLayerThumbnail).toHaveBeenCalledTimes(3);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbC).toHaveBeenCalledTimes(1);
    expect(pendingThumbnailReadCount()).toBe(0);
  });

  it('dedupes: re-requesting the same layer keeps only the latest callback and size', () => {
    const first = vi.fn();
    const second = vi.fn();
    requestThumbnailRead('a', 24, first);
    requestThumbnailRead('a', 48, second);
    vi.advanceTimersByTime(300);
    expect(readLayerThumbnail).toHaveBeenCalledTimes(1);
    expect(readLayerThumbnail).toHaveBeenCalledWith('a', 48);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancelThumbnailRead drops the pending read for that layer', () => {
    const cb = vi.fn();
    requestThumbnailRead('a', 24, cb);
    cancelThumbnailRead('a');
    vi.advanceTimersByTime(300);
    expect(readLayerThumbnail).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it('passes null through when the read returns null', () => {
    readLayerThumbnail.mockReturnValueOnce(null);
    const cb = vi.fn();
    requestThumbnailRead('a', 24, cb);
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('re-requests scheduled from inside a callback go on the next tick, not the current flush', () => {
    readLayerThumbnail.mockReturnValueOnce(null).mockReturnValueOnce(mkThumb());
    let attempts = 0;
    const cb = vi.fn((thumb: ImageData | null) => {
      attempts++;
      if (thumb === null && attempts === 1) {
        requestThumbnailRead('a', 24, cb);
      }
    });
    requestThumbnailRead('a', 24, cb);
    vi.advanceTimersByTime(300);
    expect(readLayerThumbnail).toHaveBeenCalledTimes(1);
    expect(pendingThumbnailReadCount()).toBe(1);
    vi.advanceTimersByTime(300);
    expect(readLayerThumbnail).toHaveBeenCalledTimes(2);
    expect(attempts).toBe(2);
  });
});
