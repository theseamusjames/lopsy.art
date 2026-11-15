import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { coalesceToAnimationFrame } from './raf-coalesce';

describe('coalesceToAnimationFrame', () => {
  let rafCallbacks: FrameRequestCallback[];
  let cancelled: number[];
  let nextId: number;
  let rafCalls: number;

  beforeEach(() => {
    rafCallbacks = [];
    cancelled = [];
    nextId = 1;
    rafCalls = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCalls++;
      const id = nextId++;
      rafCallbacks.push(cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelled.push(id);
      rafCallbacks = [];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tickFrame(): void {
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const cb of pending) cb(0);
  }

  it('runs at most once per frame, using the latest args', () => {
    const fn = vi.fn<(x: number) => void>();
    const throttled = coalesceToAnimationFrame(fn);

    throttled(1);
    throttled(2);
    throttled(3);

    expect(fn).not.toHaveBeenCalled();

    tickFrame();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('reschedules for the next frame after firing', () => {
    const fn = vi.fn<(x: number) => void>();
    const throttled = coalesceToAnimationFrame(fn);

    throttled(1);
    tickFrame();
    throttled(2);
    tickFrame();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  it('flush runs pending work synchronously and cancels the rAF', () => {
    const fn = vi.fn<(x: number) => void>();
    const throttled = coalesceToAnimationFrame(fn);

    throttled(42);
    throttled.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(42);
    expect(cancelled.length).toBeGreaterThan(0);

    tickFrame();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const throttled = coalesceToAnimationFrame(fn);
    throttled.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops pending work without invoking fn', () => {
    const fn = vi.fn<(x: number) => void>();
    const throttled = coalesceToAnimationFrame(fn);

    throttled(1);
    throttled.cancel();

    tickFrame();
    expect(fn).not.toHaveBeenCalled();
  });

  it('only schedules one rAF while calls are pending', () => {
    const fn = vi.fn<(x: number) => void>();
    const throttled = coalesceToAnimationFrame(fn);

    throttled(1);
    throttled(2);
    throttled(3);

    expect(rafCalls).toBe(1);
  });

  it('collapses N calls into 1 fn invocation per frame — the perf property', () => {
    // A 250Hz pen tablet can fire ~4 pointer-move events per 16ms frame.
    // Without coalescing, each pays the full readback/upload cost. This
    // test pins the invariant that only ONE call per frame reaches the
    // expensive underlying function.
    const fn = vi.fn<(x: number) => void>();
    const throttled = coalesceToAnimationFrame(fn);

    for (let i = 0; i < 100; i++) throttled(i);
    tickFrame();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(99);
  });
});
