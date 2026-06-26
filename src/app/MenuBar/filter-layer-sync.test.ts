import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncLayerAfterFullSize = vi.fn();
vi.mock('../sync-layer-after-full-size', () => ({
  syncLayerAfterFullSize: (...args: unknown[]) => syncLayerAfterFullSize(...args),
}));

const clearJsPixelData = vi.fn();
vi.mock('../store/clear-js-pixel-data', () => ({
  clearJsPixelData: (...args: unknown[]) => clearJsPixelData(...args),
}));

import { syncLayerBoundsAfterFilter, syncAndClearLayerAfterFilter } from './filter-layer-sync';

const engine = { __engine: 'mock' } as unknown as Parameters<typeof syncLayerBoundsAfterFilter>[0];

beforeEach(() => {
  syncLayerAfterFullSize.mockClear();
  clearJsPixelData.mockClear();
});

describe('filter layer sync', () => {
  it('syncLayerBoundsAfterFilter reconciles the JS layer bounds with the engine', () => {
    syncLayerBoundsAfterFilter(engine, 'layer-1');
    expect(syncLayerAfterFullSize).toHaveBeenCalledWith(engine, 'layer-1');
    expect(clearJsPixelData).not.toHaveBeenCalled();
  });

  it('syncAndClearLayerAfterFilter syncs bounds before dropping stale pixel data', () => {
    const order: string[] = [];
    syncLayerAfterFullSize.mockImplementation(() => order.push('sync'));
    clearJsPixelData.mockImplementation(() => order.push('clear'));

    syncAndClearLayerAfterFilter(engine, 'layer-1');

    expect(syncLayerAfterFullSize).toHaveBeenCalledWith(engine, 'layer-1');
    expect(clearJsPixelData).toHaveBeenCalledWith('layer-1');
    // Bounds must be reconciled before the JS pixel data is cleared, otherwise
    // the layer position pushed on the next sync frame is stale.
    expect(order).toEqual(['sync', 'clear']);
  });
});
