// @vitest-environment jsdom
import '../test/canvas-mock';
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
  fillActiveLayerMask: vi.fn((..._args: unknown[]) => false),
  isEditingActiveLayerMask: vi.fn(() => false),
  clearSelectedPixels: vi.fn(),
  setSelectionMask: vi.fn(),
  hasFloat: vi.fn(() => false),
  commitLiveFloat: vi.fn(),
}));

vi.mock('../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => mocks.engine };
});
vi.mock('../engine-wasm/wasm-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine-wasm/wasm-bridge')>();
  return { ...actual, clearSelectedPixels: mocks.clearSelectedPixels, setSelectionMask: mocks.setSelectionMask, hasFloat: mocks.hasFloat };
});
vi.mock('./fill-layer-mask', () => ({
  fillActiveLayerMask: mocks.fillActiveLayerMask,
  isEditingActiveLayerMask: mocks.isEditingActiveLayerMask,
}));
vi.mock('./interactions/live-float', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./interactions/live-float')>();
  return { ...actual, commitLiveFloat: mocks.commitLiveFloat };
});

const { useEditorStore } = await import('./editor-store');
const { useUIStore } = await import('./ui-store');
const { useToolSettingsStore } = await import('./tool-settings-store');
const { clearActiveLayerMask, clearSelectedLayerPixels, handleDeleteKey } = await import('./delete-key');
const invokeSpy = vi.spyOn(await import('../commands/invoke-from-ui'), 'invokeFromUi');
await import('../commands/mask/clear');
await import('../commands/paint/clear');
await import('../commands/layer/layer');

function store() {
  return useEditorStore.getState();
}

function select(): Uint8ClampedArray {
  const mask = Uint8ClampedArray.from({ length: 40 * 30 }, () => 255);
  useEditorStore.setState({ selection: { active: true, bounds: { x: 0, y: 0, width: 40, height: 30 }, mask, maskWidth: 40, maskHeight: 30 } });
  return mask;
}

const pushHistory = vi.fn();
const removeLayer = vi.fn();
const notifyRender = vi.fn();

beforeEach(() => {
  mocks.engine = null;
  store().createDocument(40, 30, false);
  useEditorStore.setState({ pushHistory, removeLayer, notifyRender });
  mocks.engine = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the Delete key', () => {
  it('runs mask.clear in mask edit mode, which clears the mask with the background colour as "Mask Clear"', () => {
    const doc = store().document;
    const mask = { data: new Uint8Array(4), width: 2, height: 2, enabled: true };
    useEditorStore.setState({ document: { ...doc, layers: doc.layers.map((l) => (l.id === doc.activeLayerId ? { ...l, mask } : l)) } as typeof doc });
    useUIStore.setState({ maskMode: 'layerMask' });
    mocks.isEditingActiveLayerMask.mockReturnValueOnce(true);
    mocks.fillActiveLayerMask.mockReturnValueOnce(true);
    handleDeleteKey();
    expect(invokeSpy.mock.calls).toEqual([['mask.clear', undefined]]);
    expect(removeLayer).not.toHaveBeenCalled();
    expect(mocks.fillActiveLayerMask).toHaveBeenCalledWith(useToolSettingsStore.getState().backgroundColor, 'Mask Clear');
    expect(mocks.clearSelectedPixels).not.toHaveBeenCalled();
    useUIStore.setState({ maskMode: 'off' });
  });

  it('runs paint.clear with a selection, which clears the selected pixels as "Clear Selection" in the same tick', () => {
    select();
    const id = store().document.activeLayerId;
    handleDeleteKey();
    expect(invokeSpy.mock.calls).toEqual([['paint.clear', undefined]]);
    expect(mocks.setSelectionMask).toHaveBeenCalledTimes(1);
    expect(mocks.clearSelectedPixels).toHaveBeenCalledWith(mocks.engine, id, true);
    expect(pushHistory).toHaveBeenCalledWith('Clear Selection');
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it('runs layer.remove with no selection, which removes the active layer in the same tick', () => {
    const id = store().document.activeLayerId;
    handleDeleteKey();
    expect(invokeSpy.mock.calls).toEqual([['layer.remove', undefined]]);
    expect(removeLayer).toHaveBeenCalledWith(id);
    expect(pushHistory).not.toHaveBeenCalled();
  });

  it('does nothing with no active layer', () => {
    useEditorStore.setState({ document: { ...store().document, activeLayerId: null } });
    handleDeleteKey();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('commits a live float before clearing', () => {
    const mask = select();
    mocks.hasFloat.mockReturnValueOnce(true);
    expect(clearSelectedLayerPixels(store().document.activeLayerId!, mask)).toBe(true);
    expect(mocks.commitLiveFloat).toHaveBeenCalledTimes(1);
  });

  it('reports that it did not clear without an engine or once the selection is gone', () => {
    const mask = select();
    mocks.engine = null;
    expect(clearSelectedLayerPixels(store().document.activeLayerId!, mask)).toBe(false);
    mocks.engine = {};
    store().clearSelection();
    expect(clearSelectedLayerPixels(store().document.activeLayerId!, mask)).toBe(false);
    expect(mocks.clearSelectedPixels).not.toHaveBeenCalled();
  });

  it('clearActiveLayerMask passes fillActiveLayerMask\'s answer through', () => {
    expect(clearActiveLayerMask()).toBe(false);
    mocks.fillActiveLayerMask.mockReturnValueOnce(true);
    expect(clearActiveLayerMask()).toBe(true);
  });
});
