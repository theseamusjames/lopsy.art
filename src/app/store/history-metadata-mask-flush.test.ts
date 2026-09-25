// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const { useEditorStore } = await import('../editor-store');
const {
  requestMaskRead,
  pendingMaskReadCount,
  __resetMaskReadQueueForTest,
} = await import('../mask-read-queue');

/**
 * #782 — a metadata step (visibility toggle, add layer, reorder, …) taken
 * inside the lazy-readback window after a mask stroke snapshots a
 * `mask.data` that lags the GPU. #782 fixed the resulting undo bug by
 * draining pending mask reads in pushHistoryMetadata — a synchronous
 * glReadPixels behind the stroke's GPU backlog.
 *
 * Since #780 the undo itself is safe: restoring a metadata entry keeps
 * the live GPU mask, seeds the upload gate with the restored bytes, and
 * only schedules a refresh of the JS copy (covered in
 * mask-history.test.ts, "queues a readback on a metadata undo whose
 * snapshot bytes predate the live ones"). So the push no longer pays for
 * a readback.
 */
describe('pushHistoryMetadata does not drain pending mask reads (#782, #780)', () => {
  beforeEach(() => {
    __resetMaskReadQueueForTest();
    vi.useFakeTimers();
    const g = globalThis as unknown as {
      requestIdleCallback?: unknown; cancelIdleCallback?: unknown;
      requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown;
    };
    g.requestIdleCallback = undefined;
    g.cancelIdleCallback = undefined;
    g.requestAnimationFrame = undefined;
    g.cancelAnimationFrame = undefined;
    useEditorStore.getState().createDocument(10, 10, false);
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetMaskReadQueueForTest();
  });

  it('leaves the queued mask read for the idle queue', () => {
    const reader = vi.fn(() => new Uint8ClampedArray([9, 9, 9, 9]));
    const cb = vi.fn();
    requestMaskRead('layer-1', reader, cb);
    expect(pendingMaskReadCount()).toBe(1);

    useEditorStore.getState().pushHistoryMetadata('Toggle Visibility');

    expect(reader).not.toHaveBeenCalled();
    expect(pendingMaskReadCount()).toBe(1);
  });
});
