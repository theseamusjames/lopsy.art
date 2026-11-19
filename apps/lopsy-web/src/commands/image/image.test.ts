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

const mocks = vi.hoisted(() => ({
  engine: null as object | null,
  flipActiveLayer: vi.fn((): Promise<void> => Promise.resolve()),
  rotateImage: vi.fn(),
  applyAutoTone: vi.fn((): Promise<void> => Promise.resolve()),
  applyAutoContrast: vi.fn((): Promise<void> => Promise.resolve()),
  applyAutoColor: vi.fn((): Promise<void> => Promise.resolve()),
  cropToSelection: vi.fn(),
}));

// The layer row click commits the Move float first; there is none here, and the fake engine cannot answer.
vi.mock('../../app/interactions/gesture-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/interactions/gesture-session')>();
  return { ...actual, clearPersistentTransform: vi.fn() };
});

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});

vi.mock('../../app/image-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/image-actions')>();
  return {
    ...actual,
    flipActiveLayer: mocks.flipActiveLayer,
    rotateImage: mocks.rotateImage,
    applyAutoTone: mocks.applyAutoTone,
    applyAutoContrast: mocks.applyAutoContrast,
    applyAutoColor: mocks.applyAutoColor,
  };
});

vi.mock('../../app/crop-to-selection', () => ({ cropToSelection: mocks.cropToSelection }));

const { useEditorStore } = await import('../../app/editor-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { selectAll } = await import('../../app/selection-actions');
await import('./image');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];
type Store = ReturnType<typeof useEditorStore.getState>;

function store(): Store {
  return useEditorStore.getState();
}

function activeLayer(): Layer {
  const doc = store().document;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer) throw new Error('no active layer');
  return layer;
}

function patchLayer(id: string, patch: Record<string, unknown>): void {
  const doc = store().document;
  useEditorStore.setState({ document: { ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) } });
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

/** Replace a store action with a spy that does nothing. */
function spyAction<K extends 'resizeCanvas' | 'resizeImage' | 'cropCanvas' | 'addBorder'>(name: K) {
  const spy = vi.fn();
  useEditorStore.setState({ [name]: spy } as Partial<Store>);
  return spy;
}

const realActions = {
  resizeCanvas: useEditorStore.getState().resizeCanvas,
  resizeImage: useEditorStore.getState().resizeImage,
  cropCanvas: useEditorStore.getState().cropCanvas,
  addBorder: useEditorStore.getState().addBorder,
};

beforeEach(() => {
  useEditorStore.setState(realActions);
  mocks.engine = null;
  store().createDocument(40, 30, false);
  mocks.engine = {};
  for (const fn of [mocks.flipActiveLayer, mocks.rotateImage, mocks.applyAutoTone, mocks.applyAutoContrast, mocks.applyAutoColor, mocks.cropToSelection]) {
    fn.mockClear();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image.canvas-size and image.size', () => {
  it('maps the anchor name to the dialog\'s anchor fractions', async () => {
    const spy = spyAction('resizeCanvas');
    const pending = runCommand('image.canvas-size', { width: 60, height: 20, anchor: 'right-top' });
    expect(spy).toHaveBeenCalledWith(60, 20, 1, 0);
    await pending;
    await runCommand('image.canvas-size', { width: 60, height: 20 });
    expect(spy).toHaveBeenLastCalledWith(60, 20, 0.5, 0.5);
  });

  it('returns the new size', async () => {
    mocks.engine = null;
    expect(await runCommand('image.canvas-size', { width: 50, height: 35, anchor: 'left-bottom' })).toEqual({ width: 50, height: 35 });
    expect(await runCommand('image.size', { width: 20, height: 15 })).toEqual({ width: 20, height: 15 });
  });

  it('takes whole pixels within the document limit and no unknown anchor', async () => {
    expect((await failure(runCommand('image.size', { width: 10.5, height: 10 }))).code).toBe('invalid');
    expect((await failure(runCommand('image.size', { width: 0, height: 10 }))).code).toBe('invalid');
    expect((await failure(runCommand('image.canvas-size', { width: 20000, height: 10 }))).code).toBe('invalid');
    expect((await failure(runCommand('image.canvas-size', { width: 10, height: 10, anchor: 'top-left' }))).code).toBe('invalid');
  });
});

describe('image.border', () => {
  it('calls addBorder with the foreground and the dialog defaults in the synchronous part', async () => {
    const spy = spyAction('addBorder');
    const fg = useToolSettingsStore.getState().foregroundColor;
    const pending = runCommand('image.border', {});
    expect(spy).toHaveBeenCalledWith(fg, { top: 20, right: 20, bottom: 20, left: 20 }, 'expand', { outer: 0, inner: 0 });
    await expect(pending).rejects.toThrow('no Border layer was added');
  });

  it('returns the layer the border added and the size', async () => {
    const spy = spyAction('addBorder');
    spy.mockImplementationOnce(() => store().addLayer());
    const result = (await runCommand('image.border', { width: 5, color: '#ff0000' })) as { layer: string; width: number; height: number };
    expect(spy).toHaveBeenCalledWith({ r: 255, g: 0, b: 0, a: 1 }, { top: 5, right: 5, bottom: 5, left: 5 }, 'expand', { outer: 0, inner: 0 });
    expect(result).toEqual({ layer: store().document.activeLayerId, width: 40, height: 30 });
  });

  it('takes asymmetric widths, but not both forms', async () => {
    const spy = spyAction('addBorder');
    await runCommand('image.border', { widths: { top: 1, left: 0 }, placement: 'overlay', innerRadius: 3 }).catch(() => undefined);
    expect(spy).toHaveBeenCalledWith(expect.anything(), { top: 1, right: 20, bottom: 20, left: 0 }, 'overlay', { outer: 0, inner: 3 });
    expect((await failure(runCommand('image.border', { width: 1, widths: {} }))).code).toBe('invalid');
  });

  it('is refused with the dialog\'s message when there is no plan', async () => {
    const zero = await failure(runCommand('image.border', { width: 0 }));
    expect([zero.code, zero.message]).toEqual(['refused', 'Enter a border width.']);
    const huge = await failure(runCommand('image.border', { width: 16000 }));
    expect(huge.message).toMatch(/^Too large: the canvas can be at most \d+ px on a side\.$/);
  });

  it('is refused in an Indexed document, with the text the store toasts', async () => {
    useEditorStore.setState({ document: { ...store().document, colorMode: 'indexed' } });
    const error = await failure(runCommand('image.border', { width: 4 }));
    expect([error.code, error.notice]).toEqual(['refused', 'info']);
  });

  it('passes a saturated colour unconverted in a Grayscale document, as the dialog does', async () => {
    const spy = spyAction('addBorder');
    useEditorStore.setState({ document: { ...store().document, colorMode: 'grayscale' } });
    await runCommand('image.border', { color: '#ff0000' }).catch(() => undefined);
    expect(spy).toHaveBeenCalledWith({ r: 255, g: 0, b: 0, a: 1 }, expect.anything(), 'expand', expect.anything());
  });
});

describe('image.crop and image.crop-to-selection', () => {
  it('calls cropCanvas with the rectangle', async () => {
    const spy = spyAction('cropCanvas');
    const pending = runCommand('image.crop', { x: 5, y: 4, width: 10, height: 8 });
    expect(spy).toHaveBeenCalledWith({ x: 5, y: 4, width: 10, height: 8 });
    await pending;
  });

  it('crops for real and pushes "Crop Canvas"', async () => {
    mocks.engine = null;
    expect(await runCommand('image.crop', { x: -5, y: 4, width: 20, height: 8 })).toEqual({ width: 15, height: 8 });
    expect(store().undoStack[store().undoStack.length - 1]?.label).toBe('Crop Canvas');
  });

  it('refuses a rectangle outside the canvas', async () => {
    const error = await failure(runCommand('image.crop', { x: 40, y: 0, width: 5, height: 5 }));
    expect([error.code, error.message]).toEqual(['refused', 'The crop rectangle lies outside the 40x30 canvas.']);
  });

  it('crop-to-selection calls Edit > Crop\'s function, and is refused with nothing selected', async () => {
    const error = await failure(runCommand('image.crop-to-selection'));
    expect([error.code, error.notice, error.message]).toEqual(['refused', null, 'Nothing is selected to crop to.']);
    selectAll();
    const pending = runCommand('image.crop-to-selection');
    expect(mocks.cropToSelection).toHaveBeenCalledTimes(1);
    await pending;
  });
});

describe('image.rotate', () => {
  it('calls rotateImage in the synchronous part', async () => {
    const pending = runCommand('image.rotate', { direction: 'ccw' });
    expect(mocks.rotateImage).toHaveBeenCalledWith('ccw');
    expect(await pending).toEqual({ width: 40, height: 30 });
  });

  it('is unavailable without an engine', async () => {
    mocks.engine = null;
    expect((await failure(runCommand('image.rotate', { direction: 'cw' }))).code).toBe('unavailable');
  });
});

describe('image.flip-layer', () => {
  it('calls flipActiveLayer and resolves once it pushed history', async () => {
    mocks.flipActiveLayer.mockImplementationOnce(() => {
      store().pushHistoryMetadata('Flip Horizontal');
      return Promise.resolve();
    });
    const id = activeLayer().id;
    const pending = runCommand('image.flip-layer', { axis: 'horizontal' });
    expect(mocks.flipActiveLayer).toHaveBeenCalledWith('horizontal');
    expect(await pending).toEqual({ layer: id });
  });

  it('activates a named layer first', async () => {
    const background = store().document.layers.find((l) => l.name === 'Background');
    if (!background) throw new Error('no Background');
    mocks.flipActiveLayer.mockImplementationOnce(() => {
      expect(store().document.activeLayerId).toBe(background.id);
      store().pushHistoryMetadata('Flip Vertical');
      return Promise.resolve();
    });
    expect(await runCommand('image.flip-layer', { layer: 'Background', axis: 'vertical' })).toEqual({ layer: background.id });
  });

  it('is refused when the flip found nothing to flip', async () => {
    const error = await failure(runCommand('image.flip-layer', { axis: 'vertical' }));
    expect([error.code, error.message]).toEqual(['refused', '"Layer 1" has nothing to flip.']);
  });

  it('refuses path text and a group holding text with the menu\'s toasts', async () => {
    patchLayer(activeLayer().id, { type: 'text', pathId: 'p1' });
    const text = await failure(runCommand('image.flip-layer', { axis: 'horizontal' }));
    expect([text.code, text.notice, text.message]).toEqual(['refused', 'info', 'Rasterize this text layer to flip it.']);
    const rootId = store().document.rootGroupId ?? '';
    const group = await failure(runCommand('image.flip-layer', { layer: rootId, axis: 'horizontal' }));
    expect(group.message).toBe('Rasterize the text layers in this group before flipping it.');
    expect(mocks.flipActiveLayer).not.toHaveBeenCalled();
  });
});

describe('image.auto', () => {
  it('calls the menu\'s function and returns the node it appended', async () => {
    const rootId = store().document.rootGroupId ?? '';
    mocks.applyAutoContrast.mockImplementationOnce(() => {
      store().addAdjustmentNode(rootId, 'levels');
      return Promise.resolve();
    });
    const pending = runCommand('image.auto', { kind: 'contrast' });
    expect(mocks.applyAutoContrast).toHaveBeenCalledTimes(1);
    const result = (await pending) as { node: string; group: string };
    expect(result.group).toBe(rootId);
    const root = store().document.layers.find((l) => l.id === rootId);
    expect(root?.type === 'group' && root.adjustments[root.adjustments.length - 1]?.id).toBe(result.node);
  });

  it('is refused when no node was added', async () => {
    const error = await failure(runCommand('image.auto', { kind: 'tone' }));
    expect([error.code, error.message]).toEqual(['refused', "Auto Tone could not read the active layer's pixels."]);
  });
});
