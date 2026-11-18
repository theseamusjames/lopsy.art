import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { itemAssets, itemVersionId, nextVersionName, parseItem, versionItemId, versionsByAsset } from './items';
import { openVersions } from './finding';
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
