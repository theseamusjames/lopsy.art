import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeFromUi = vi.fn();
vi.mock('../../commands/invoke-from-ui', () => ({ invokeFromUi }));

const { handleKeyEvent, runKeyCommand, KEY_BINDINGS } = await import('./key-bindings');

function keydown(repeat: boolean): KeyboardEvent {
  return { repeat } as KeyboardEvent;
}

describe('key auto-repeat (#1823)', () => {
  beforeEach(() => invokeFromUi.mockClear());

  it('runs a one-shot command on the first keydown', () => {
    handleKeyEvent(keydown(false), () => runKeyCommand('deleteSelectedPixels'));
    expect(invokeFromUi).toHaveBeenCalledWith('paint.clear', undefined);
  });

  it('skips one-shot commands on an auto-repeat', () => {
    for (const key of ['deleteSelectedPixels', 'deleteLayer', 'invertSelection', 'selectAll', 'mergeDown', 'autoTone'] as const) {
      handleKeyEvent(keydown(true), () => runKeyCommand(key));
    }
    expect(invokeFromUi).not.toHaveBeenCalled();
  });

  it('lets undo and redo repeat while held', () => {
    handleKeyEvent(keydown(true), () => runKeyCommand('undo'));
    handleKeyEvent(keydown(true), () => runKeyCommand('redo'));
    expect(invokeFromUi.mock.calls.map((c) => c[0])).toEqual(['history.undo', 'history.redo']);
  });

  it('only applies inside the repeating keydown', () => {
    handleKeyEvent(keydown(true), () => undefined);
    runKeyCommand('selectAll');
    expect(invokeFromUi).toHaveBeenCalledWith('select.all', undefined);
  });

  it('marks only undo and redo as repeating', () => {
    const repeating = Object.entries(KEY_BINDINGS)
      .filter(([, b]) => 'repeats' in b && b.repeats)
      .map(([k]) => k);
    expect(repeating).toEqual(['undo', 'redo']);
  });
});
