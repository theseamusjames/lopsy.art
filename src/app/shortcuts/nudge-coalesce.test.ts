import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const pushHistory = vi.fn();

vi.mock('../editor-store', () => ({
  useEditorStore: {
    getState: () => ({ pushHistory }),
  },
}));

const { scheduleNudge, releaseNudgeKey, _resetNudgeCoalescer } = await import('./nudge-coalesce');

describe('nudge-coalesce (#684)', () => {
  let apply: ReturnType<typeof vi.fn<(dx: number, dy: number) => void>>;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    _resetNudgeCoalescer();
    pushHistory.mockClear();
    apply = vi.fn<(dx: number, dy: number) => void>();
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushRaf = () => {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    cbs.forEach((cb) => cb(0));
  };

  it('accumulates multiple keydowns in one frame into a single apply call', () => {
    scheduleNudge('ArrowRight', false, 1, 0, apply);
    scheduleNudge('ArrowRight', true, 1, 0, apply);
    scheduleNudge('ArrowRight', true, 1, 0, apply);
    scheduleNudge('ArrowRight', true, 1, 0, apply);

    expect(apply).not.toHaveBeenCalled();
    flushRaf();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(4, 0);
  });

  it('pushes exactly one history entry per key-hold', () => {
    scheduleNudge('ArrowRight', false, 1, 0, apply);
    // Auto-repeats should NOT push more history.
    for (let i = 0; i < 30; i++) {
      scheduleNudge('ArrowRight', true, 1, 0, apply);
    }
    flushRaf();

    expect(pushHistory).toHaveBeenCalledTimes(1);
    expect(pushHistory).toHaveBeenCalledWith('Nudge');
  });

  it('releaseNudgeKey flushes pending apply synchronously', () => {
    scheduleNudge('ArrowUp', false, 0, -1, apply);
    scheduleNudge('ArrowUp', true, 0, -1, apply);

    expect(apply).not.toHaveBeenCalled();
    releaseNudgeKey('ArrowUp');

    // Applied without waiting for rAF.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(0, -2);
  });

  it('next key-hold after release pushes a fresh history entry', () => {
    scheduleNudge('ArrowRight', false, 1, 0, apply);
    releaseNudgeKey('ArrowRight');
    expect(pushHistory).toHaveBeenCalledTimes(1);

    scheduleNudge('ArrowRight', false, 1, 0, apply);
    expect(pushHistory).toHaveBeenCalledTimes(2);
  });

  it('holding two arrow keys simultaneously combines into one apply per frame', () => {
    scheduleNudge('ArrowRight', false, 1, 0, apply);
    scheduleNudge('ArrowDown', false, 0, 1, apply);
    scheduleNudge('ArrowRight', true, 1, 0, apply);
    scheduleNudge('ArrowDown', true, 0, 1, apply);
    flushRaf();

    // One history entry for the whole compound hold.
    expect(pushHistory).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(2, 2);
  });

  it('releasing one of two held keys does not reset the history latch', () => {
    scheduleNudge('ArrowRight', false, 1, 0, apply);
    scheduleNudge('ArrowDown', false, 0, 1, apply);
    releaseNudgeKey('ArrowRight');

    // Second key still held → next repeat should not push another history.
    scheduleNudge('ArrowDown', true, 0, 1, apply);
    expect(pushHistory).toHaveBeenCalledTimes(1);
  });

  it('a fresh scheduleNudge after apply keeps accumulating on the next frame', () => {
    scheduleNudge('ArrowRight', false, 1, 0, apply);
    flushRaf();
    expect(apply).toHaveBeenLastCalledWith(1, 0);

    scheduleNudge('ArrowRight', true, 1, 0, apply);
    flushRaf();
    expect(apply).toHaveBeenLastCalledWith(1, 0);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('empty accumulator does not fire apply', () => {
    scheduleNudge('ArrowRight', false, 0, 0, apply);
    flushRaf();
    expect(apply).not.toHaveBeenCalled();
  });
});
