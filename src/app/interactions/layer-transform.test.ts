import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransformState } from '../../tools/transform/transform';

const bridge = vi.hoisted(() => {
  const state = {
    engineBounds: new Map<string, number[]>(),
    contentBounds: new Map<string, number[]>(),
    contentGen: new Map<string, number>(),
    isLive: false,
  };
  return {
    state,
    getLayerEngineBounds: vi.fn((_e: unknown, id: string) => state.engineBounds.get(id) ?? []),
    getLayerContentBounds: vi.fn((_e: unknown, id: string) => Promise.resolve(state.contentBounds.get(id) ?? [])),
    layerContentGeneration: vi.fn((_e: unknown, id: string) => state.contentGen.get(id) ?? 0),
    hasLayerTransform: vi.fn(() => state.isLive),
    beginLayerTransform: vi.fn((_e: unknown, id: string) => {
      state.isLive = true;
      const [x = 0, y = 0] = state.engineBounds.get(id) ?? [];
      const [lx = 0, ly = 0, w = 0, h = 0] = state.contentBounds.get(id) ?? [];
      return [x + lx, y + ly, w, h];
    }),
    prepareLayerTransformTarget: vi.fn(() => [] as number[]),
    compositeLayerTransformAffine: vi.fn(),
    compositeLayerTransformPerspective: vi.fn(),
  };
});
vi.mock('../../engine-wasm/wasm-bridge', () => bridge);
const mockEngine = vi.hoisted(() => ({ __engine: 'mock' }));
vi.mock('../../engine-wasm/engine-state', () => ({ getEngine: () => mockEngine }));
vi.mock('../store/clear-js-pixel-data', () => ({ clearJsPixelData: vi.fn() }));
vi.mock('../reconcile-layer-bounds', () => ({ reconcileLayerBoundsWithEngine: vi.fn() }));

const versions = vi.hoisted(() => new Map<string, number>());
vi.mock('../../engine/pixel-data-manager', () => ({
  pixelDataManager: { versionOf: (id: string) => versions.get(id) ?? 0 },
}));

function raster(id: string, locked = false) {
  return { id, type: 'raster', locked, x: 0, y: 0, width: 10, height: 10 };
}

const editor = vi.hoisted(() => ({
  document: {
    layers: [] as Array<{ id: string; type: string; locked: boolean }>,
    selectedLayerIds: [] as string[],
  },
  selection: { active: false },
  undoStack: [] as unknown[],
  redoStack: [] as unknown[],
  notifyRender: vi.fn(),
}));
vi.mock('../editor-store', () => ({ useEditorStore: { getState: () => editor } }));

const ui = vi.hoisted(() => {
  const state = {
    activeTool: 'move',
    maskMode: 'off',
    layerTransform: null as TransformState | null,
    layerTransformMode: 'free',
    setLayerTransform: vi.fn((t: TransformState | null) => { state.layerTransform = t; }),
  };
  return state;
});
vi.mock('../ui-store', () => ({ useUIStore: { getState: () => ui } }));

import {
  beginLayerTransformSession,
  forgetLayerTransform,
  getLayerTransformBox,
  renderLayerTransform,
  resetLayerTransformCache,
} from './layer-transform';

beforeEach(() => {
  vi.clearAllMocks();
  resetLayerTransformCache();
  forgetLayerTransform();
  versions.clear();
  bridge.state.isLive = false;
  bridge.state.contentGen.clear();
  // a: texture at (0, 0), content (10, 20, 30, 40) → doc (10, 20)–(40, 60)
  // b: texture at (100, 50), content (0, 0, 20, 10) → doc (100, 50)–(120, 60)
  bridge.state.engineBounds = new Map([['a', [0, 0, 200, 200]], ['b', [100, 50, 20, 10]]]);
  bridge.state.contentBounds = new Map([['a', [10, 20, 30, 40]], ['b', [0, 0, 20, 10]]]);
  editor.document.layers = [raster('a'), raster('b'), raster('c', true)];
  editor.document.selectedLayerIds = ['a', 'b', 'c'];
  editor.selection.active = false;
  ui.activeTool = 'move';
  ui.maskMode = 'off';
});

/** The box once every content rect it asked for has been read. */
async function settledBox(): Promise<TransformState | null> {
  getLayerTransformBox();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return getLayerTransformBox();
}

describe('getLayerTransformBox', () => {
  it('has no box until the content rects are read, then asks for a redraw', async () => {
    expect(getLayerTransformBox()).toBeNull();
    expect(editor.notifyRender).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(editor.notifyRender).toHaveBeenCalled();
    expect(getLayerTransformBox()).not.toBeNull();
  });

  it('asks once for a rect that is still on its way', () => {
    getLayerTransformBox();
    getLayerTransformBox();
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(2);
  });

  it('frames the union of the selected layers\' content', async () => {
    expect((await settledBox())?.originalBounds).toEqual({ x: 10, y: 20, width: 110, height: 40 });
  });

  it('shows nothing with a marquee, one layer, another tool or a mask mode', () => {
    editor.selection.active = true;
    expect(getLayerTransformBox()).toBeNull();
    editor.selection.active = false;

    editor.document.selectedLayerIds = ['a'];
    expect(getLayerTransformBox()).toBeNull();
    editor.document.selectedLayerIds = ['a', 'b'];

    ui.activeTool = 'brush';
    expect(getLayerTransformBox()).toBeNull();
    ui.activeTool = 'move';

    ui.maskMode = 'quickMask';
    expect(getLayerTransformBox()).toBeNull();
  });

  it('follows a layer drag without reading its pixels again', async () => {
    await settledBox();
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(2);

    bridge.state.engineBounds.set('b', [130, 70, 20, 10]);
    expect(getLayerTransformBox()?.originalBounds).toEqual({ x: 10, y: 20, width: 140, height: 60 });
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(2);

    // New pixels on b: its bounds are read again.
    versions.set('b', 1);
    getLayerTransformBox();
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(3);
  });

  it('reads nothing back for a history step that leaves the pixels alone (#1293)', async () => {
    await settledBox();
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(2);

    // A visibility toggle, rename or opacity change pushes history only.
    editor.undoStack.push({});
    editor.redoStack.length = 0;
    getLayerTransformBox();
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(2);
  });

  it('re-reads only the layer whose texture the engine rewrote (#1293)', async () => {
    await settledBox();
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(2);

    // An undo restore (or any GPU write) bumps the layer's content generation.
    bridge.state.contentGen.set('a', 7);
    bridge.state.contentBounds.set('a', [0, 0, 5, 5]);
    // The last rect known stands in until the new one has been read.
    expect(getLayerTransformBox()?.originalBounds).toEqual({ x: 10, y: 20, width: 110, height: 40 });
    expect((await settledBox())?.originalBounds).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(bridge.getLayerContentBounds).toHaveBeenCalledTimes(3);
    expect(bridge.getLayerContentBounds).toHaveBeenLastCalledWith(expect.anything(), 'a');
  });
});

describe('beginLayerTransformSession', () => {
  it('hands each layer\'s measured content rect to the engine, which reads nothing', async () => {
    const box = (await settledBox())!;
    expect(beginLayerTransformSession(box)).toBe(true);
    expect(bridge.beginLayerTransform).toHaveBeenCalledWith(expect.anything(), 'a', 10, 20, 30, 40);
    expect(bridge.beginLayerTransform).toHaveBeenCalledWith(expect.anything(), 'b', 0, 0, 20, 10);
  });

  it('does not begin while a layer\'s content bounds are still being read', async () => {
    const box = (await settledBox())!;
    // New pixels on b: its bounds are stale until they have been read again.
    versions.set('b', 1);
    expect(beginLayerTransformSession(box)).toBe(false);
    expect(bridge.beginLayerTransform).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(beginLayerTransformSession(box)).toBe(true);
  });
});

describe('renderLayerTransform', () => {
  it('renders every layer about the shared centre into the rect its own content lands in', async () => {
    const box = (await settledBox())!;
    expect(beginLayerTransformSession(box)).toBe(true);
    expect(bridge.beginLayerTransform).toHaveBeenCalledTimes(2);

    const turned: TransformState = { ...box, rotation: Math.PI };
    renderLayerTransform(turned);

    // Half a turn about (65, 40): a (10, 20)–(40, 60) → (90, 20)–(120, 60),
    // b (100, 50)–(120, 60) → (10, 20)–(30, 30); one pixel of slack.
    expect(bridge.prepareLayerTransformTarget).toHaveBeenCalledWith(expect.anything(), 'a', 89, 19, 32, 42);
    expect(bridge.prepareLayerTransformTarget).toHaveBeenCalledWith(expect.anything(), 'b', 9, 19, 22, 12);
    expect(bridge.compositeLayerTransformAffine).toHaveBeenCalledTimes(1);
    const [, , sx, sy, dx, dy] = bridge.compositeLayerTransformAffine.mock.calls[0]!;
    expect([sx, sy, dx, dy]).toEqual([65, 40, 65, 40]);
    expect(ui.layerTransform).toBe(turned);
  });

  it('does nothing once the engine has dropped the session', async () => {
    const box = (await settledBox())!;
    beginLayerTransformSession(box);
    bridge.state.isLive = false;
    renderLayerTransform({ ...box, rotation: 1 });
    expect(bridge.compositeLayerTransformAffine).not.toHaveBeenCalled();
  });
});
