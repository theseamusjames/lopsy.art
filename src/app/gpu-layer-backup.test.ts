import { describe, it, expect } from 'vitest';
import { isSameHistoryKey, type HistoryKey } from './gpu-layer-backup';

describe('isSameHistoryKey (#973)', () => {
  const entry = { label: 'Fill' };
  const layers: unknown[] = [];
  const key: HistoryKey = { undoTop: entry, undoLength: 3, redoTop: undefined, redoLength: 0, layers };

  it('matches an unchanged document', () => {
    expect(isSameHistoryKey(key, { ...key })).toBe(true);
  });

  it('sees a new edit even when the capped undo stack keeps its length', () => {
    expect(isSameHistoryKey(key, { ...key, undoTop: { label: 'Brush' } })).toBe(false);
  });

  it('sees undo and redo', () => {
    expect(isSameHistoryKey(key, { ...key, undoLength: 2, redoTop: entry, redoLength: 1 })).toBe(false);
  });

  it('sees a layer change that pushed no history', () => {
    expect(isSameHistoryKey(key, { ...key, layers: [] })).toBe(false);
  });
});
