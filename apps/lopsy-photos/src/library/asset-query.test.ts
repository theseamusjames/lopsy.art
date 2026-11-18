import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { isEdited, queryAssets, sidebarCounts, type AssetQuery } from './asset-query';
import { makeAsset, makeView } from './test-fixtures';

const byCapture: AssetQuery = { collection: { kind: 'all' }, sort: { key: 'captured', descending: false }, text: '' };

describe('queryAssets', () => {
  it('sorts by capture time, falling back to import time, with stable ties', () => {
    const view = makeView([
      makeAsset('b', { capturedAt: '2026-01-02T00:00:00' }),
      makeAsset('a', { capturedAt: '2026-01-02T00:00:00' }),
      makeAsset('c', { capturedAt: null, importedAt: '2025-01-01T00:00:00Z' }),
    ]);
    expect(queryAssets(view, byCapture)).toEqual(['c', 'a', 'b']);
    expect(queryAssets(view, { ...byCapture, sort: { key: 'captured', descending: true } })).toEqual(['a', 'b', 'c']);
  });

  it('sorts file names numerically', () => {
    const view = makeView([
      makeAsset('x', { fileName: 'IMG_10.jpg' }),
      makeAsset('y', { fileName: 'IMG_9.jpg' }),
    ]);
    expect(queryAssets(view, { ...byCapture, sort: { key: 'name', descending: false } })).toEqual(['y', 'x']);
  });

  it('sorts by rating', () => {
    const view = makeView([makeAsset('a', { rating: 2 }), makeAsset('b', { rating: 5 }), makeAsset('c', { rating: 0 })]);
    expect(queryAssets(view, { ...byCapture, sort: { key: 'rating', descending: true } })).toEqual(['b', 'a', 'c']);
  });

  it('keeps set-aside and deleted photos out of All photos', () => {
    const view = makeView([makeAsset('a'), makeAsset('b', { setAside: true }), makeAsset('c', { deleted: true })]);
    expect(queryAssets(view, byCapture)).toEqual(['a']);
    expect(queryAssets(view, { ...byCapture, collection: { kind: 'set-aside' } })).toEqual(['b']);
  });

  it('shows a RAW+JPEG pair as the RAW alone', () => {
    const view = makeView([
      makeAsset('raw', { format: 'raf', pairedWith: 'jpg', fileName: 'DSCF1.RAF' }),
      makeAsset('jpg', { pairedWith: 'raw', fileName: 'DSCF1.JPG' }),
    ]);
    expect(queryAssets(view, byCapture)).toEqual(['raw']);
  });

  it('filters by album, keyword, recent import and text', () => {
    const view = makeView(
      [
        makeAsset('a', { keywords: ['beach'], importId: 'old', importedAt: '2026-01-01T00:00:00Z' }),
        makeAsset('b', { title: 'Sunset at the pier', importId: 'new', importedAt: '2026-03-01T00:00:00Z' }),
        makeAsset('c', { importId: 'new', importedAt: '2026-03-01T00:00:01Z' }),
      ],
      [{ id: 'al', name: 'Trip', assetIds: ['a', 'c'], members: [{ assetId: 'a', versionId: null }, { assetId: 'c', versionId: null }], deleted: false }],
    );
    expect(queryAssets(view, { ...byCapture, collection: { kind: 'album', albumId: 'al' } })).toEqual(['a', 'c']);
    expect(queryAssets(view, { ...byCapture, collection: { kind: 'keyword', keyword: 'beach' } })).toEqual(['a']);
    expect(queryAssets(view, { ...byCapture, collection: { kind: 'recent' } })).toEqual(['b', 'c']);
    expect(queryAssets(view, { ...byCapture, text: 'PIER' })).toEqual(['b']);
    expect(queryAssets(view, { ...byCapture, text: 'beach' })).toEqual(['a']);
  });

  it('handles 50,000 photos quickly', () => {
    const assets = Array.from({ length: 50_000 }, (_, i) =>
      makeAsset(`a${i}`, { capturedAt: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00`, fileName: `IMG_${i}.jpg` }),
    );
    const view = makeView(assets);
    const start = performance.now();
    const ids = queryAssets(view, byCapture);
    expect(ids.length).toBe(50_000);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe('sidebarCounts and badges', () => {
  it('counts collections and keywords', () => {
    const view = makeView(
      [makeAsset('a', { keywords: ['x', 'y'] }), makeAsset('b', { setAside: true, keywords: ['x'] })],
      [{ id: 'al', name: 'A', assetIds: ['a'], members: [{ assetId: 'a', versionId: null }], deleted: false }],
    );
    const counts = sidebarCounts(view);
    expect(counts.all).toBe(1);
    expect(counts.setAside).toBe(1);
    expect(counts.recent).toBe(2);
    expect(counts.albums.get('al')).toBe(1);
    expect(counts.keywords).toEqual([
      ['x', 2],
      ['y', 1],
    ]);
  });

  it('knows an edited photo from its recipe', () => {
    const a = makeAsset('a');
    const plain = makeView([a]);
    expect(isEdited(a, plain)).toBe(false);
    const edited = makeView([a], [], [
      {
        id: a.primaryVersionId,
        assetId: 'a',
        name: 'Original',
        recipe: { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, exposure: 0.5 } },
        createdAt: a.importedAt,
        thumb: null,
        screen: null,
        deleted: false,
      },
    ]);
    expect(isEdited(a, edited)).toBe(true);
  });
});
