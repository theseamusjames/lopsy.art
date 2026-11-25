import { describe, expect, it } from 'vitest';
import type { ImportItem } from '@lopsy/photos-core/import/types';
import { endedCleanly, estimateLeft, importHeadline, importStats } from './import-progress';

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

describe('paused imports', () => {
  it('counts items a pause left waiting', () => {
    const waiting = { ...item('queued', 100), error: 'Paused' };
    expect(importStats({ finished: true, items: [item('done', 100), waiting] }).paused).toBe(1);
    expect(importStats({ finished: false, items: [waiting] }).paused).toBe(0);
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

describe('waiting to retry', () => {
  it('lists items the importer parked', () => {
    const parked = { ...item('queued', 100), error: 'Waiting to retry: network down' };
    const s = importStats({ finished: true, items: [item('done', 100), parked] });
    expect(s.waiting.map((i) => i.error)).toEqual(['Waiting to retry: network down']);
    expect(s.paused).toBe(0);
  });
});

describe('how an import ends', () => {
  const end = { finished: true, failed: 0, waiting: 0, paused: 0 };

  it('ends cleanly only when over with nothing failed, waiting or paused', () => {
    expect(endedCleanly(end)).toBe(true);
    expect(endedCleanly({ ...end, finished: false })).toBe(false);
    expect(endedCleanly({ ...end, failed: 1 })).toBe(false);
    expect(endedCleanly({ ...end, waiting: 1 })).toBe(false);
    expect(endedCleanly({ ...end, paused: 1 })).toBe(false);
  });

  it('heads the strip, and a clean end’s toast, with what happened', () => {
    const running = { finished: false, items: [item('done', 1000), item('uploading', 2_000_000, 1000)] };
    expect(importHeadline(running, importStats(running), 0)).toBe('Importing 1 of 2 photos · 2.0 MB left');
    const done = { finished: true, items: [item('done', 100), item('done', 100), item('duplicate', 100)] };
    expect(importHeadline(done, importStats(done), 0)).toBe('Imported 2 photos, skipped 1 already in the library');
    // The JPEG half of a RAW+JPEG pair is a file, not a photo.
    expect(importHeadline(done, importStats(done), 1)).toBe('Imported 1 photo (2 files: RAW+JPEG pairs count once), skipped 1 already in the library');
    const parked = { finished: true, items: [item('done', 100), { ...item('queued', 100), error: 'Waiting to retry: network down' }] };
    expect(importHeadline(parked, importStats(parked), 0)).toBe('Imported 1 photo · 1 photo waiting to try again');
    const paused = { finished: true, items: [item('done', 100), { ...item('queued', 100), error: 'Paused' }] };
    expect(importHeadline(paused, importStats(paused), 0)).toBe('Import paused · 1 photo still to go');
  });
});
