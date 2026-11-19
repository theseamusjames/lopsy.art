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

const mocks = vi.hoisted(() => ({ engine: null as object | null }));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});

vi.mock('../../app/interactions/selection-handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/interactions/selection-handlers')>();
  return {
    ...actual,
    commitMarqueeShape: vi.fn(actual.commitMarqueeShape),
    commitLassoPolygon: vi.fn(actual.commitLassoPolygon),
  };
});

vi.mock('../../app/selection-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/selection-actions')>();
  return {
    ...actual,
    selectAll: vi.fn(actual.selectAll),
    invertSelectionAction: vi.fn(actual.invertSelectionAction),
    modifySelection: vi.fn(actual.modifySelection),
    selectionToPathAction: vi.fn(actual.selectionToPathAction),
  };
});

vi.mock('../../app/interactions/deselect-and-commit', () => ({ deselectAndCommit: vi.fn() }));

vi.mock('../../panels/LayerPanel/layer-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../panels/LayerPanel/layer-selection')>();
  return { ...actual, selectLayerAlpha: vi.fn(() => Promise.resolve()) };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const handlers = await import('../../app/interactions/selection-handlers');
const actions = await import('../../app/selection-actions');
const { selectLayerAlpha } = await import('../../panels/LayerPanel/layer-selection');
const { deselectAndCommit } = await import('../../app/interactions/deselect-and-commit');
await import('./selection');

type Store = ReturnType<typeof useEditorStore.getState>;
const realClear = useEditorStore.getState().clearSelection;

function store(): Store {
  return useEditorStore.getState();
}

function labels(): string[] {
  return store().undoStack.map((e) => e.label);
}

function maskAt(x: number, y: number): number {
  const { selection } = store();
  return selection.mask?.[y * selection.maskWidth + x] ?? 0;
}

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  store().pushHistory('New Document');
  useToolSettingsStore.getState().setAspectRatioLocked(false);
  useToolSettingsStore.getState().setMarqueeSetting('feather', 0);
  vi.clearAllMocks();
});

afterEach(() => {
  useEditorStore.setState({ clearSelection: realClear });
});

describe('select.rect and select.ellipse', () => {
  it('commit the box through the marquee commit before the first await', async () => {
    const pending = runCommand('select.rect', { x: 5, y: 4, width: 10, height: 6 });
    expect(handlers.commitMarqueeShape).toHaveBeenCalledWith('rect', { x: 5, y: 4, width: 10, height: 6 }, 'replace');
    expect(await pending).toEqual({ active: true, bounds: { x: 5, y: 4, width: 10, height: 6 } });
    expect(maskAt(5, 4)).toBe(255);
    expect(maskAt(15, 4)).toBe(0);
    expect(labels()).toEqual(['New Document']);
  });

  it('select an ellipse in the box', async () => {
    await runCommand('select.ellipse', { x: 0, y: 0, width: 20, height: 20 });
    expect(handlers.commitMarqueeShape).toHaveBeenCalledWith('ellipse', { x: 0, y: 0, width: 20, height: 20 }, 'replace');
    expect(maskAt(10, 10)).toBe(255);
    expect(maskAt(0, 0)).toBe(0);
  });

  it('combine with the selection as one history step', async () => {
    await runCommand('select.rect', { x: 0, y: 0, width: 10, height: 10 });
    const result = await runCommand('select.rect', { x: 20, y: 0, width: 10, height: 10, mode: 'add' });
    expect(result).toEqual({ active: true, bounds: { x: 0, y: 0, width: 30, height: 10 } });
    await runCommand('select.rect', { x: 5, y: 0, width: 20, height: 10, mode: 'subtract' });
    expect(maskAt(7, 5)).toBe(0);
    await runCommand('select.rect', { x: 0, y: 0, width: 3, height: 3, mode: 'intersect' });
    expect(store().selection.bounds).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(labels()).toEqual(['New Document', 'Add to Selection', 'Subtract from Selection', 'Intersect Selection']);
  });

  it('replaces when a combine mode has nothing to combine with, as the tool does', async () => {
    await runCommand('select.rect', { x: 2, y: 2, width: 5, height: 5, mode: 'subtract' });
    expect(store().selection.bounds).toEqual({ x: 2, y: 2, width: 5, height: 5 });
    expect(labels()).toEqual(['New Document']);
  });

  it('clears the selection when an intersect leaves nothing', async () => {
    await runCommand('select.rect', { x: 0, y: 0, width: 5, height: 5 });
    expect(await runCommand('select.rect', { x: 20, y: 20, width: 5, height: 5, mode: 'intersect' })).toEqual({ active: false, bounds: null });
  });

  it('applies a locked Fixed Ratio as the drag would', async () => {
    const settings = useToolSettingsStore.getState();
    settings.setAspectRatioW(2);
    settings.setAspectRatioH(1);
    settings.setAspectRatioLocked(true);
    await runCommand('select.rect', { x: 0, y: 0, width: 20, height: 20 });
    expect(handlers.commitMarqueeShape).toHaveBeenCalledWith('rect', { x: 0, y: 0, width: 20, height: 10 }, 'replace');
    settings.setAspectRatioW(1);
  });

  it('refuses a box outside the document, and a zero size', async () => {
    const error = await failure(runCommand('select.rect', { x: 40, y: 0, width: 5, height: 5 }));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('The box does not overlap the 40x30 document.');
    expect(handlers.commitMarqueeShape).not.toHaveBeenCalled();
    expect((await failure(runCommand('select.ellipse', { x: 0, y: 0, width: 0, height: 5 }))).code).toBe('invalid');
  });
});

describe('select.polygon', () => {
  it('commits the lasso polygon before the first await', async () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }];
    const pending = runCommand('select.polygon', { points, mode: 'replace' });
    expect(handlers.commitLassoPolygon).toHaveBeenCalledWith(points, 'replace');
    const result = (await pending) as { active: boolean };
    expect(result.active).toBe(true);
    expect(maskAt(2, 2)).toBe(255);
    expect(maskAt(18, 18)).toBe(0);
  });

  it('refuses fewer than 3 points and a polygon off the document', async () => {
    expect((await failure(runCommand('select.polygon', { points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }))).code).toBe('invalid');
    const error = await failure(runCommand('select.polygon', { points: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }] }));
    expect(error.message).toBe('The polygon covers no pixel of the document.');
  });
});

describe('select.all and select.none', () => {
  it('select.all selects the document with no history step', async () => {
    const pending = runCommand('select.all', {});
    expect(actions.selectAll).toHaveBeenCalled();
    expect(await pending).toEqual({ active: true, bounds: { x: 0, y: 0, width: 40, height: 30 } });
    expect(labels()).toEqual(['New Document']);
  });

  it('select.none is the menu Deselect: clearSelection only', async () => {
    await runCommand('select.all', {});
    const clear = vi.fn(realClear);
    useEditorStore.setState({ clearSelection: clear });
    const pending = runCommand('select.none', {});
    expect(clear).toHaveBeenCalledTimes(1);
    expect(deselectAndCommit).not.toHaveBeenCalled();
    expect(await pending).toEqual({ active: false, bounds: null });
  });

  it('select.none with commit is Cmd+D: the key\'s deselect-and-commit sequence', async () => {
    await runCommand('select.all', {});
    vi.mocked(deselectAndCommit).mockClear();
    vi.mocked(deselectAndCommit).mockImplementationOnce(() => realClear());
    const clear = vi.fn(realClear);
    useEditorStore.setState({ clearSelection: clear });
    const pending = runCommand('select.none', { commit: true });
    expect(deselectAndCommit).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(await pending).toEqual({ active: false, bounds: null });
  });
});

describe('select.invert', () => {
  it('inverts as Select > Inverse does', async () => {
    await runCommand('select.rect', { x: 0, y: 0, width: 10, height: 30 });
    const pending = runCommand('select.invert', {});
    expect(actions.invertSelectionAction).toHaveBeenCalled();
    expect(await pending).toEqual({ active: true, bounds: { x: 10, y: 0, width: 30, height: 30 } });
    expect(labels()).toEqual(['New Document', 'Inverse Selection']);
  });

  it('with nothing selected still calls invertSelectionAction, which commits a live Move float, then refuses silently', async () => {
    const pending = runCommand('select.invert', {});
    expect(actions.invertSelectionAction).toHaveBeenCalledTimes(1);
    const error = await failure(pending);
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'Nothing is selected to invert.']);
    expect(labels()).toEqual(['New Document']);
  });
});

describe('select.modify', () => {
  it('grows and shrinks as the dialogs do', async () => {
    await runCommand('select.rect', { x: 10, y: 10, width: 10, height: 10 });
    const pending = runCommand('select.modify', { kind: 'grow', amount: 2 });
    expect(actions.modifySelection).toHaveBeenCalledWith('grow', 2);
    expect(await pending).toEqual({ active: true, bounds: { x: 8, y: 8, width: 14, height: 14 } });
    await runCommand('select.modify', { kind: 'shrink', amount: 3 });
    expect(store().selection.bounds).toEqual({ x: 11, y: 11, width: 8, height: 8 });
    expect(labels()).toEqual(['New Document', 'Grow Selection', 'Shrink Selection']);
  });

  it('records a feather with no engine as the dialog does', async () => {
    await runCommand('select.rect', { x: 10, y: 10, width: 10, height: 10 });
    await runCommand('select.modify', { kind: 'feather', amount: 5 });
    expect(labels()).toEqual(['New Document', 'Feather Selection']);
  });

  it('refuses an empty result with the dialog\'s toast text, keeping the selection', async () => {
    await runCommand('select.rect', { x: 10, y: 10, width: 4, height: 4 });
    const error = await failure(runCommand('select.modify', { kind: 'shrink', amount: 5 }));
    expect(error.code).toBe('refused');
    expect(error.notice).toBe('info');
    expect(error.message).toBe('No pixels would remain selected. The selection was not changed.');
    expect(store().selection.bounds).toEqual({ x: 10, y: 10, width: 4, height: 4 });
    expect(labels()).toEqual(['New Document']);
  });

  it('refuses with nothing selected, and amounts outside the dialog range', async () => {
    expect((await failure(runCommand('select.modify', { kind: 'grow', amount: 2 }))).message).toBe('Nothing is selected to grow.');
    expect(actions.modifySelection).toHaveBeenCalledWith('grow', 2);
    await runCommand('select.all', {});
    const tooMuch = await failure(runCommand('select.modify', { kind: 'grow', amount: 101 }));
    expect(tooMuch.code).toBe('invalid');
    expect(tooMuch.message).toBe('select.modify: amount must be from 1 to 100 for grow, got 101');
    expect((await failure(runCommand('select.modify', { kind: 'feather', amount: 251 }))).code).toBe('invalid');
    expect((await failure(runCommand('select.modify', { kind: 'grow', amount: 0 }))).code).toBe('invalid');
    expect((await failure(runCommand('select.modify', { kind: 'grow', amount: 1.5 }))).code).toBe('invalid');
  });
});

describe('select.from-layer', () => {
  function fakeAlphaSelection(): void {
    vi.mocked(selectLayerAlpha).mockImplementationOnce(() => {
      const mask = Uint8ClampedArray.from({ length: 40 * 30 }, (_, i) => (i === 41 ? 255 : 0));
      store().setSelection({ x: 1, y: 1, width: 2, height: 2 }, mask, 40, 30);
      return Promise.resolve();
    });
  }

  it('selects the layer\'s alpha as a thumbnail Cmd-click does', async () => {
    mocks.engine = {};
    fakeAlphaSelection();
    const id = store().document.activeLayerId;
    const pending = runCommand('select.from-layer', { mode: 'add' });
    expect(selectLayerAlpha).toHaveBeenCalledWith(id, { combine: 'add' });
    expect(await pending).toEqual({ active: true, bounds: { x: 1, y: 1, width: 2, height: 2 } });
  });

  it('refuses a layer with no opaque pixels, a group, and no engine', async () => {
    mocks.engine = {};
    expect((await failure(runCommand('select.from-layer', {}))).message).toBe('"Layer 1" has no opaque pixels: the selection was not changed.');
    const doc = store().document;
    const group = doc.layers.find((l) => l.type === 'group');
    if (!group) throw new Error('no root group');
    expect((await failure(runCommand('select.from-layer', { layer: group.id }))).message).toBe(
      `"${group.name}" is a group: groups have no thumbnail to select pixels from.`,
    );
    mocks.engine = null;
    expect((await failure(runCommand('select.from-layer', { layer: 'Background' }))).code).toBe('unavailable');
  });
});

describe('select.to-path', () => {
  it('traces the selection into paths as the menu item does', async () => {
    await runCommand('select.rect', { x: 5, y: 5, width: 10, height: 10 });
    const pending = runCommand('select.to-path', {});
    expect(actions.selectionToPathAction).toHaveBeenCalled();
    expect(await pending).toEqual({ active: true, bounds: { x: 5, y: 5, width: 10, height: 10 } });
    expect(store().paths.length).toBe(1);
    expect(labels()).toEqual(['New Document', 'Selection to Path']);
  });

  it('refuses with nothing selected, and an empty selection with no outline', async () => {
    expect((await failure(runCommand('select.to-path', {}))).message).toBe('Nothing is selected to turn into a path.');
    await runCommand('select.all', {});
    await runCommand('select.invert', {});
    expect((await failure(runCommand('select.to-path', {}))).message).toBe('The selection has no outline to trace.');
  });
});

describe('every select command', () => {
  it('needs an open document', async () => {
    useEditorStore.setState({ documentReady: false });
    expect((await failure(runCommand('select.all', {}))).code).toBe('unavailable');
    useEditorStore.setState({ documentReady: true });
  });
});
