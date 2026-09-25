// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

/**
 * A fake GPU: every layer has a texture size, every snapshot handle remembers
 * the size of the texture it copied, and a restore resizes the layer texture
 * to the handle's size — exactly what snapshotLayerGpu / restoreFromGpuSnapshot
 * do engine-side.
 */
const gpu = vi.hoisted(() => ({
  isLive: false,
  textures: new Map<string, [number, number]>(),
  handles: new Map<number, [number, number]>(),
  nextHandle: 0,
}));

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => (gpu.isLive ? { fake: true } : null) };
});

vi.mock('../../engine-wasm/engine-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-sync')>();
  return {
    ...actual,
    resetTrackedState: vi.fn(),
    flushLayerSync: vi.fn(),
    syncLayers: vi.fn(),
  };
});

vi.mock('../../engine-wasm/wasm-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/wasm-bridge')>();
  return {
    ...actual,
    endStroke: vi.fn(),
    hasFloat: vi.fn(() => false),
    dropFloat: vi.fn(),
    uploadLayerPixels: vi.fn((_e: unknown, id: string, _p: unknown, w: number, h: number) => {
      gpu.textures.set(id, [w, h]);
    }),
    getLayerTextureDimensions: vi.fn((_e: unknown, id: string) => {
      const t = gpu.textures.get(id);
      return t ? new Uint32Array(t) : new Uint32Array([0, 0]);
    }),
    snapshotLayerGpu: vi.fn((_e: unknown, id: string) => {
      const t = gpu.textures.get(id);
      if (!t) return 0xFFFFFFFF;
      const handle = gpu.nextHandle++;
      gpu.handles.set(handle, [...t]);
      return handle;
    }),
    restoreFromGpuSnapshot: vi.fn((_e: unknown, id: string, handle: number) => {
      const t = gpu.handles.get(handle);
      if (t) gpu.textures.set(id, [...t]);
    }),
    releaseGpuSnapshot: vi.fn(),
  };
});

const { useEditorStore } = await import('../editor-store');

function get() {
  return useEditorStore.getState();
}

/** Mirrors the render loop's crop / expand: bounds and texture change together, no history. */
function setLayerBounds(id: string, x: number, y: number, width: number, height: number): void {
  gpu.textures.set(id, [width, height]);
  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      layers: s.document.layers.map((l) => (l.id === id ? { ...l, x, y, width, height } : l)),
    },
  }));
}

function layer(id: string) {
  const l = get().document.layers.find((x) => x.id === id);
  if (!l || l.type !== 'raster') throw new Error('raster layer expected');
  return l;
}

describe('undo/redo live-state snapshot after an out-of-history expand (#833)', () => {
  beforeEach(() => {
    gpu.isLive = false;
    gpu.textures.clear();
    gpu.handles.clear();
    get().createDocument(600, 400, true);
    gpu.isLive = true;
  });

  it('never pairs a cropped snapshot texture with expanded layer bounds', () => {
    const id = get().document.activeLayerId!;
    setLayerBounds(id, 300, 150, 200, 200);

    get().pushHistory('Move');
    get().updateLayerPosition(id, 260, 120);
    get().pushHistory('Move');

    get().undo();
    get().undo();
    expect(layer(id)).toMatchObject({ x: 300, y: 150, width: 200, height: 200 });

    // The layer becomes active again, so the render loop expands it.
    setLayerBounds(id, 0, 0, 600, 400);

    get().redo();
    expect(layer(id)).toMatchObject({ x: 260, y: 120, width: 200, height: 200 });

    get().undo();
    const restored = layer(id);
    // Pre-fix: the store said 0,0 600x400 while the restored texture was the
    // 200x200 crop — the disc rendered in the top-left corner.
    expect(gpu.textures.get(id)).toEqual([restored.width, restored.height]);
    expect(restored).toMatchObject({ x: 0, y: 0, width: 600, height: 400 });
  });

  it('still reuses the restored handles for layers the render loop left alone', () => {
    const id = get().document.activeLayerId!;
    setLayerBounds(id, 300, 150, 200, 200);
    get().pushHistory('Move');
    get().updateLayerPosition(id, 260, 120);
    get().pushHistory('Move');

    get().undo();
    const snapshotsBefore = gpu.nextHandle;
    get().undo();
    get().redo();
    // Nothing changed after the restores, so no new textures were copied.
    expect(gpu.nextHandle).toBe(snapshotsBefore);
    expect(layer(id)).toMatchObject({ x: 260, y: 120, width: 200, height: 200 });
  });
});
