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

/**
 * #781 — undoBy / redoBy reset tracked state then re-diff descriptors,
 * but the pre-fix reset also wiped `maskDataRefs`, so every masked layer
 * re-uploaded on every undo (50 MB per Cmd+Z at 4K with 3 masks). The
 * `preserveContentRefs` option keeps content refs so ref-equality gating
 * still skips uploads for masks the undone step never touched.
 */
describe('resetTrackedState({ preserveContentRefs: true }) — #781', () => {
  it('keeps maskDataRefs across the reset when preserveContentRefs is set', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const bytesA = new Uint8ClampedArray(16).fill(1);
    const bytesB = new Uint8ClampedArray(16).fill(2);
    seedMaskDataRef(engine, 'a', bytesA);
    seedMaskDataRef(engine, 'b', bytesB);

    resetTrackedState(engine, { preserveContentRefs: true });

    const tracked = getTracked(engine);
    expect(tracked.maskDataRefs.get('a')).toBe(bytesA);
    expect(tracked.maskDataRefs.get('b')).toBe(bytesB);
  });

  it('keeps the selection mask ref across the reset when preserveContentRefs is set', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const tracked1 = getTracked(engine);
    const selMask = new Uint8ClampedArray(32);
    tracked1.selectionMask = selMask;
    tracked1.selectionActive = true;

    resetTrackedState(engine, { preserveContentRefs: true });

    const tracked = getTracked(engine);
    expect(tracked.selectionMask).toBe(selMask);
    expect(tracked.selectionActive).toBe(true);
  });

  it('keeps pathTextKeys so redo of a Move does not re-anchor path text (#910)', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    getTracked(engine).pathTextKeys = new Map([['text-1', 'key']]);

    resetTrackedState(engine, { preserveContentRefs: true });

    expect(getTracked(engine).pathTextKeys?.get('text-1')).toBe('key');
  });

  it('the default reset (no option) still wipes pathTextKeys', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    getTracked(engine).pathTextKeys = new Map([['text-1', 'key']]);

    resetTrackedState(engine);

    expect(getTracked(engine).pathTextKeys).toBeNull();
  });

  it('still drops descriptor refs so undo triggers a re-diff', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    const tracked1 = getTracked(engine);
    tracked1.layerVersions.set('a', 'v1');
    tracked1.layerRefs.set('a', { id: 'a' } as never);
    tracked1.docWidth = 400;

    resetTrackedState(engine, { preserveContentRefs: true });

    const tracked = getTracked(engine);
    expect(tracked.layerVersions.has('a')).toBe(false);
    expect(tracked.layerRefs.has('a')).toBe(false);
    expect(tracked.docWidth).toBe(0);
  });

  it('the default reset (no option) still wipes maskDataRefs — for engine recreate / project load', () => {
    const engine = makeFakeEngine();
    resetTrackedState(engine);
    seedMaskDataRef(engine, 'a', new Uint8ClampedArray(4));

    resetTrackedState(engine);

    expect(getTracked(engine).maskDataRefs.has('a')).toBe(false);
  });
});
