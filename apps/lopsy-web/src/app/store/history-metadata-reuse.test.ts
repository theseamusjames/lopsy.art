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

const gpu = vi.hoisted(() => ({
  isLive: false,
  nextHandle: 0,
  layerSnapshots: [] as string[],
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
    getLayerTextureDimensions: vi.fn(() => new Uint32Array([64, 64])),
    snapshotLayerGpu: vi.fn((_e: unknown, id: string) => {
      gpu.layerSnapshots.push(id);
      return gpu.nextHandle++;
    }),
    restoreFromGpuSnapshot: vi.fn(),
    releaseGpuSnapshot: vi.fn(),
  };
});

const { useEditorStore } = await import('../editor-store');

function get() {
  return useEditorStore.getState();
}

function paint(id: string): void {
  useEditorStore.setState((s) => ({ dirtyLayerIds: new Set([...s.dirtyLayerIds, id]) }));
}

/** Layer ids snapshotted by the push `action` performs. */
function snapshotsDuring(action: () => void): string[] {
  gpu.layerSnapshots = [];
  action();
  return gpu.layerSnapshots;
}

describe('pixel snapshot after a metadata entry (#1066)', () => {
  beforeEach(() => {
    gpu.isLive = false;
    get().createDocument(64, 64, true);
    gpu.isLive = true;
    for (let i = 0; i < 4; i++) get().addLayer();
    get().pushHistory('Fill');
  });

  it('re-snapshots only the painted layer after Rename Layer', () => {
    const id = get().document.activeLayerId!;
    get().renameLayer(id, 'Renamed');
    paint(id);
    expect(snapshotsDuring(() => get().pushHistory('Brush'))).toEqual([id]);
  });

  it('re-snapshots only the new layer for the first stroke after Add Layer', () => {
    get().addLayer();
    const id = get().document.activeLayerId!;
    paint(id);
    expect(snapshotsDuring(() => get().pushHistory('Brush'))).toEqual([id]);
  });

  it('shares unchanged layers across several metadata entries', () => {
    const [first, second] = get().document.layerOrder;
    get().renameLayer(first!, 'A');
    get().updateLayerOpacity(second!, 0.5);
    get().renameLayer(second!, 'B');
    paint(second!);
    const before = get().undoStack.find((e) => e.kind === 'pixels');
    get().pushHistory('Brush');
    const after = get().undoStack[get().undoStack.length - 1];
    if (before?.kind !== 'pixels' || after?.kind !== 'pixels') throw new Error('pixel entries expected');
    expect(after.gpuSnapshots.get(first!)).toBe(before.gpuSnapshots.get(first!));
    expect(after.gpuSnapshots.get(second!)).not.toBe(before.gpuSnapshots.get(second!));
  });

  it('still re-snapshots a layer the metadata step moved', () => {
    const id = get().document.activeLayerId!;
    get().renameLayer(id, 'Moved');
    get().updateLayerPosition(id, 10, 12);
    expect(snapshotsDuring(() => get().pushHistory('Brush'))).toContain(id);
  });
});
