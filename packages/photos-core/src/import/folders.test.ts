import { describe, expect, it } from 'vitest';
import { ensureFolderPath, originalsFolderSegments, uniqueName } from './folders';
import type { FolderCache } from './folders';
import { captureTimesMatch, findRawJpegPairs, pairCandidatesByName } from './pairs';
import { TestMemoryAdapter } from './test-support/memory-adapter';

describe('originalsFolderSegments', () => {
  it('uses the capture date as written', () => {
    expect(originalsFolderSegments('2026-11-14T16:02:11', new Date(2020, 0, 1))).toEqual(['2026', '2026-11-14']);
    expect(originalsFolderSegments('2026-11-14T23:59:59-08:00', new Date(2020, 0, 1))).toEqual(['2026', '2026-11-14']);
  });

  it('falls back to the given date in local time', () => {
    expect(originalsFolderSegments(null, new Date(2025, 1, 3, 12))).toEqual(['2025', '2025-02-03']);
    expect(originalsFolderSegments('garbage', new Date(2025, 11, 31, 23, 30))).toEqual(['2025', '2025-12-31']);
  });
});

describe('uniqueName', () => {
  it('adds (2), (3) before the extension', () => {
    expect(uniqueName([], 'DSCF1234.RAF')).toBe('DSCF1234.RAF');
    expect(uniqueName(['DSCF1234.RAF'], 'DSCF1234.RAF')).toBe('DSCF1234 (2).RAF');
    expect(uniqueName(['dscf1234.raf', 'DSCF1234 (2).RAF'], 'DSCF1234.RAF')).toBe('DSCF1234 (3).RAF');
    expect(uniqueName(['README'], 'README')).toBe('README (2)');
    expect(uniqueName(['.hidden'], '.hidden')).toBe('.hidden (2)');
    expect(uniqueName(['a.tar.gz'], 'a.tar.gz')).toBe('a.tar (2).gz');
  });
});

describe('ensureFolderPath', () => {
  it('finds or creates each level once, even when called concurrently', async () => {
    const adapter = new TestMemoryAdapter();
    const root = await adapter.getRoot();
    const existing = await adapter.createFolder(root.id, '2026');
    const cache: FolderCache = new Map();
    adapter.createFolderCalls = 0;
    const [a, b] = await Promise.all([
      ensureFolderPath(adapter, root.id, ['2026', '2026-11-14'], cache),
      ensureFolderPath(adapter, root.id, ['2026', '2026-11-14'], cache),
    ]);
    expect(a).toBe(b);
    expect(adapter.createFolderCalls).toBe(1);
    expect((await adapter.getFile(a))?.parentId).toBe(existing.id);
    expect(await ensureFolderPath(adapter, root.id, ['2026', '2026-11-14'], new Map())).toBe(a);
  });

  it('forgets a failed lookup so the next call retries', async () => {
    const adapter = new TestMemoryAdapter();
    const root = await adapter.getRoot();
    const cache: FolderCache = new Map();
    await expect(ensureFolderPath(adapter, 'missing', ['2026'], cache)).rejects.toThrow();
    expect(cache.size).toBe(0);
    expect(await ensureFolderPath(adapter, root.id, ['2026'], cache)).toBeTruthy();
  });
});

describe('RAW+JPEG pairing', () => {
  it('matches capture times within 2 s, or both missing', () => {
    expect(captureTimesMatch('2026-11-14T16:02:11', '2026-11-14T16:02:13')).toBe(true);
    expect(captureTimesMatch('2026-11-14T16:02:11', '2026-11-14T16:02:14')).toBe(false);
    expect(captureTimesMatch('2026-11-14T23:59:59', '2026-11-15T00:00:01')).toBe(true);
    expect(captureTimesMatch('2026-11-14T16:02:11+01:00', '2026-11-14T16:02:11')).toBe(true);
    expect(captureTimesMatch(null, null)).toBe(true);
    expect(captureTimesMatch(null, '2026-11-14T16:02:11')).toBe(false);
  });

  it('finds candidates by base name, case-insensitively', () => {
    const pairs = pairCandidatesByName([
      { id: 'a', name: 'DSCF1234.RAF' },
      { id: 'b', name: 'dscf1234.jpg' },
      { id: 'c', name: 'DSCF9999.JPG' },
      { id: 'd', name: 'DSCF5555.DNG' },
      { id: 'e', name: 'DSCF5555.JPEG' },
      { id: 'f', name: 'DSCF5555.jpg' },
    ]);
    expect([...pairs]).toEqual([
      ['b', 'a'],
      ['e', 'd'],
    ]);
  });

  it('pairs read files by format, name and time', () => {
    const t = '2026-11-14T16:02:11';
    const pairs = findRawJpegPairs([
      { id: '1', name: 'DSCF1.RAF', format: 'raf', capturedAt: t },
      { id: '2', name: 'DSCF1.JPG', format: 'jpeg', capturedAt: '2026-11-14T16:02:12' },
      { id: '3', name: 'DSCF2.RAF', format: 'raf', capturedAt: t },
      { id: '4', name: 'DSCF2.JPG', format: 'jpeg', capturedAt: '2026-11-14T17:00:00' },
      { id: '5', name: 'DSCF3.PNG', format: 'png', capturedAt: t },
      { id: '6', name: 'DSCF3.JPG', format: 'jpeg', capturedAt: t },
    ]);
    expect(pairs.map((p) => [p.raw.id, p.jpeg.id])).toEqual([['1', '2']]);
  });
});
