import { describe, it, expect } from 'vitest';
import type { Engine } from './wasm-bridge';
import { getTracked, resetTrackedState, seedMaskDataRef } from './sync-state';

const makeFakeEngine = () => ({}) as unknown as Engine;

describe('seedMaskDataRef — issue #734', () => {
  it('records the given array as the tracked mask ref so syncLayers treats it as already-uploaded', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);

    const bytes = new Uint8ClampedArray(64 * 64).fill(200);
    seedMaskDataRef(engine, 'layer-1', bytes);

    const tracked = getTracked(engine);
    // Reference equality is what the mask upload gate in sync-layers uses.
    expect(tracked.maskDataRefs.get('layer-1')).toBe(bytes);
  });

  it('replaces any prior tracked ref for the same layer', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const older = new Uint8ClampedArray(16);
    const newer = new Uint8ClampedArray(16);
    seedMaskDataRef(engine, 'layer-1', older);
    seedMaskDataRef(engine, 'layer-1', newer);

    const tracked = getTracked(engine);
    expect(tracked.maskDataRefs.get('layer-1')).toBe(newer);
    expect(tracked.maskDataRefs.get('layer-1')).not.toBe(older);
  });

  it('clears the prior mask upload-failure entry so a genuinely new ref retries cleanly', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const tracked = getTracked(engine);
    const failedRef = new Uint8ClampedArray(4);
    tracked.uploadFailures.set('layer-1:mask', { count: 5, dataRef: failedRef });

    seedMaskDataRef(engine, 'layer-1', new Uint8ClampedArray(4));

    expect(tracked.uploadFailures.has('layer-1:mask')).toBe(false);
  });

  it('does not touch other layers', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const other = new Uint8ClampedArray(4);
    seedMaskDataRef(engine, 'other', other);
    seedMaskDataRef(engine, 'layer-1', new Uint8ClampedArray(4));

    const tracked = getTracked(engine);
    expect(tracked.maskDataRefs.get('other')).toBe(other);
  });
});
