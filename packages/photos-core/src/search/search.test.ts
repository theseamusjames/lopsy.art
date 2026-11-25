import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '../library/recipe';
import { groupBursts } from './bursts';
import { buildDateTree } from './dates';
import { computeFacets } from './facets';
import { TextIndex, normalizeText, parseTextQuery, tokenize } from './text';
import { asset, view } from './test-support/fixtures';

describe('free-text search', () => {
  it('normalizes case and accents and splits words', () => {
    expect(normalizeText('Éte À Zürich')).toBe('ete a zurich');
    expect(tokenize('Café-crème, 2026!')).toEqual(['cafe', 'creme', '2026']);
  });

  it('matches every query word as a word prefix across the fields', () => {
    const a = asset({ id: 't1', title: 'Harbour at dusk', keywords: ['Boulogne'], fileName: 'DSCF0001.RAF' });
    const b = asset({ id: 't2', caption: 'Café crème', camera: { make: 'Leica', model: 'Q3' }, lens: null });
    const c = asset({ id: 't3', lens: 'Summilux 28' });
    const index = new TextIndex();
    index.update(view([a, b, c]));
    expect(index.search('har bou')).toEqual(['t1']);
    expect(index.search('CAFE')).toEqual(['t2']);
    expect(index.search('leica')).toEqual(['t2']);
    expect(index.search('summi')).toEqual(['t3']);
    expect(index.search('dscf0001')).toEqual(['t1']);
    expect(index.search('arbour')).toEqual([]);
    expect(index.search('')).toEqual(['t1', 't2', 't3']);
    expect(index.matches('t1', parseTextQuery('dusk'))).toBe(true);
  });

  it('re-indexes only the assets whose object changed, and drops removed ones', () => {
    const assets = Array.from({ length: 10 }, (_, i) => asset({ id: `u${i}`, title: `photo ${i}` }));
    const index = new TextIndex();
    const v1 = view(assets);
    index.update(v1);
    expect(index.lastReindexed).toBe(10);
    index.update(v1);
    expect(index.lastReindexed).toBe(0);
    const changed = { ...assets[3], title: 'sunset' } as (typeof assets)[number];
    const v2 = { ...v1, assets: new Map([...v1.assets].filter(([id]) => id !== 'u9').map(([id, a]) => [id, id === 'u3' ? changed : a])) };
    index.update(v2);
    expect(index.lastReindexed).toBe(1);
    expect(index.size).toBe(9);
    expect(index.search('sunset')).toEqual(['u3']);
  });
});

describe('facets', () => {
  it('counts camera, lens, rating, label, format and edited', () => {
    const assets = [
      asset({ rating: 5, label: 'red', edited: true }),
      asset({ rating: 5, camera: { make: 'FUJIFILM', model: 'X100VI' }, lens: null, format: 'jpeg' }),
      asset({ camera: null }),
    ];
    const f = computeFacets(assets, view(assets));
    expect(f.total).toBe(3);
    expect(f.camera).toEqual([
      { value: 'X-E5', count: 1 },
      { value: 'X100VI', count: 1 },
    ]);
    expect(f.lens).toEqual([{ value: 'XF23mmF2.8 R WR', count: 2 }]);
    expect(f.rating.map((r) => r.count)).toEqual([1, 0, 0, 0, 0, 2]);
    expect(f.label.find((l) => l.value === 'red')?.count).toBe(1);
    expect(f.label.find((l) => l.value === 'none')?.count).toBe(2);
    expect(f.format).toEqual([
      { value: 'raf', count: 2 },
      { value: 'jpeg', count: 1 },
    ]);
    expect(f.edited).toEqual({ edited: 1, unedited: 2 });
  });
});

describe('edited', () => {
  it('treats a copy of the default recipe as unedited and a crop as edited', () => {
    const plain = asset({ id: 'e1' });
    const cropped = asset({ id: 'e2' });
    const v = view([plain, cropped]);
    const versions = new Map(v.versions);
    const base = versions.get('v-e1');
    if (!base) throw new Error('no version');
    versions.set('v-e1', { ...base, recipe: structuredClone(DEFAULT_RECIPE) });
    versions.set('v-e2', {
      ...base,
      id: 'v-e2',
      recipe: { ...DEFAULT_RECIPE, framing: { ...DEFAULT_RECIPE.framing, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } } },
    });
    expect(computeFacets([plain, cropped], { ...v, versions }).edited).toEqual({ edited: 1, unedited: 1 });
  });
});

describe('date tree', () => {
  it('groups by year, month and day, newest first, falling back to the import date', () => {
    const tree = buildDateTree([
      asset({ capturedAt: '2026-11-14T10:00:00' }),
      asset({ capturedAt: '2026-11-14T11:00:00+01:00' }),
      asset({ capturedAt: '2026-11-02T10:00:00' }),
      asset({ capturedAt: '2026-01-05T10:00:00' }),
      asset({ capturedAt: '2024-07-04T10:00:00' }),
      asset({ capturedAt: null, importedAt: '2025-03-03T09:00:00.000Z' }),
    ]);
    expect(tree.map((y) => [y.year, y.count])).toEqual([
      ['2026', 4],
      ['2025', 1],
      ['2024', 1],
    ]);
    expect(tree[0]?.months.map((m) => [m.month, m.count, m.days.map((d) => [d.day, d.count])])).toEqual([
      ['2026-11', 3, [['2026-11-14', 2], ['2026-11-02', 1]]],
      ['2026-01', 1, [['2026-01-05', 1]]],
    ]);
  });
});

describe('bursts', () => {
  const at = (s: number, extra: Parameters<typeof asset>[0] = {}) =>
    asset({ capturedAt: `2026-11-14T16:02:${String(s).padStart(2, '0')}`, ...extra });

  it('groups shots from one camera within the window, chained, with the best rated as cover', () => {
    const shots = [at(0, { id: 'b0' }), at(1, { id: 'b1', rating: 3 }), at(3, { id: 'b2', rating: 3 }), at(10, { id: 'b3' })];
    const other = at(2, { id: 'o', camera: { make: 'Canon', model: 'R5' } });
    const undated = asset({ id: 'n', capturedAt: null });
    const bursts = groupBursts([...shots, other, undated]);
    expect(bursts).toEqual([
      { coverId: 'b1', assetIds: ['b0', 'b1', 'b2'] },
      { coverId: 'b3', assetIds: ['b3'] },
      { coverId: 'o', assetIds: ['o'] },
      { coverId: 'n', assetIds: ['n'] },
    ]);
  });

  it('keeps the input order and honours the window option', () => {
    const shots = [at(9, { id: 'c2' }), at(0, { id: 'c0' }), at(4, { id: 'c1' })];
    expect(groupBursts(shots).map((b) => b.assetIds)).toEqual([['c2'], ['c0'], ['c1']]);
    expect(groupBursts(shots, { windowSeconds: 5 })).toEqual([{ coverId: 'c0', assetIds: ['c0', 'c1', 'c2'] }]);
  });
});
