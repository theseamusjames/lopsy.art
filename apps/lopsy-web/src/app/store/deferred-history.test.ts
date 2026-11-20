import { describe, expect, it } from 'vitest';
import {
  deferHistoryEntry,
  discardDeferredHistoryEntry,
  hasDeferredHistoryEntry,
  takeDeferredHistoryEntry,
} from './deferred-history';
import type { HistorySnapshot } from './types';

const snapshot = { label: 'Add Text Layer' } as HistorySnapshot;

describe('hasDeferredHistoryEntry', () => {
  it('is true while an entry waits for a layer still in the document', () => {
    deferHistoryEntry(snapshot, 'text-1');
    expect(hasDeferredHistoryEntry([{ id: 'bg' }, { id: 'text-1' }])).toBe(true);
    discardDeferredHistoryEntry('text-1');
  });

  it('is false with no entry, or when its layer is gone', () => {
    expect(hasDeferredHistoryEntry([{ id: 'text-1' }])).toBe(false);
    deferHistoryEntry(snapshot, 'text-1');
    expect(hasDeferredHistoryEntry([{ id: 'bg' }])).toBe(false);
    discardDeferredHistoryEntry('text-1');
  });

  it('does not take the entry', () => {
    deferHistoryEntry(snapshot, 'text-1');
    hasDeferredHistoryEntry([{ id: 'text-1' }]);
    expect(takeDeferredHistoryEntry([{ id: 'text-1' }])).toBe(snapshot);
  });
});
