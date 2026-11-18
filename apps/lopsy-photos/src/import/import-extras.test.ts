import { describe, expect, it } from 'vitest';
import type { ImportProgress } from '@lopsy/photos-core/import/types';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { makeAsset } from '../library/test-fixtures';
import { applyImportExtras, importedAssetIds, likelyDuplicates, parseKeywords } from './import-extras';

const item = (id: string, state: ImportProgress['items'][number]['state'], assetId: string | null) => ({
  id,
  fileName: `${id}.jpg`,
  byteSize: 1,
  state,
  sentBytes: 0,
  assetId,
  error: null,
});

describe('import extras', () => {
  it('warns about photos with the same name and size as ones in the library', () => {
    const assets = [makeAsset('a', { fileName: 'IMG_1.JPG', byteSize: 100 }), makeAsset('b', { fileName: 'gone.jpg', byteSize: 5, deleted: true })];
    const files = [
      { name: 'img_1.jpg', size: 100 },
      { name: 'img_1.jpg', size: 101 },
      { name: 'gone.jpg', size: 5 },
      { name: 'notes.txt', size: 100 },
    ];
    expect(likelyDuplicates(files, assets)).toEqual([{ name: 'img_1.jpg', size: 100 }]);
  });

  it('reads keywords and finds what the import brought in', () => {
    expect(parseKeywords(' holiday, Family ,, family ')).toEqual(['holiday', 'Family']);
    const progress = { items: [item('1', 'done', 'a'), item('2', 'duplicate', 'b'), item('3', 'failed', null)] } as unknown as ImportProgress;
    expect(importedAssetIds(progress)).toEqual(['a', 'b']);
  });

  it('adds the photos to the album and keywords as one step', () => {
    const calls: string[] = [];
    const session = {
      libraryStep: (label: string, fn: () => void) => {
        calls.push(`step ${label}`);
        fn();
      },
      setAlbumMember: (album: string, id: string) => calls.push(`album ${album} ${id}`),
      setKeyword: (ids: string[], k: string) => calls.push(`keyword ${k} ${ids.join(',')}`),
    } as unknown as LibrarySession;
    const progress = { items: [item('1', 'done', 'a')] } as unknown as ImportProgress;
    expect(applyImportExtras(session, progress, { albumId: 'al', keywords: ['trip'] })).toBe(1);
    expect(calls).toEqual(['step Album and keywords for the import', 'album al a', 'keyword trip a']);
  });
});
