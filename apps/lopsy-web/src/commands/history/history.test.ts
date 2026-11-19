// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { deferHistoryEntry, discardDeferredHistoryEntry } = await import('../../app/store/deferred-history');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./history');

type HistoryAction = 'undo' | 'redo' | 'undoBy' | 'redoBy';

function store() {
  return useEditorStore.getState();
}

const real = {
  undo: store().undo,
  redo: store().redo,
  undoBy: store().undoBy,
  redoBy: store().redoBy,
};

function spyOn(action: HistoryAction) {
  const spy = vi.fn(real[action]);
  useEditorStore.setState({ [action]: spy });
  return spy;
}

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

function labels() {
  return { undo: store().undoStack.map((e) => e.label), redo: store().redoStack.map((e) => e.label) };
}

beforeEach(() => {
  store().createDocument(40, 30, false);
  store().pushHistory('New Document');
  store().pushHistory('Brush');
  store().pushHistory('Fill');
});

afterEach(() => {
  useEditorStore.setState(real);
});

describe('history.undo', () => {
  it('calls undo() for one step, before its first await, and returns the labels after it', async () => {
    const undo = spyOn('undo');
    const pending = runCommand('history.undo', {});
    expect(undo).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual({ undo: ['New Document', 'Brush'], redo: ['Fill'] });
  });

  it('calls undoBy(steps) for several steps, as the History panel does', async () => {
    const undoBy = spyOn('undoBy');
    const pending = runCommand('history.undo', { steps: 2 });
    expect(undoBy).toHaveBeenCalledWith(2);
    await expect(pending).resolves.toEqual({ undo: ['New Document'], redo: ['Fill', 'Brush'] });
  });

  it('pops "New Document" like the UI does', async () => {
    await runCommand('history.undo', { steps: 3 });
    expect(labels()).toEqual({ undo: [], redo: ['Fill', 'Brush', 'New Document'] });
  });

  it('refuses silently with nothing to undo', async () => {
    await runCommand('history.undo', { steps: 3 });
    const undo = spyOn('undo');
    const error = await rejection(runCommand('history.undo', {}));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('Nothing to undo.');
    expect(error.notice).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });

  it('refuses more steps than there are, saying how many there are', async () => {
    const undoBy = spyOn('undoBy');
    const error = await rejection(runCommand('history.undo', { steps: 4 }));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('Only 3 steps to undo; asked for 4.');
    expect(undoBy).not.toHaveBeenCalled();
    expect(labels().undo).toHaveLength(3);
  });

  it('counts an uncommitted text layer\'s pending entry as one more step', async () => {
    const layerId = store().document.activeLayerId!;
    deferHistoryEntry({ ...store().undoStack[0]!, label: 'Add Text Layer' }, layerId);
    const error = await rejection(runCommand('history.undo', { steps: 5 }));
    expect(error.message).toBe('Only 4 steps to undo; asked for 5.');
    await runCommand('history.undo', {});
    expect(labels()).toEqual({ undo: ['New Document', 'Brush', 'Fill'], redo: ['Add Text Layer'] });
  });
});

describe('history.redo', () => {
  beforeEach(async () => {
    await runCommand('history.undo', { steps: 2 });
  });

  it('calls redo() for one step, before its first await, and returns the labels after it', async () => {
    const redo = spyOn('redo');
    const pending = runCommand('history.redo', {});
    expect(redo).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual({ undo: ['New Document', 'Brush'], redo: ['Fill'] });
  });

  it('calls redoBy(steps) for several steps', async () => {
    const redoBy = spyOn('redoBy');
    const pending = runCommand('history.redo', { steps: 2 });
    expect(redoBy).toHaveBeenCalledWith(2);
    await expect(pending).resolves.toEqual({ undo: ['New Document', 'Brush', 'Fill'], redo: [] });
  });

  it('refuses silently with nothing to redo', async () => {
    await runCommand('history.redo', { steps: 2 });
    const error = await rejection(runCommand('history.redo', {}));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('Nothing to redo.');
    expect(error.notice).toBeNull();
  });

  it('refuses more steps than there are, saying how many there are', async () => {
    const error = await rejection(runCommand('history.redo', { steps: 3 }));
    expect(error.message).toBe('Only 2 steps to redo; asked for 3.');
    await runCommand('history.undo', {});
    const single = await rejection(runCommand('history.redo', { steps: 4 }));
    expect(single.message).toBe('Only 3 steps to redo; asked for 4.');
  });

  it('refuses while an uncommitted text layer\'s entry would clear the redo stack', async () => {
    const layerId = store().document.activeLayerId!;
    deferHistoryEntry({ ...store().undoStack[0]!, label: 'Add Text Layer' }, layerId);
    const redo = spyOn('redo');
    const error = await rejection(runCommand('history.redo', {}));
    expect(error.message).toBe('Nothing to redo.');
    expect(redo).not.toHaveBeenCalled();
    discardDeferredHistoryEntry(layerId);
  });
});

describe('history params and availability', () => {
  it.each(['history.undo', 'history.redo'])('%s rejects steps that are not a positive integer', async (id) => {
    for (const steps of [0, -1, 1.5, '2']) {
      const error = await rejection(runCommand(id, { steps }));
      expect(error.code).toBe('invalid');
      expect(error.message).toMatch(new RegExp(`^${id.replace('.', '\\.')}: steps must be an integer >= 1`));
    }
  });

  it.each(['history.undo', 'history.redo'])('%s throws unavailable with no document open', async (id) => {
    useEditorStore.setState({ documentReady: false });
    const error = await rejection(runCommand(id, {}));
    expect(error.code).toBe('unavailable');
    useEditorStore.setState({ documentReady: true });
  });
});
