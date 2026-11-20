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

// A named layer that is not active is acted on once the engine has settled (context.ts actOnLayer); there is no render loop here.
const settle = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../settled', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settled')>()),
  settled: () => {
    settle.calls++;
    return Promise.resolve();
  },
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

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { DEFAULT_EFFECTS, createTextLayer } = await import('../../layers/layer-model');
await import('./rasterize');

type Store = ReturnType<typeof useEditorStore.getState>;
const real = {
  rasterizeTextLayer: useEditorStore.getState().rasterizeTextLayer,
  rasterizeLayerStyle: useEditorStore.getState().rasterizeLayerStyle,
};

function store(): Store {
  return useEditorStore.getState();
}

function layerNamed(name: string) {
  const layer = store().document.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer ${name}`);
  return layer;
}

function replaceLayer(id: string, change: (layer: ReturnType<typeof layerNamed>) => ReturnType<typeof layerNamed>): void {
  const doc = store().document;
  useEditorStore.setState({ document: { ...doc, layers: doc.layers.map((l) => (l.id === id ? change(l) : l)) } });
}

/** Stands in for the store action, which needs a rendered texture: turns the active layer raster. */
function fakeRasterize() {
  return vi.fn(() => {
    const id = store().document.activeLayerId!;
    replaceLayer(id, (l) => ({ ...l, type: 'raster', width: 10, height: 10, effects: DEFAULT_EFFECTS }) as ReturnType<typeof layerNamed>);
  });
}

function addText(name: string): string {
  const text = { ...createTextLayer({ name, text: 'Hi' }) };
  const doc = store().document;
  const root = doc.layers.find((l) => l.id === doc.rootGroupId);
  if (!root || root.type !== 'group') throw new Error('no root group');
  useEditorStore.setState({
    document: {
      ...doc,
      layers: [...doc.layers.map((l) => (l.id === root.id ? { ...root, children: [...root.children, text.id] } : l)), text],
      layerOrder: [...doc.layerOrder.slice(0, -1), text.id, ...doc.layerOrder.slice(-1)],
    },
  });
  return text.id;
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
  mocks.engine = {};
});

afterEach(() => {
  useEditorStore.setState(real);
  useUIStore.getState().setMaskEditMode(false);
  vi.restoreAllMocks();
});

describe('layer.rasterize', () => {
  it('makes the text layer active and calls rasterizeTextLayer once the engine has settled', async () => {
    const rasterize = fakeRasterize();
    useEditorStore.setState({ rasterizeTextLayer: rasterize });
    const id = addText('Words');
    useUIStore.getState().setMaskEditMode(true);
    const settles = settle.calls;
    const pending = runCommand('layer.rasterize', { layer: 'Words' });
    expect(store().document.activeLayerId).toBe(id);
    expect(useUIStore.getState().maskMode).toBe('off');
    expect(settle.calls).toBe(settles + 1);
    expect(rasterize).not.toHaveBeenCalled();
    expect(await pending).toEqual({ id, name: 'Words', type: 'raster' });
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it('calls rasterizeTextLayer before its first await when the text layer is active', async () => {
    const rasterize = fakeRasterize();
    useEditorStore.setState({ rasterizeTextLayer: rasterize });
    const id = addText('Words');
    store().setActiveLayer(id);
    const settles = settle.calls;
    const pending = runCommand('layer.rasterize', {});
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(settle.calls).toBe(settles);
    expect(await pending).toEqual({ id, name: 'Words', type: 'raster' });
  });

  it('refuses a layer that is not text', async () => {
    const rasterize = fakeRasterize();
    useEditorStore.setState({ rasterizeTextLayer: rasterize });
    const error = await failure(runCommand('layer.rasterize', {}));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('"Layer 1" is not a text layer: the Rasterize Layer button only shows for text layers.');
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('is unavailable without an engine', async () => {
    mocks.engine = null;
    addText('Words');
    expect((await failure(runCommand('layer.rasterize', { layer: 'Words' }))).code).toBe('unavailable');
  });

  it('refuses when the text had nothing rendered and the action left it text', async () => {
    useEditorStore.setState({ rasterizeTextLayer: vi.fn() });
    addText('Words');
    const error = await failure(runCommand('layer.rasterize', { layer: 'Words' }));
    expect(error.message).toBe('"Words" has nothing rendered to rasterize.');
  });
});

describe('layer.rasterize-style', () => {
  it('makes the layer active and calls rasterizeLayerStyle once the engine has settled', async () => {
    const rasterize = fakeRasterize();
    useEditorStore.setState({ rasterizeLayerStyle: rasterize });
    const background = layerNamed('Background').id;
    replaceLayer(background, (l) => ({ ...l, effects: { ...DEFAULT_EFFECTS, stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true } } }));
    const settles = settle.calls;
    const pending = runCommand('layer.rasterize-style', { layer: background });
    expect(store().document.activeLayerId).toBe(background);
    expect(settle.calls).toBe(settles + 1);
    expect(rasterize).not.toHaveBeenCalled();
    expect(await pending).toEqual({ id: background, name: 'Background', type: 'raster' });
    expect(rasterize).toHaveBeenCalledTimes(1);
  });

  it('calls rasterizeLayerStyle before its first await when the layer is active', async () => {
    const rasterize = fakeRasterize();
    useEditorStore.setState({ rasterizeLayerStyle: rasterize });
    const layer1 = layerNamed('Layer 1').id;
    replaceLayer(layer1, (l) => ({ ...l, effects: { ...DEFAULT_EFFECTS, stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true } } }));
    const settles = settle.calls;
    const pending = runCommand('layer.rasterize-style', {});
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(settle.calls).toBe(settles);
    expect(await pending).toEqual({ id: layer1, name: 'Layer 1', type: 'raster' });
  });

  it('refuses a layer with no enabled effects, as the button is disabled', async () => {
    const rasterize = fakeRasterize();
    useEditorStore.setState({ rasterizeLayerStyle: rasterize });
    const error = await failure(runCommand('layer.rasterize-style', {}));
    expect(error.message).toBe('"Layer 1" has no enabled effects: the Rasterize Layer Style button is disabled.');
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('refuses a group', async () => {
    const error = await failure(runCommand('layer.rasterize-style', { layer: 'Project' }));
    expect(error.message).toBe('"Project" is a group: groups have no layer effects to rasterize.');
  });

  it('is unavailable without an engine', async () => {
    mocks.engine = null;
    const id = layerNamed('Layer 1').id;
    replaceLayer(id, (l) => ({ ...l, effects: { ...DEFAULT_EFFECTS, stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true } } }));
    expect((await failure(runCommand('layer.rasterize-style', {}))).code).toBe('unavailable');
  });
});
