// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../test/canvas-mock';
import { PixelDataManager } from './pixel-data-manager';
import type { SparseLayerEntry } from '../app/store/types';

function makeImageData(w = 2, h = 2): ImageData {
  return new ImageData(w, h);
}

function makeSparse(): SparseLayerEntry {
  return {
    offsetX: 0,
    offsetY: 0,
    sparse: {
      indices: new Uint32Array([0]),
      rgba: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 2,
      height: 2,
      count: 1,
    },
  };
}

describe('PixelDataManager', () => {
  let mgr: PixelDataManager;

  beforeEach(() => {
    mgr = new PixelDataManager();
  });

  it('starts empty with version 0', () => {
    expect(mgr.get('a')).toBeUndefined();
    expect(mgr.getSparse('a')).toBeUndefined();
    expect(mgr.version()).toBe(0);
    expect(mgr.versionOf('a')).toBe(0);
  });

  it('setDense stores the image and bumps versions', () => {
    const img = makeImageData();
    mgr.setDense('a', img);
    expect(mgr.get('a')).toBe(img);
    expect(mgr.hasDense('a')).toBe(true);
    expect(mgr.version()).toBe(1);
    expect(mgr.versionOf('a')).toBe(1);
    expect(mgr.versionOf('b')).toBe(0);
  });

  it('setSparse clears the dense entry for that layer', () => {
    mgr.setDense('a', makeImageData());
    expect(mgr.hasDense('a')).toBe(true);
    mgr.setSparse('a', makeSparse());
    expect(mgr.hasDense('a')).toBe(false);
    expect(mgr.hasSparse('a')).toBe(true);
  });

  it('setDense clears a sparse entry for the same layer', () => {
    mgr.setSparse('a', makeSparse());
    mgr.setDense('a', makeImageData());
    expect(mgr.hasSparse('a')).toBe(false);
    expect(mgr.hasDense('a')).toBe(true);
  });

  it('remove() drops both kinds and bumps version once', () => {
    mgr.setDense('a', makeImageData());
    const v = mgr.version();
    mgr.remove('a');
    expect(mgr.get('a')).toBeUndefined();
    expect(mgr.getSparse('a')).toBeUndefined();
    expect(mgr.version()).toBe(v + 1);
  });

  it('remove() of a missing layer is a no-op (no version bump)', () => {
    const v = mgr.version();
    mgr.remove('missing');
    expect(mgr.version()).toBe(v);
  });

  it('removeDense leaves sparse data alone', () => {
    mgr.setSparse('a', makeSparse());
    // Directly populate dense too for the test (bypasses the setDense
    // clear-sparse behavior).
    mgr.setDense('a', makeImageData());
    mgr.setSparse('a', makeSparse()); // re-set sparse (clears dense)
    // Now only sparse is set.
    mgr.removeDense('a');
    // Dense was already absent — version shouldn't change.
    expect(mgr.hasSparse('a')).toBe(true);
  });

  it('replace atomically swaps both maps and notifies once per mutation', () => {
    const calls: number[] = [];
    mgr.subscribe(() => calls.push(mgr.version()));

    const dense = new Map<string, ImageData>([['x', makeImageData()]]);
    const sparse = new Map<string, SparseLayerEntry>([['y', makeSparse()]]);
    mgr.replace(dense, sparse);

    expect(mgr.get('x')).toBeDefined();
    expect(mgr.getSparse('y')).toBeDefined();
    // One call for the replace.
    expect(calls).toHaveLength(1);
  });

  it('clearAll empties both maps', () => {
    mgr.setDense('a', makeImageData());
    mgr.setSparse('b', makeSparse());
    mgr.clearAll();
    expect(mgr.hasDense('a')).toBe(false);
    expect(mgr.hasSparse('b')).toBe(false);
  });

  it('clearAll is a no-op when already empty (no version bump)', () => {
    const v = mgr.version();
    mgr.clearAll();
    expect(mgr.version()).toBe(v);
  });

  it('subscribers fire on every mutation and can unsubscribe', () => {
    let count = 0;
    const unsub = mgr.subscribe(() => { count++; });

    mgr.setDense('a', makeImageData());
    mgr.setDense('b', makeImageData());
    expect(count).toBe(2);

    unsub();
    mgr.setDense('c', makeImageData());
    expect(count).toBe(2);
  });

  it('per-layer versions are independent across layers', () => {
    mgr.setDense('a', makeImageData());
    mgr.setDense('a', makeImageData());
    mgr.setDense('b', makeImageData());
    expect(mgr.versionOf('a')).toBe(2);
    expect(mgr.versionOf('b')).toBe(1);
  });

  it('denseMap / sparseMap expose read-only views', () => {
    mgr.setDense('a', makeImageData());
    mgr.setSparse('b', makeSparse());
    expect(Array.from(mgr.denseMap().keys())).toEqual(['a']);
    expect(Array.from(mgr.sparseMap().keys())).toEqual(['b']);
  });
});
