import { describe, it, expect, vi, beforeEach } from 'vitest';

const readMaskTexture = vi.fn();
vi.mock('../engine-wasm/wasm-bridge', () => ({
  readMaskTexture: (...args: unknown[]) => readMaskTexture(...args),
}));

const engine = { __engine: 'mock' };
vi.mock('../engine-wasm/engine-state', () => ({
  getEngine: () => engine,
}));

const editorState = {
  document: {
    layers: [
      { id: 'a', mask: { data: new Uint8ClampedArray(4).fill(255), width: 2, height: 2 } },
    ] as Array<{ id: string; mask: { data: Uint8ClampedArray; width: number; height: number } | null }>,
  },
  updateLayerMaskData: vi.fn(),
};
vi.mock('./editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

import {
  isMaskDataStale,
  markMaskDataStale,
  markMaskDataFresh,
  materializeAllMaskData,
  materializeMaskData,
  scheduleMaskDataRefresh,
  __resetMaskDataSyncForTest,
} from './mask-data-sync';
import { pendingMaskReadCount, __resetMaskReadQueueForTest } from './mask-read-queue';
import { getTracked } from '../engine-wasm/sync-state';
import type { Engine } from '../engine-wasm/wasm-bridge';

beforeEach(() => {
  __resetMaskDataSyncForTest();
  __resetMaskReadQueueForTest();
  readMaskTexture.mockReset();
  editorState.updateLayerMaskData.mockClear();
});

describe('mask-data-sync (#780)', () => {
  it('marking a stroke start drops the queued readback instead of running it', () => {
    scheduleMaskDataRefresh('a');
    expect(pendingMaskReadCount()).toBe(1);

    markMaskDataStale('a');

    expect(pendingMaskReadCount()).toBe(0);
    expect(readMaskTexture).not.toHaveBeenCalled();
    expect(isMaskDataStale('a')).toBe(true);
  });

  it('materialize reads a stale mask back, stores it, and gates its upload echo', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    readMaskTexture.mockReturnValue(bytes);
    markMaskDataStale('a');

    materializeMaskData('a');

    expect(readMaskTexture).toHaveBeenCalledTimes(1);
    const [id, data] = editorState.updateLayerMaskData.mock.calls[0]! as [string, Uint8ClampedArray];
    expect(id).toBe('a');
    expect([...data]).toEqual([1, 2, 3, 4]);
    expect(getTracked(engine as unknown as Engine).maskDataRefs.get('a')).toBe(data);
    expect(isMaskDataStale('a')).toBe(false);
  });

  it('materialize is free when the JS copy is already current', () => {
    markMaskDataStale('a');
    markMaskDataFresh('a');
    materializeAllMaskData();
    expect(readMaskTexture).not.toHaveBeenCalled();
  });

  it('ignores a readback whose size no longer matches the mask', () => {
    readMaskTexture.mockReturnValue(new Uint8Array(9));
    markMaskDataStale('a');
    materializeMaskData('a');
    expect(editorState.updateLayerMaskData).not.toHaveBeenCalled();
  });
});
