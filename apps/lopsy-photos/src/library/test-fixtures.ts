/** Builders for unit tests of the pure library modules. */

import type { Album, Asset, LibraryView, Version } from '@lopsy/photos-core/library/types';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';

export function makeAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'original',
    fileId: `file-${id}`,
    sha256: `sha-${id}`,
    fileName: `${id}.jpg`,
    byteSize: 1000,
    format: 'jpeg',
    mimeType: 'image/jpeg',
    capturedAt: '2026-01-01T10:00:00',
    importedAt: '2026-02-01T10:00:00.000Z',
    importId: 'imp-1',
    width: 6000,
    height: 4000,
    orientation: 1,
    camera: null,
    lens: null,
    exposure: null,
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
    rating: 0,
    label: null,
    setAside: false,
    title: '',
    caption: '',
    keywords: [],
    primaryVersionId: `v-${id}`,
    deleted: false,
    ...overrides,
  };
}

export function makeView(assets: Asset[], albums: Album[] = [], versions: Version[] = []): LibraryView {
  const versionMap = new Map<string, Version>();
  for (const a of assets) {
    versionMap.set(a.primaryVersionId, {
      id: a.primaryVersionId,
      assetId: a.id,
      name: 'Original',
      recipe: DEFAULT_RECIPE,
      createdAt: a.importedAt,
      thumb: null,
      screen: null,
      deleted: false,
    });
  }
  for (const v of versions) versionMap.set(v.id, v);
  return {
    assets: new Map(assets.map((a) => [a.id, a])),
    versions: versionMap,
    albums: new Map(albums.map((a) => [a.id, a])),
    settings: new Map(),
  };
}
