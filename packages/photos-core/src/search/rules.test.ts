import { describe, expect, it, vi } from 'vitest';
import type { Json } from '../library/types';
import { compileSearch, filterAssets, parseSavedSearches, parseSearchRule, readSavedSearches, writeSavedSearches } from './rules';
import type { SavedSearch, SearchRule } from './rules';
import { asset, view } from './test-support/fixtures';

const a1 = asset({ id: 'r1', rating: 5, label: 'red', keywords: ['Trip'], gps: { lat: 1, lon: 2, alt: null }, edited: true });
const a2 = asset({
  id: 'r2',
  rating: 3,
  setAside: true,
  format: 'jpeg',
  camera: { make: 'FUJIFILM', model: 'X100VI' },
  lens: null,
  exposure: { iso: 3200, shutter: '1/60', aperture: 2, focalLength: 35 },
  capturedAt: '2025-06-01T10:00:00',
});
const a3 = asset({ id: 'r3', rating: 0, capturedAt: null, importedAt: '2026-01-02T00:00:00.000Z', exposure: null, camera: null });
const lib = view([a1, a2, a3], {
  albums: [{ id: 'al', name: 'Best', assetIds: ['r2', 'r3'], members: [{ assetId: 'r2', versionId: null }, { assetId: 'r3', versionId: null }], deleted: false }],
});

const ids = (rule: SearchRule) => filterAssets(lib, rule, true).map((a) => a.id);

describe('search rules', () => {
  it('evaluates every kind of rule', () => {
    expect(ids({ kind: 'rating', op: 'gte', value: 3 })).toEqual(['r1', 'r2']);
    expect(ids({ kind: 'rating', op: 'eq', value: 3 })).toEqual(['r2']);
    expect(ids({ kind: 'label', in: ['red'] })).toEqual(['r1']);
    expect(ids({ kind: 'label', in: ['none'] })).toEqual(['r2', 'r3']);
    expect(ids({ kind: 'setAside', value: true })).toEqual(['r2']);
    expect(ids({ kind: 'captureDate', from: '2025-01-01', to: '2025-12-31' })).toEqual(['r2']);
    expect(ids({ kind: 'captureDate', from: '2026-01-02', to: null })).toEqual(['r1', 'r3']);
    expect(ids({ kind: 'camera', in: ['x100vi'] })).toEqual(['r2']);
    expect(ids({ kind: 'lens', in: ['XF23mmF2.8 R WR'] })).toEqual(['r1', 'r3']);
    expect(ids({ kind: 'focalLength', min: 30, max: null })).toEqual(['r2']);
    expect(ids({ kind: 'iso', min: null, max: 800 })).toEqual(['r1']);
    expect(ids({ kind: 'format', in: ['jpeg', 'png'] })).toEqual(['r2']);
    expect(ids({ kind: 'keyword', value: 'trip' })).toEqual(['r1']);
    expect(ids({ kind: 'edited', value: true })).toEqual(['r1']);
    expect(ids({ kind: 'edited', value: false })).toEqual(['r2', 'r3']);
    expect(ids({ kind: 'hasLocation', value: true })).toEqual(['r1']);
    expect(ids({ kind: 'inAlbum', albumId: 'al' })).toEqual(['r2', 'r3']);
    expect(ids({ kind: 'inAlbum', albumId: 'missing' })).toEqual([]);
  });

  it('combines rules with AND/OR groups', () => {
    const rule: SearchRule = {
      kind: 'group',
      match: 'any',
      rules: [
        { kind: 'group', match: 'all', rules: [{ kind: 'rating', op: 'gte', value: 1 }, { kind: 'setAside', value: false }] },
        { kind: 'inAlbum', albumId: 'al' },
      ],
    };
    expect(ids(rule)).toEqual(['r1', 'r2', 'r3']);
    expect(ids({ kind: 'group', match: 'all', rules: [] })).toEqual(['r1', 'r2', 'r3']);
    expect(ids({ kind: 'group', match: 'any', rules: [] })).toEqual([]);
  });

  it('leaves deleted assets out unless asked', () => {
    const v = view([asset({ id: 'd', deleted: true })]);
    expect(filterAssets(v, { kind: 'group', match: 'all', rules: [] })).toEqual([]);
    expect(filterAssets(v, { kind: 'group', match: 'all', rules: [] }, true)).toHaveLength(1);
  });

  it('sees album changes in a new view with the same compiled rule', () => {
    const predicate = compileSearch({ kind: 'inAlbum', albumId: 'al' });
    expect(predicate(a1, lib)).toBe(false);
    const changed = { ...lib, albums: new Map([['al', { id: 'al', name: 'Best', assetIds: ['r1'], members: [{ assetId: 'r1', versionId: null }], deleted: false }]]) };
    expect(predicate(a1, changed)).toBe(true);
  });
});

describe('rule validation', () => {
  it('accepts valid rules and round-trips them through JSON', () => {
    const rule: SearchRule = {
      kind: 'group',
      match: 'all',
      rules: [
        { kind: 'rating', op: 'gte', value: 4 },
        { kind: 'label', in: ['red', 'none'] },
        { kind: 'captureDate', from: '2026-01-01', to: null },
        { kind: 'iso', min: 100, max: null },
        { kind: 'format', in: ['raf'] },
        { kind: 'camera', in: ['X-E5'] },
        { kind: 'hasLocation', value: false },
      ],
    };
    expect(parseSearchRule(JSON.parse(JSON.stringify(rule)))).toEqual(rule);
  });

  it('rejects malformed or hostile rules', () => {
    const bad: unknown[] = [
      null,
      'rating',
      { kind: 'rating', op: 'gt', value: 3 },
      { kind: 'rating', op: 'eq', value: 9 },
      { kind: 'label', in: ['pink'] },
      { kind: 'captureDate', from: '2026/01/01', to: null },
      { kind: 'iso', min: 'a', max: null },
      { kind: 'format', in: ['gif'] },
      { kind: 'keyword', value: '' },
      { kind: 'group', match: 'all', rules: [{ kind: 'nope' }] },
      { kind: 'unknown' },
    ];
    for (const b of bad) expect(parseSearchRule(b)).toBeNull();
    let deep: unknown = { kind: 'setAside', value: true };
    for (let i = 0; i < 20; i++) deep = { kind: 'group', match: 'all', rules: [deep] };
    expect(parseSearchRule(deep)).toBeNull();
    const wide = { kind: 'group', match: 'any', rules: Array.from({ length: 1000 }, () => ({ kind: 'setAside', value: true })) };
    expect(parseSearchRule(wide)).toBeNull();
  });

  it('reads and writes saved searches as a setting, dropping invalid entries', () => {
    const good: SavedSearch = { id: 's1', name: 'Five stars', rule: { kind: 'rating', op: 'eq', value: 5 } };
    const stored = [good, { id: 's2', name: 'Broken', rule: { kind: 'x' } }, { id: 's1', name: 'dupe', rule: good.rule }, 7] as unknown as Json;
    expect(readSavedSearches(view([], { settings: [['savedSearches', stored]] }))).toEqual([good]);
    expect(readSavedSearches(view([]))).toEqual([]);
    expect(parseSavedSearches({ not: 'a list' })).toEqual([]);
    const setSetting = vi.fn();
    writeSavedSearches({ setSetting }, [good]);
    expect(setSetting).toHaveBeenCalledWith('savedSearches', [good]);
    const written = setSetting.mock.calls[0]?.[1] as Json;
    expect(readSavedSearches(view([], { settings: [['savedSearches', JSON.parse(JSON.stringify(written)) as Json]] }))).toEqual([good]);
  });
});
