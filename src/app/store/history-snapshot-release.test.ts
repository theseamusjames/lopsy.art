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
 * A fake engine snapshot store with the real one's slot recycling: released
 * ids go on a free list and are handed out again before new ids are minted.
 * Releasing a free id, or restoring from one, is recorded as misuse.
 */
const gpu = vi.hoisted(() => ({
  isLive: false,
  textures: new Map<string, [number, number]>(),
  slots: [] as ([number, number] | null)[],
  freeList: [] as number[],
  misuse: [] as string[],
  alloc(size: [number, number]): number {
    const id = this.freeList.pop();
    if (id !== undefined) {
      this.slots[id] = size;
      return id;
    }
    this.slots.push(size);
    return this.slots.length - 1;
  },
  liveCount(): number {
    return this.slots.filter((s) => s !== null).length;
  },
  isLiveHandle(h: number): boolean {
    return this.slots[h] !== undefined && this.slots[h] !== null;
  },
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
    uploadLayerPixels: vi.fn(),
    uploadLayerMask: vi.fn(),
    getLayerTextureDimensions: vi.fn((_e: unknown, id: string) => {
      const t = gpu.textures.get(id);
      return t ? new Uint32Array(t) : new Uint32Array([0, 0]);
    }),
    snapshotLayerGpu: vi.fn((_e: unknown, id: string) => {
      const t = gpu.textures.get(id);
      return t ? gpu.alloc([...t]) : 0xFFFFFFFF;
    }),
    snapshotMaskGpu: vi.fn(() => gpu.alloc([1, 1])),
    restoreFromGpuSnapshot: vi.fn((_e: unknown, id: string, handle: number) => {
      if (!gpu.isLiveHandle(handle)) {
        gpu.misuse.push(`restore of freed handle ${handle}`);
        return;
      }
      gpu.textures.set(id, [...gpu.slots[handle]!]);
    }),
    restoreMaskFromGpuSnapshot: vi.fn((_e: unknown, _id: string, handle: number) => {
      if (!gpu.isLiveHandle(handle)) gpu.misuse.push(`mask restore of freed handle ${handle}`);
    }),
    releaseGpuSnapshot: vi.fn((_e: unknown, handle: number) => {
      if (!gpu.isLiveHandle(handle)) {
        gpu.misuse.push(`double release of ${handle}`);
        return;
      }
      gpu.slots[handle] = null;
      gpu.freeList.push(handle);
    }),
  };
});

const { useEditorStore } = await import('../editor-store');
const { handleGpuContextRestored } = await import('../gpu-context-loss');
const { markMaskGpuDirty } = await import('../../engine-wasm/mask-gpu-dirty');
const { cacheLayerSnapshot } = await import('./history-slice');
const { addSnapshotHandles } = await import('./snapshot-ledger');

function get() {
  return useEditorStore.getState();
}

function rasterIds(): string[] {
  return get().document.layers.filter((l) => l.type === 'raster').map((l) => l.id);
}

function referencedHandles(): Set<number> {
  const refs = new Set<number>();
  for (const e of get().undoStack) addSnapshotHandles(e, refs);
  for (const e of get().redoStack) addSnapshotHandles(e, refs);
  return refs;
}

/** Simulate an edit that touched `id`'s pixels, then record it. */
function editAndPush(id: string, label = 'Fill'): void {
  useEditorStore.setState({ dirtyLayerIds: new Set([id]) });
  get().pushHistory(label);
}

function addMaskTo(id: string): void {
  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      layers: s.document.layers.map((l) => (l.id === id
        ? { ...l, mask: { id: `${id}-mask`, enabled: true, data: new Uint8ClampedArray(4), width: 2, height: 2 } }
        : l)),
    },
  }));
}

function resetGpu(): void {
  gpu.textures.clear();
  gpu.slots.length = 0;
  gpu.freeList.length = 0;
  gpu.misuse.length = 0;
}

describe('undo snapshot textures are released once history drops them (#1005)', () => {
  beforeEach(() => {
    gpu.isLive = false;
    get().createDocument(200, 100, false);
    resetGpu();
    for (const id of rasterIds()) gpu.textures.set(id, [200, 100]);
    gpu.isLive = true;
  });

  it('frees the handles of entries trimmed off the 50-state cap', () => {
    const [bg, top] = rasterIds() as [string, string];
    useEditorStore.setState({ dirtyLayerIds: new Set([bg, top]) });
    get().pushHistory('New Document');

    for (let i = 0; i < 60; i++) editAndPush(top);

    expect(get().undoStack).toHaveLength(50);
    // Pre-fix: 62 textures stayed allocated (2 baseline + 60 edits).
    expect(gpu.liveCount()).toBe(referencedHandles().size);
    expect(gpu.liveCount()).toBe(51);
    expect(gpu.misuse).toEqual([]);
  });

  it('keeps a handle a trimmed entry shared with the entries still on the stack', () => {
    const [bg, top] = rasterIds() as [string, string];
    useEditorStore.setState({ dirtyLayerIds: new Set([bg, top]) });
    get().pushHistory('New Document');
    const baseline = get().undoStack[0];
    if (baseline?.kind !== 'pixels') throw new Error('pixel baseline expected');
    const bgHandle = baseline.gpuSnapshots.get(bg)!;

    for (let i = 0; i < 55; i++) editAndPush(top);

    expect(gpu.isLiveHandle(bgHandle)).toBe(true);
    get().undoBy(50);
    expect(gpu.misuse).toEqual([]);
    expect(gpu.textures.get(bg)).toEqual([200, 100]);
  });

  it('frees the redo stack when a new push discards it', () => {
    const [, top] = rasterIds() as [string, string];
    for (let i = 0; i < 10; i++) editAndPush(top);
    get().undoBy(8);
    expect(get().redoStack.length).toBe(8);

    editAndPush(top, 'Brush');

    expect(get().redoStack).toHaveLength(0);
    expect(gpu.liveCount()).toBe(referencedHandles().size);
    expect(gpu.misuse).toEqual([]);
  });

  it('keeps the handles undo and redo still need across a long walk', () => {
    const [bg, top] = rasterIds() as [string, string];
    addMaskTo(top);
    for (let i = 0; i < 12; i++) {
      editAndPush(i % 3 === 0 ? bg : top);
      if (i % 4 === 0) markMaskGpuDirty(top);
    }
    get().undoBy(5);
    get().redo();
    get().redo();
    get().undo();
    editAndPush(bg);
    get().undoBy(3);
    get().redoBy(3);
    for (let i = 0; i < 50; i++) editAndPush(top);
    get().undoBy(50);
    get().redoBy(50);

    expect(gpu.misuse).toEqual([]);
    const refs = referencedHandles();
    for (const h of refs) expect(gpu.isLiveHandle(h)).toBe(true);
    expect(gpu.liveCount()).toBe(refs.size);
  });

  it('frees mask snapshot handles that fall off the stack', () => {
    const [, top] = rasterIds() as [string, string];
    addMaskTo(top);
    for (let i = 0; i < 60; i++) {
      markMaskGpuDirty(top);
      editAndPush(top, 'Mask Brush');
    }

    expect(gpu.liveCount()).toBe(referencedHandles().size);
    expect(gpu.misuse).toEqual([]);
  });

  it('frees every snapshot when a new document replaces the old one', () => {
    const [, top] = rasterIds() as [string, string];
    for (let i = 0; i < 20; i++) editAndPush(top);
    get().undoBy(4);
    cacheLayerSnapshot(top);
    expect(gpu.liveCount()).toBeGreaterThan(20);

    get().createDocument(300, 300, true);

    expect(get().undoStack).toHaveLength(0);
    expect(gpu.liveCount()).toBe(0);
    expect(gpu.misuse).toEqual([]);
  });

  it('releases the restored target once a later push supersedes it', () => {
    const [bg, top] = rasterIds() as [string, string];
    useEditorStore.setState({ dirtyLayerIds: new Set([bg, top]) });
    get().pushHistory('New Document');
    editAndPush(top);
    get().undo();
    editAndPush(top, 'Brush');
    get().undo();
    editAndPush(top, 'Brush');

    expect(gpu.liveCount()).toBe(referencedHandles().size);
    expect(gpu.misuse).toEqual([]);
  });

  it('does not release lost-context handles into a restored context', () => {
    const [, top] = rasterIds() as [string, string];
    for (let i = 0; i < 5; i++) editAndPush(top);
    resetGpu();

    handleGpuContextRestored();

    expect(get().undoStack).toHaveLength(0);
    expect(gpu.misuse).toEqual([]);
  });
});
