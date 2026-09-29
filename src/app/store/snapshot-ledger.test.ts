import { describe, it, expect, vi } from 'vitest';
import { addSnapshotHandles, createSnapshotHandleLedger } from './snapshot-ledger';
import type { HistorySnapshot } from './types';

const EMPTY = 0xFFFFFFFF;

function pixels(layerHandles: Record<string, number>, maskHandles: Record<string, number> = {}): HistorySnapshot {
  return {
    kind: 'pixels',
    document: {} as HistorySnapshot['document'],
    selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
    gpuSnapshots: new Map(Object.entries(layerHandles)),
    maskSnapshots: new Map(
      Object.entries(maskHandles).map(([id, handle]) => [id, { handle, isDataStale: false }]),
    ),
    label: 'Edit',
    paths: [],
    selectedPathId: null,
  };
}

describe('addSnapshotHandles', () => {
  it('collects layer and mask handles and skips the empty sentinel', () => {
    const out = new Set<number>();
    addSnapshotHandles(pixels({ a: 1, b: EMPTY }, { a: 7, c: EMPTY }), out);
    expect([...out].sort()).toEqual([1, 7]);
  });

  it('ignores metadata entries and missing entries', () => {
    const out = new Set<number>();
    addSnapshotHandles(null, out);
    addSnapshotHandles(undefined, out);
    addSnapshotHandles({
      kind: 'metadata',
      document: {} as HistorySnapshot['document'],
      selection: { active: false, bounds: null, mask: null, maskWidth: 0, maskHeight: 0 },
      label: 'Add Layer',
      paths: [],
      selectedPathId: null,
    }, out);
    expect(out.size).toBe(0);
  });
});

describe('createSnapshotHandleLedger', () => {
  it('releases only the handles that left the live set', () => {
    const release = vi.fn();
    const ledger = createSnapshotHandleLedger(release);
    ledger.reconcile(new Set([1, 2, 3]));
    expect(release).not.toHaveBeenCalled();

    const released = ledger.reconcile(new Set([2, 3, 4]));
    expect(released).toEqual([1]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(1);
  });

  it('keeps a handle shared by a dropped entry and a surviving one', () => {
    const release = vi.fn();
    const ledger = createSnapshotHandleLedger(release);
    const oldest = pixels({ bg: 10, top: 11 });
    const newer = pixels({ bg: 10, top: 12 });
    const both = new Set<number>();
    addSnapshotHandles(oldest, both);
    addSnapshotHandles(newer, both);
    ledger.reconcile(both);

    const survivors = new Set<number>();
    addSnapshotHandles(newer, survivors);
    ledger.reconcile(survivors);

    expect(release.mock.calls).toEqual([[11]]);
  });

  it('never releases the same handle twice', () => {
    const release = vi.fn();
    const ledger = createSnapshotHandleLedger(release);
    ledger.reconcile(new Set([5]));
    ledger.reconcile(new Set());
    ledger.reconcile(new Set());
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('re-owns a recycled handle number once it is live again', () => {
    const release = vi.fn();
    const ledger = createSnapshotHandleLedger(release);
    ledger.reconcile(new Set([5]));
    ledger.reconcile(new Set());
    ledger.reconcile(new Set([5]));
    ledger.reconcile(new Set());
    expect(release.mock.calls).toEqual([[5], [5]]);
  });

  it('drops protected handles without releasing them', () => {
    const release = vi.fn();
    const ledger = createSnapshotHandleLedger(release);
    ledger.reconcile(new Set([1, 2]));
    ledger.reconcile(new Set(), (h) => h === 2);
    expect(release.mock.calls).toEqual([[1]]);
    ledger.reconcile(new Set());
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('forget() abandons handles without releasing them', () => {
    const release = vi.fn();
    const ledger = createSnapshotHandleLedger(release);
    ledger.reconcile(new Set([1, 2, 3]));
    ledger.forget();
    expect(ledger.size()).toBe(0);
    ledger.reconcile(new Set());
    expect(release).not.toHaveBeenCalled();
  });
});
