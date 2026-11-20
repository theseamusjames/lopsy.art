import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import type { PreviewRef, Version } from '@lopsy/photos-core/library/types';
import { currentStripId, editTargetOf, filmstripEntries } from './filmstrip';
import { openVersions } from './finding';
import { versionItemId } from './items';
import { makeAsset, makeView } from './test-fixtures';

const thumb = (fileId: string): PreviewRef => ({ fileId, recipeHash: 'h', width: 512, height: 341 });
const version = (id: string, assetId: string, name: string, extra: Partial<Version> = {}): Version => ({
  id,
  assetId,
  name,
  recipe: DEFAULT_RECIPE,
  createdAt: '2026-03-01T00:00:00Z',
  thumb: null,
  screen: null,
  deleted: false,
  ...extra,
});

// A Lopsy document made from photo a, with a version of its own, saved without a render; and one saved with its render.
const doc = makeAsset('doc', { kind: 'document', fileName: 'a.lopsy', format: 'lopsy', source: { assetId: 'a', versionId: 'v-a', recipeHash: 'h' } });
const rendered = makeAsset('rendered', { kind: 'document', fileName: 'r.lopsy', format: 'lopsy', renderFileId: 'r-png' });
const view = makeView(
  [makeAsset('a'), makeAsset('b'), doc, rendered, makeAsset('trashed', { deleted: true })],
  [],
  [
    version('v2', 'a', 'Version 2', { thumb: thumb('thumb-v2') }),
    version('v3', 'a', 'Bright'),
    version('gone', 'a', 'Version 4', { deleted: true }),
    version('dv2', 'doc', 'Version 2'),
  ],
);
const A2 = versionItemId('a', 'v2');
const A3 = versionItemId('a', 'v3');

describe('the Edit view’s filmstrip', () => {
  it('has a Lopsy document with its render, edited on that render; leaves one without a render out, its version tiles too', () => {
    const ids = ['a', 'doc', versionItemId('doc', 'dv2'), 'rendered', 'b'];
    expect(filmstripEntries(ids, view).map((e) => e.id)).toEqual(['a', 'rendered', 'b']);
  });

  it('shows a photo’s open versions as their own tiles: named, with their own thumbnail, opening that version', () => {
    // The grid with a's stack open: a, then its other live versions.
    const ids = openVersions(['a', 'b'], view, new Set(['a']));
    expect(ids).toEqual(['a', A2, A3, 'b']);
    expect(filmstripEntries(ids, view)).toEqual([
      { id: 'a', assetId: 'a', versionId: 'v-a', label: 'a.jpg', thumb: null },
      { id: A2, assetId: 'a', versionId: 'v2', label: 'a.jpg (Version 2)', thumb: thumb('thumb-v2') },
      { id: A3, assetId: 'a', versionId: 'v3', label: 'a.jpg (Bright)', thumb: null },
      { id: 'b', assetId: 'b', versionId: 'v-b', label: 'b.jpg', thumb: null },
    ]);
  });

  it('drops tiles whose photo or version is gone', () => {
    const ids = ['a', 'trashed', 'missing', versionItemId('a', 'gone'), versionItemId('b', 'v2')];
    expect(filmstripEntries(ids, view).map((e) => e.id)).toEqual(['a']);
  });

  it('opens what a tile shows, and never a document without its render', () => {
    expect(editTargetOf(view, 'a')).toEqual({ assetId: 'a', versionId: 'v-a' });
    expect(editTargetOf(view, A2)).toEqual({ assetId: 'a', versionId: 'v2' });
    expect(editTargetOf(view, 'rendered')).toEqual({ assetId: 'rendered', versionId: 'v-rendered' });
    expect(editTargetOf(view, 'doc')).toBeNull();
    expect(editTargetOf(view, versionItemId('doc', 'dv2'))).toBeNull();
    expect(editTargetOf(view, 'missing')).toBeNull();
    // A version of another photo is not this photo's.
    expect(editTargetOf(view, versionItemId('b', 'v2'))).toBeNull();
  });

  it('marks the version’s own tile, else the photo’s first tile, else none', () => {
    const open = openVersions(['a', 'b'], view, new Set(['a']));
    const folded = ['a', 'b'];
    expect(currentStripId(filmstripEntries(open, view), view, { assetId: 'a', versionId: 'v2' })).toBe(A2);
    expect(currentStripId(filmstripEntries(open, view), view, { assetId: 'a', versionId: 'v-a' })).toBe('a');
    // Its stack folded, a version is edited on the photo's tile.
    expect(currentStripId(filmstripEntries(folded, view), view, { assetId: 'a', versionId: 'v3' })).toBe('a');
    // An album holding only Version 2: the shown version is marked on that tile.
    expect(currentStripId(filmstripEntries([A2, 'b'], view), view, { assetId: 'a', versionId: 'v-a' })).toBe(A2);
    // Not in the grid: an id no tile has.
    const entries = filmstripEntries(['b'], view);
    expect(entries.some((e) => e.id === currentStripId(entries, view, { assetId: 'a', versionId: 'v2' }))).toBe(false);
  });
});
