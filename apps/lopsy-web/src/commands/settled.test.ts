import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandError } from './command';
import { createSettle, type SettleDeps } from './settled';

vi.mock('../engine-wasm/engine-state', () => ({
  engineStarted: () => Promise.resolve(null),
}));

vi.mock('../engine-wasm/wasm-bridge', () => ({
  parkedReadbackCount: () => 0,
}));

type Handle = ReturnType<typeof setTimeout>;

interface FakeWorld {
  deps: SettleDeps<Handle>;
  pass(rendered: boolean): Promise<void>;
  isLoopRunning: boolean;
  parked: number;
  isHidden: boolean;
  engineStart: Promise<unknown>;
}

function fakeWorld(timeoutMs = 1000): FakeWorld {
  let waiters: Array<(rendered: boolean) => void> = [];
  const world: FakeWorld = {
    isLoopRunning: true,
    parked: 0,
    isHidden: false,
    engineStart: Promise.resolve(null),
    async pass(rendered) {
      const due = waiters;
      waiters = [];
      for (const waiter of due) waiter(rendered);
      await vi.advanceTimersByTimeAsync(0);
    },
    deps: {
      engineStarted: () => world.engineStart,
      isLoopRunning: () => world.isLoopRunning,
      nextLoopPass: () => new Promise((resolve) => waiters.push(resolve)),
      parkedReadbackCount: () => world.parked,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle),
      isDocumentHidden: () => world.isHidden,
      timeoutMs,
    },
  };
  return world;
}

function track(promise: Promise<void>): { readonly state: 'pending' | 'resolved' | 'rejected'; error: unknown } {
  const tracked = { state: 'pending' as 'pending' | 'resolved' | 'rejected', error: undefined as unknown };
  promise.then(
    () => {
      tracked.state = 'resolved';
    },
    (error: unknown) => {
      tracked.state = 'rejected';
      tracked.error = error;
    },
  );
  return tracked;
}

describe('createSettle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after an idle pass', async () => {
    const world = fakeWorld();
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe('pending');
    await world.pass(false);
    expect(result.state).toBe('resolved');
  });

  it('does not resolve on a rendered pass', async () => {
    const world = fakeWorld();
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(0);
    await world.pass(true);
    expect(result.state).toBe('pending');
    await world.pass(false);
    expect(result.state).toBe('resolved');
  });

  it('keeps waiting while readbacks are parked, then resolves on the first idle pass after', async () => {
    const world = fakeWorld();
    world.parked = 2;
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(0);
    await world.pass(false);
    world.parked = 1;
    await world.pass(true);
    expect(result.state).toBe('pending');
    world.parked = 0;
    await world.pass(false);
    expect(result.state).toBe('resolved');
  });

  it('does not count a pass that ended before the call', async () => {
    const world = fakeWorld();
    await world.pass(false);
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe('pending');
    await world.pass(false);
    expect(result.state).toBe('resolved');
  });

  it('waits for the engine to start', async () => {
    const world = fakeWorld();
    let started: (value: unknown) => void = () => undefined;
    world.engineStart = new Promise((resolve) => {
      started = resolve;
    });
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(0);
    await world.pass(false);
    expect(result.state).toBe('pending');
    started(null);
    await vi.advanceTimersByTimeAsync(0);
    await world.pass(false);
    expect(result.state).toBe('resolved');
  });

  it('waits for the loop to start', async () => {
    const world = fakeWorld();
    world.isLoopRunning = false;
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(100);
    await world.pass(false);
    expect(result.state).toBe('pending');
    world.isLoopRunning = true;
    await vi.advanceTimersByTimeAsync(50);
    await world.pass(false);
    expect(result.state).toBe('resolved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects as unavailable on timeout, naming what it waited for', async () => {
    const world = fakeWorld(1000);
    const result = track(createSettle(world.deps)());
    await world.pass(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.state).toBe('rejected');
    expect(result.error).toBeInstanceOf(CommandError);
    const error = result.error as CommandError;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('the engine to go idle');
    expect(error.message).not.toContain('background tab');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names the render loop when it never started, and the hidden tab when hidden', async () => {
    const world = fakeWorld(1000);
    world.isLoopRunning = false;
    world.isHidden = true;
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(1000);
    expect(result.state).toBe('rejected');
    const error = result.error as CommandError;
    expect(error.code).toBe('unavailable');
    expect(error.message).toContain('the render loop to start');
    expect(error.message).toContain('background tab');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names the engine start when the engine never starts', async () => {
    const world = fakeWorld(1000);
    world.engineStart = new Promise(() => undefined);
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(1000);
    expect((result.error as CommandError).message).toContain('the engine to start');
  });

  it('leaves no timer pending after resolving', async () => {
    const world = fakeWorld();
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(0);
    await world.pass(false);
    expect(result.state).toBe('resolved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores passes after it has timed out', async () => {
    const world = fakeWorld(1000);
    const result = track(createSettle(world.deps)());
    await vi.advanceTimersByTimeAsync(1000);
    await world.pass(false);
    expect(result.state).toBe('rejected');
    expect(vi.getTimerCount()).toBe(0);
  });
});
