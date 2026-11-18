import { describe, expect, it } from 'vitest';
import type { ImportItem } from '@lopsy/photos-core/import/types';
import { estimateLeft, importStats } from './import-progress';

function item(state: ImportItem['state'], byteSize: number, sentBytes = 0): ImportItem {
  return { id: `${state}-${byteSize}`, fileName: 'x.jpg', byteSize, state, sentBytes, assetId: null, error: null };
}

describe('importStats', () => {
  it('counts outcomes and bytes', () => {
    const s = importStats({
      finished: false,
      items: [item('done', 100), item('duplicate', 100), item('failed', 100), item('uploading', 100, 40), item('queued', 100)],
    });
    expect(s.total).toBe(5);
    expect(s.done).toBe(1);
    expect(s.duplicates).toBe(1);
    expect(s.failed.length).toBe(1);
    expect(s.settled).toBe(3);
    expect(s.sentBytes).toBe(340);
    expect(s.fraction).toBeCloseTo(0.68);
  });

  it('is complete when finished with nothing in it', () => {
    expect(importStats({ finished: true, items: [] }).fraction).toBe(1);
  });
});

describe('estimateLeft', () => {
  const half = importStats({ finished: false, items: [item('done', 1000), item('queued', 1000)] });
  it('waits for a few seconds of data', () => {
    expect(estimateLeft(half, 500)).toBeNull();
  });
  it('estimates from the rate so far', () => {
    expect(estimateLeft(half, 10_000)).toBe('Less than a minute left');
    expect(estimateLeft(half, 180_000)).toBe('About 3 minutes left');
  });
});
