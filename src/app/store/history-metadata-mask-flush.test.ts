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
 * #782 — pushHistoryMetadata used to skip `flushAllPendingMaskReads`,
 * so a metadata step (visibility toggle, add layer, reorder, …) taken
 * within the ~3s wait window after a mask stroke would snapshot the
 * pre-stroke mask array and lose the painted pixels on undo. The fix
 * mirrors pushHistory: drain pending reads before snapshotting.
 */
describe('pushHistoryMetadata flushes pending mask reads (#782)', () => {
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

  it('drains the queued mask read before the snapshot is captured', () => {
    const reader = vi.fn(() => new Uint8ClampedArray([9, 9, 9, 9]));
    const cb = vi.fn();
    requestMaskRead('layer-1', reader, cb);
    expect(pendingMaskReadCount()).toBe(1);

    useEditorStore.getState().pushHistoryMetadata('Toggle Visibility');

    // The queued reader must have run synchronously before the snapshot
    // — otherwise the metadata undo would restore a stale mask (#782).
    expect(reader).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(new Uint8ClampedArray([9, 9, 9, 9]));
    expect(pendingMaskReadCount()).toBe(0);
  });
});
