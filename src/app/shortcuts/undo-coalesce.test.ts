// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { useEditorStore } = await import('../editor-store');
const { scheduleUndoRedo, _resetUndoCoalescerForTest } = await import('./undo-coalesce');

function get() {
  return useEditorStore.getState();
}

describe('undo-coalesce — Cmd+Z auto-repeat batching (#761)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetUndoCoalescerForTest();
    get().createDocument(10, 10, false);
    for (let i = 0; i < 5; i++) get().addLayer();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetUndoCoalescerForTest();
  });

  it('applies the accumulated undo count once per animation frame', () => {
    const undoBySpy = vi.spyOn(get(), 'undoBy');
    // Note: spyOn on getState() returns a new object each call; store the spy target.
    // Instead spy on the store's method directly by replacing it.
    const originalUndoBy = useEditorStore.getState().undoBy;
    const undoByCalls: number[] = [];
    useEditorStore.setState({
      undoBy: (n: number) => {
        undoByCalls.push(n);
        originalUndoBy(n);
      },
    });
    undoBySpy.mockRestore();

    // Simulate 4 auto-repeats within one rAF tick.
    scheduleUndoRedo('undo');
    scheduleUndoRedo('undo');
    scheduleUndoRedo('undo');
    scheduleUndoRedo('undo');

    // Nothing runs synchronously.
    expect(undoByCalls).toEqual([]);

    // Advance timers to fire the rAF fallback.
    vi.advanceTimersByTime(32);

    // Exactly one batched call of size 4.
    expect(undoByCalls).toEqual([4]);
  });

  it('flushes the current batch when direction flips mid-frame', () => {
    const originalUndoBy = useEditorStore.getState().undoBy;
    const originalRedoBy = useEditorStore.getState().redoBy;
    const calls: string[] = [];
    useEditorStore.setState({
      undoBy: (n: number) => {
        calls.push(`u${n}`);
        originalUndoBy(n);
      },
      redoBy: (n: number) => {
        calls.push(`r${n}`);
        originalRedoBy(n);
      },
    });

    scheduleUndoRedo('undo');
    scheduleUndoRedo('undo');
    // Direction flip: undo batch should apply immediately, redo starts fresh.
    scheduleUndoRedo('redo');
    vi.advanceTimersByTime(32);

    expect(calls).toEqual(['u2', 'r1']);
  });

  it('resets internal state after a batch fires so the next hold starts clean', () => {
    scheduleUndoRedo('undo');
    scheduleUndoRedo('undo');
    vi.advanceTimersByTime(32);

    const undoStackAfterFirst = get().undoStack.length;

    scheduleUndoRedo('undo');
    vi.advanceTimersByTime(32);

    expect(get().undoStack.length).toBe(undoStackAfterFirst - 1);
  });
});
