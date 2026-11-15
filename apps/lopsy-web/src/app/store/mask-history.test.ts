import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Layer, LayerMask } from '../../types';
import type { HistorySnapshot, MaskSnapshotEntry } from './types';

let nextHandle = 100;
const snapshotMaskGpu = vi.fn((_engine: unknown, _layerId: string) => nextHandle++);
const restoreMaskFromGpuSnapshot = vi.fn();
const readMaskTexture = vi.fn();

vi.mock('../../engine-wasm/wasm-bridge', () => ({
  snapshotMaskGpu: (engine: unknown, layerId: string) => snapshotMaskGpu(engine, layerId),
  restoreMaskFromGpuSnapshot: (...args: unknown[]) => restoreMaskFromGpuSnapshot(...args),
  readMaskTexture: (...args: unknown[]) => readMaskTexture(...args),
}));

const engine = { __engine: 'mock' };
vi.mock('../../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const editorState = {
  document: { layers: [] as Layer[] },
  updateLayerMaskData: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

import {
  snapshotGpuMasks,
  restoreMasksAfterUndo,
  withCurrentMaskStaleness,
  EMPTY_MASK_HANDLE,
} from './mask-history';
import { clearMaskGpuDirty, markMaskGpuDirty, markAllMasksGpuDirty } from '../../engine-wasm/mask-gpu-dirty';
import { getTracked, resetTrackedState } from '../../engine-wasm/sync-state';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import {
  isMaskDataStale,
  markMaskDataStale,
  scheduleMaskDataRefresh,
  __resetMaskDataSyncForTest,
} from '../mask-data-sync';

const fakeEngine = engine as unknown as Engine;

function mask(size = 4, fill = 255): LayerMask {
  return { id: 'm', enabled: true, data: new Uint8ClampedArray(size * size).fill(fill), width: size, height: size };
}

function layer(id: string, m: LayerMask | null): Layer {
  return {
    id, name: id, type: 'raster', visible: true, locked: false, opacity: 1,
    blendMode: 'normal', x: 0, y: 0, clipToBelow: false,
    effects: {} as Layer['effects'], mask: m, width: 4, height: 4,
  } as Layer;
}

function pixelsSnapshot(layers: Layer[], maskSnapshots: Map<string, MaskSnapshotEntry>): HistorySnapshot {
  return {
    kind: 'pixels',
    document: { layers } as unknown as HistorySnapshot['document'],
    selection: {} as HistorySnapshot['selection'],
    label: 'Mask Paint',
    gpuSnapshots: new Map(),
    maskSnapshots,
    paths: [],
    selectedPathId: null,
  };
}

function metadataSnapshot(layers: Layer[]): HistorySnapshot {
  return {
    kind: 'metadata',
    document: { layers } as unknown as HistorySnapshot['document'],
    selection: {} as HistorySnapshot['selection'],
    label: 'Toggle Visibility',
    paths: [],
    selectedPathId: null,
  };
}

beforeEach(() => {
  nextHandle = 100;
  snapshotMaskGpu.mockClear();
  restoreMaskFromGpuSnapshot.mockClear();
  readMaskTexture.mockReset();
  editorState.updateLayerMaskData.mockClear();
  __resetMaskDataSyncForTest();
  resetTrackedState(fakeEngine);
  markAllMasksGpuDirty();
});

describe('snapshotGpuMasks — mask handles in history snapshots (#780)', () => {
  it('takes a GPU snapshot for every masked layer and none for unmasked ones', () => {
    const layers = [layer('a', mask()), layer('b', null), layer('c', mask())];
    const snaps = snapshotGpuMasks(layers, undefined);

    expect([...snaps.keys()]).toEqual(['a', 'c']);
    expect(snapshotMaskGpu).toHaveBeenCalledTimes(2);
    expect(snaps.get('a')!.handle).toBe(100);
    expect(snaps.get('c')!.handle).toBe(101);
  });

  it('never reads the mask back to JS to build a snapshot', () => {
    markMaskDataStale('a');
    snapshotGpuMasks([layer('a', mask())], undefined);
    expect(readMaskTexture).not.toHaveBeenCalled();
  });

  it('reuses the previous handle for masks nothing has written since', () => {
    const layers = [layer('a', mask()), layer('c', mask())];
    const first = pixelsSnapshot(layers, snapshotGpuMasks(layers, undefined));
    clearMaskGpuDirty();
    snapshotMaskGpu.mockClear();

    const second = snapshotGpuMasks(layers, first);

    expect(snapshotMaskGpu).not.toHaveBeenCalled();
    expect(second.get('a')!.handle).toBe(100);
    expect(second.get('c')!.handle).toBe(101);
  });

  it('re-snapshots only the masks written since the previous snapshot', () => {
    const layers = [layer('a', mask()), layer('c', mask())];
    const first = pixelsSnapshot(layers, snapshotGpuMasks(layers, undefined));
    clearMaskGpuDirty();
    markMaskGpuDirty('c');
    snapshotMaskGpu.mockClear();

    const second = snapshotGpuMasks(layers, first);

    expect(snapshotMaskGpu).toHaveBeenCalledTimes(1);
    expect(snapshotMaskGpu.mock.calls[0]![1]).toBe('c');
    expect(second.get('a')!.handle).toBe(100);
    expect(second.get('c')!.handle).toBe(102);
  });

  it('does not reuse across a metadata entry, a size change, or an undo', () => {
    const layers = [layer('a', mask())];
    const first = pixelsSnapshot(layers, snapshotGpuMasks(layers, undefined));
    clearMaskGpuDirty();

    expect(snapshotGpuMasks(layers, metadataSnapshot(layers)).get('a')!.handle).not.toBe(100);
    expect(snapshotGpuMasks([layer('a', mask(8))], first).get('a')!.handle).not.toBe(100);

    markAllMasksGpuDirty();
    expect(snapshotGpuMasks(layers, first).get('a')!.handle).not.toBe(100);
  });

  it('records whether the snapshot document\'s mask bytes lag the GPU', () => {
    markMaskDataStale('a');
    const snaps = snapshotGpuMasks([layer('a', mask()), layer('c', mask())], undefined);
    expect(snaps.get('a')!.isDataStale).toBe(true);
    expect(snaps.get('c')!.isDataStale).toBe(false);
  });

  it('withCurrentMaskStaleness keeps handles and re-reads staleness', () => {
    const entries = new Map<string, MaskSnapshotEntry>([['a', { handle: 7, isDataStale: false }]]);
    markMaskDataStale('a');
    expect(withCurrentMaskStaleness(entries).get('a')).toEqual({ handle: 7, isDataStale: true });
  });
});

describe('restoreMasksAfterUndo — GPU mask stays authoritative (#780)', () => {
  it('blits the snapshot handle back and gates the stale JS bytes out of syncLayers', () => {
    const staleBytes = mask();
    const target = pixelsSnapshot(
      [layer('a', staleBytes)],
      new Map([['a', { handle: 42, isDataStale: true }]]),
    );

    restoreMasksAfterUndo(fakeEngine, target, [layer('a', mask())]);

    expect(restoreMaskFromGpuSnapshot).toHaveBeenCalledWith(fakeEngine, 'a', 42);
    // syncLayers uploads only when layer.mask.data !== the tracked ref;
    // seeding it with the restored document's bytes stops the upload.
    expect(getTracked(fakeEngine).maskDataRefs.get('a')).toBe(staleBytes.data);
    expect(getTracked(fakeEngine).masksOnEngine.has('a')).toBe(true);
    // The restored document's bytes lagged, so a lazy readback is queued.
    expect(isMaskDataStale('a')).toBe(true);
    expect(readMaskTexture).not.toHaveBeenCalled();
  });

  it('marks the JS bytes fresh when the snapshot recorded them as current', () => {
    scheduleMaskDataRefresh('a');
    const target = pixelsSnapshot(
      [layer('a', mask())],
      new Map([['a', { handle: 42, isDataStale: false }]]),
    );

    restoreMasksAfterUndo(fakeEngine, target, [layer('a', mask())]);

    expect(isMaskDataStale('a')).toBe(false);
  });

  it('leaves the GPU mask alone on a metadata undo', () => {
    const shared = mask();
    restoreMasksAfterUndo(fakeEngine, metadataSnapshot([layer('a', shared)]), [layer('a', shared)]);

    expect(restoreMaskFromGpuSnapshot).not.toHaveBeenCalled();
    expect(getTracked(fakeEngine).maskDataRefs.get('a')).toBe(shared.data);
    expect(isMaskDataStale('a')).toBe(false);
  });

  it('queues a readback on a metadata undo whose snapshot bytes predate the live ones', () => {
    const older = mask(4, 255);
    restoreMasksAfterUndo(fakeEngine, metadataSnapshot([layer('a', older)]), [layer('a', mask(4, 0))]);

    expect(getTracked(fakeEngine).maskDataRefs.get('a')).toBe(older.data);
    expect(isMaskDataStale('a')).toBe(true);
  });

  it('falls back to uploading the JS bytes when the mask re-appears', () => {
    const readded = mask();
    getTracked(fakeEngine).maskDataRefs.set('a', readded.data);

    restoreMasksAfterUndo(fakeEngine, metadataSnapshot([layer('a', readded)]), [layer('a', null)]);

    expect(getTracked(fakeEngine).maskDataRefs.has('a')).toBe(false);
  });

  it('falls back to uploading the JS bytes when the snapshot has no handle', () => {
    getTracked(fakeEngine).maskDataRefs.set('a', mask().data);
    const target = pixelsSnapshot(
      [layer('a', mask())],
      new Map([['a', { handle: EMPTY_MASK_HANDLE, isDataStale: false }]]),
    );

    restoreMasksAfterUndo(fakeEngine, target, [layer('a', mask())]);

    expect(restoreMaskFromGpuSnapshot).not.toHaveBeenCalled();
    expect(getTracked(fakeEngine).maskDataRefs.has('a')).toBe(false);
  });
});
