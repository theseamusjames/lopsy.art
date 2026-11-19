import { describe, expect, it } from 'vitest';
import { importLabel, importLabels, datePrefixLabel, facetRule, findAssets, hasFacets, importBatches, NO_FACETS, ruleForSaving, toggleValue, type FindQuery } from './finding';
import { makeAsset, makeView } from './test-fixtures';

const x100 = { make: 'FUJIFILM', model: 'X100VI' };
const xt5 = { make: 'FUJIFILM', model: 'X-T5' };

const view = makeView([
  makeAsset('a', { camera: x100, rating: 5, capturedAt: '2026-03-01T10:00:00', fileName: 'harbour.jpg' }),
  makeAsset('b', { camera: x100, rating: 2, capturedAt: '2026-03-01T10:00:01' }),
  makeAsset('c', { camera: xt5, rating: 4, capturedAt: '2026-04-02T09:00:00', label: 'red', importId: 'imp-2', importedAt: '2026-05-01T00:00:00Z' }),
]);

const query: FindQuery = {
  collection: { kind: 'all' },
  sort: { key: 'captured', descending: false },
  text: '',
  facets: NO_FACETS,
  groupBursts: false,
  expanded: new Set(),
  savedSearches: [],
};

describe('findAssets', () => {
  it('narrows by facets and counts over the set before them', () => {
    const r = findAssets(view, { ...query, facets: { ...NO_FACETS, cameras: ['X100VI'], minRating: 3 } }, null);
    expect(r.ids).toEqual(['a']);
    expect(r.facets.total).toBe(3);
    expect(r.facets.camera).toEqual([
      { value: 'X100VI', count: 2 },
      { value: 'X-T5', count: 1 },
    ]);
  });

  it('browses a date, an import and a saved search', () => {
    expect(findAssets(view, { ...query, collection: { kind: 'date', prefix: '2026-03' } }, null).ids).toEqual(['a', 'b']);
    expect(findAssets(view, { ...query, collection: { kind: 'import', importId: 'imp-2' } }, null).ids).toEqual(['c']);
    const saved = [{ id: 's', name: 'Red', rule: { kind: 'label' as const, in: ['red' as const] } }];
    expect(findAssets(view, { ...query, collection: { kind: 'saved', searchId: 's' }, savedSearches: saved }, null).ids).toEqual(['c']);
    expect(findAssets(view, { ...query, collection: { kind: 'saved', searchId: 'gone' } }, null).ids).toEqual([]);
  });

  it('uses the text matcher it is given', () => {
    expect(findAssets(view, { ...query, text: 'anything' }, (a) => a.id === 'b').ids).toEqual(['b']);
    expect(findAssets(view, { ...query, text: 'harbour' }, null).ids).toEqual(['a']);
  });

  it('groups a burst behind its best-rated shot, and opens it', () => {
    const grouped = findAssets(view, { ...query, groupBursts: true }, null);
    expect(grouped.ids).toEqual(['a', 'c']);
    expect(grouped.bursts.get('a')).toBe(2);
    const open = findAssets(view, { ...query, groupBursts: true, expanded: new Set(['a']) }, null);
    expect(open.ids).toEqual(['a', 'b', 'c']);
  });
});

describe('facets and saving', () => {
  it('builds rules', () => {
    expect(hasFacets(NO_FACETS)).toBe(false);
    expect(facetRule(NO_FACETS)).toBeNull();
    expect(facetRule({ ...NO_FACETS, edited: true })).toEqual({ kind: 'edited', value: true });
    expect(facetRule({ ...NO_FACETS, edited: true, minRating: 3 })).toEqual({
      kind: 'group',
      match: 'all',
      rules: [
        { kind: 'rating', op: 'gte', value: 3 },
        { kind: 'edited', value: true },
      ],
    });
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('saves the collection with the facets', () => {
    expect(ruleForSaving({ kind: 'date', prefix: '2026-03' }, NO_FACETS, null)).toEqual({
      kind: 'captureDate',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(ruleForSaving({ kind: 'recent' }, NO_FACETS, null)).toBeNull();
  });

  it('names dates and lists imports newest first', () => {
    expect(datePrefixLabel('2026-03')).toBe('March 2026');
    expect(datePrefixLabel('2026-03-04')).toBe('4 March 2026');
    expect(importBatches(view).map((b) => [b.importId, b.count])).toEqual([
      ['imp-2', 1],
      ['imp-1', 2],
    ]);
  });
});

describe('importLabel', () => {
  it('is short, with the year only when it differs', () => {
    const now = new Date(2026, 10, 18, 12, 0);
    expect(importLabel(new Date(2026, 2, 14, 9, 30).toISOString(), now)).toBe('14 Mar, 09:30');
    expect(importLabel(new Date(2025, 11, 1, 18, 5).toISOString(), now)).toBe('1 Dec 2025, 18:05');
  });

  it('adds seconds only where two imports share a minute', () => {
    const now = new Date(2026, 10, 18, 15, 0);
    const at = (s: number) => new Date(2026, 10, 18, 14, 38, s).toISOString();
    const labels = importLabels(
      [
        { importId: 'a', importedAt: at(5), count: 1 },
        { importId: 'b', importedAt: at(40), count: 2 },
        { importId: 'c', importedAt: new Date(2026, 10, 18, 9, 1).toISOString(), count: 3 },
      ],
      now,
    );
    expect([...labels.values()]).toEqual(['18 Nov, 14:38:05', '18 Nov, 14:38:40', '18 Nov, 09:01']);
  });
});
