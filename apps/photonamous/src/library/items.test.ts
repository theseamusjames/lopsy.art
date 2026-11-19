import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { albumHasItem, itemAssets, itemVersionId, nextVersionName, parseItem, setAlbumItem, versionItemId, versionsByAsset } from './items';
import { albumItemCount } from './asset-query';
import { albumItems, openVersions } from './finding';
import { makeAsset, makeView } from './test-fixtures';

const second = { id: 'v2', assetId: 'a', name: 'Version 2', recipe: DEFAULT_RECIPE, createdAt: '2026-03-01T00:00:00Z', thumb: null, screen: null, deleted: false };
const gone = { ...second, id: 'v3', name: 'Version 3', deleted: true };
const view = makeView([makeAsset('a'), makeAsset('b')], [], [second, gone]);

describe('grid items', () => {
  it('round-trips version items and finds their version', () => {
    const id = versionItemId('a', 'v2');
    expect(parseItem(id)).toEqual({ assetId: 'a', versionId: 'v2' });
    expect(parseItem('a')).toEqual({ assetId: 'a', versionId: null });
    expect(itemVersionId(id, view)).toBe('v2');
    expect(itemVersionId('a', view)).toBe('v-a');
    expect(itemAssets(['a', id, 'b'])).toEqual(['a', 'b']);
  });

  it('lists live versions oldest first and names the next one', () => {
    expect(versionsByAsset(view).get('a')?.map((v) => v.id)).toEqual(['v-a', 'v2']);
    expect(nextVersionName(['Original'])).toBe('Version 2');
    expect(nextVersionName(['Original', 'Version 2', 'version 3'])).toBe('Version 4');
  });

  it('opens a photo’s other versions after it', () => {
    expect(openVersions(['a', 'b'], view, new Set())).toEqual(['a', 'b']);
    expect(openVersions(['a', 'b'], view, new Set(['a']))).toEqual(['a', versionItemId('a', 'v2'), 'b']);
  });
});

describe('albums of photos and versions', () => {
  const album = {
    id: 'al',
    name: 'Picks',
    assetIds: ['b'],
    members: [
      { assetId: 'b', versionId: null },
      { assetId: 'a', versionId: 'v2' },
      { assetId: 'a', versionId: 'v3' }, // deleted: not shown
    ],
    deleted: false,
  };
  const albumView = makeView([makeAsset('a'), makeAsset('b')], [album], [second, gone]);

  it('shows whole photos and single versions as their own tiles', () => {
    expect(albumItems(['a', 'b'], album, albumView)).toEqual([versionItemId('a', 'v2'), 'b']);
    expect(albumItemCount(album, albumView)).toBe(2);
  });

  it('shows a member version that is the shown one as the photo', () => {
    const shown = { ...album, members: [{ assetId: 'a', versionId: 'v-a' }] };
    expect(albumItems(['a', 'b'], shown, albumView)).toEqual(['a']);
  });

  it('knows which tiles it holds and adds them the right way', () => {
    expect(albumHasItem(album, 'b')).toBe(true);
    expect(albumHasItem(album, 'a')).toBe(false);
    expect(albumHasItem(album, versionItemId('a', 'v2'))).toBe(true);
    const calls: unknown[][] = [];
    const session = { setAlbumMember: (...args: unknown[]) => calls.push(args) } as unknown as LibrarySession;
    setAlbumItem(session, 'al', 'b', true);
    setAlbumItem(session, 'al', versionItemId('a', 'v2'), false);
    expect(calls).toEqual([
      ['al', 'b', true, null],
      ['al', 'a', false, 'v2'],
    ]);
  });
});
