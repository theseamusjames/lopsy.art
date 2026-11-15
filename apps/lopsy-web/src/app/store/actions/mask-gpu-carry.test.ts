import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Layer, DocumentState } from '../../../types';

const bridge = vi.hoisted(() => ({
  duplicateLayerTexture: vi.fn(),
  snapshotMaskGpu: vi.fn((..._args: unknown[]) => 3),
  restoreMaskFromGpuSnapshot: vi.fn(),
  releaseGpuSnapshot: vi.fn(),
  remapLayerMask: vi.fn(),
}));
vi.mock('../../../engine-wasm/wasm-bridge', () => bridge);

const engine = vi.hoisted(() => ({ __engine: 'mock' }));
vi.mock('../../../engine-wasm/engine-state', () => ({ getEngine: () => engine }));

const seedMaskDataRef = vi.hoisted(() => vi.fn());
vi.mock('../../../engine-wasm/sync-state', () => ({ seedMaskDataRef }));

const maskSync = vi.hoisted(() => ({
  stale: new Set<string>(),
  isMaskDataStale: vi.fn((id: string) => maskSync.stale.has(id)),
  scheduleMaskDataRefresh: vi.fn(),
  markMaskDataStale: vi.fn(),
  materializeMaskData: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../mask-data-sync', () => maskSync);
vi.mock('../mask-history', () => ({ EMPTY_MASK_HANDLE: 0xFFFFFFFF }));

import { computeDuplicateLayer } from './duplicate-layer';
import { remapLayerMaskThrough } from './_helpers/remap-layer-masks';
import { translation } from '../../../layers/mask-remap';
import type { Engine } from '../../../engine-wasm/wasm-bridge';

const maskBytes = new Uint8ClampedArray(16);

function maskedLayer(): Layer {
  return {
    id: 'src',
    name: 'Layer',
    type: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    width: 4,
    height: 4,
    clipToBelow: false,
    effects: {},
    mask: { id: 'm', enabled: true, data: maskBytes, width: 4, height: 4 },
  } as unknown as Layer;
}

function docWith(layer: Layer): DocumentState {
  return {
    id: 'doc',
    name: 'Test',
    width: 4,
    height: 4,
    layers: [layer],
    layerOrder: [layer.id],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    colorMode: 'rgb',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  maskSync.stale.clear();
  bridge.snapshotMaskGpu.mockReturnValue(3);
});

describe('duplicating a layer whose mask bytes lag the GPU', () => {
  it('copies the mask texture to the duplicate and queues its bytes', () => {
    maskSync.stale.add('src');
    const result = computeDuplicateLayer(docWith(maskedLayer()))!;
    const copyId = result.document!.activeLayerId!;

    expect(bridge.snapshotMaskGpu).toHaveBeenCalledWith(engine, 'src');
    expect(bridge.restoreMaskFromGpuSnapshot).toHaveBeenCalledWith(engine, copyId, 3);
    expect(bridge.releaseGpuSnapshot).toHaveBeenCalledWith(engine, 3);
    // The lagging bytes are marked as uploaded so the sync does not send them.
    expect(seedMaskDataRef).toHaveBeenCalledWith(engine, copyId, maskBytes);
    expect(maskSync.scheduleMaskDataRefresh).toHaveBeenCalledWith(copyId);
    expect(maskSync.materializeMaskData).not.toHaveBeenCalled();
  });

  it('leaves a current mask to the normal upload', () => {
    computeDuplicateLayer(docWith(maskedLayer()));
    expect(bridge.snapshotMaskGpu).not.toHaveBeenCalled();
    expect(seedMaskDataRef).not.toHaveBeenCalled();
  });

  it('releases the copy even when it cannot be restored', () => {
    maskSync.stale.add('src');
    bridge.restoreMaskFromGpuSnapshot.mockImplementationOnce(() => {
      throw new Error('Invalid snapshot handle');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    computeDuplicateLayer(docWith(maskedLayer()));
    spy.mockRestore();
    expect(bridge.releaseGpuSnapshot).toHaveBeenCalledWith(engine, 3);
    expect(maskSync.scheduleMaskDataRefresh).not.toHaveBeenCalled();
  });
});

describe('carrying a mask through a move of its layer', () => {
  it('resamples on the GPU and takes the new size without waiting for the bytes', () => {
    const before = maskedLayer();
    const after = { ...before, x: 2, y: 0 } as Layer;
    const moved = remapLayerMaskThrough(engine as unknown as Engine, before, after, translation(2, 0), 8, 4);

    expect(bridge.remapLayerMask).toHaveBeenCalledTimes(1);
    const [, id, width, height] = bridge.remapLayerMask.mock.calls[0]! as [unknown, string, number, number];
    expect(id).toBe('src');
    expect(moved.mask).toMatchObject({ width, height });
    // The old bytes stand in, marked stale and as already uploaded.
    expect(moved.mask!.data).toBe(maskBytes);
    expect(seedMaskDataRef).toHaveBeenCalledWith(engine, 'src', maskBytes);
    expect(maskSync.markMaskDataStale).toHaveBeenCalledWith('src');
    expect(maskSync.materializeMaskData).toHaveBeenCalledWith('src');
  });
});
