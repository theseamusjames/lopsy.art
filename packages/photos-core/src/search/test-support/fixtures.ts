import { DEFAULT_RECIPE } from '../../library/recipe';
import type { Album, Asset, Json, LibraryView, Version } from '../../library/types';

let next = 0;

export function asset(overrides: Partial<Asset> & { edited?: boolean } = {}): Asset & { edited?: boolean } {
  const id = overrides.id ?? `a${++next}`;
  return {
    id,
    kind: 'original',
    fileId: `f-${id}`,
    sha256: id.padEnd(64, '0'),
    fileName: `DSCF${id}.RAF`,
    byteSize: 1000,
    format: 'raf',
    mimeType: 'image/x-fuji-raf',
    capturedAt: '2026-11-14T16:02:11',
    importedAt: '2026-11-18T10:00:00.000Z',
    importId: 'i1',
    width: 7728,
    height: 5152,
    orientation: 1,
    camera: { make: 'FUJIFILM', model: 'X-E5' },
    lens: 'XF23mmF2.8 R WR',
    exposure: { iso: 200, shutter: '1/250', aperture: 5.6, focalLength: 23 },
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

/** A view of the assets, each with a primary version (edited when `edited` is set). */
export function view(
  assets: readonly (Asset & { edited?: boolean })[],
  extra: { albums?: Album[]; settings?: [string, Json][] } = {},
): LibraryView {
  const versions = new Map<string, Version>();
  for (const a of assets) {
    versions.set(a.primaryVersionId, {
      id: a.primaryVersionId,
      assetId: a.id,
      name: 'Original',
      recipe: a.edited ? { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, exposure: 0.5 } } : DEFAULT_RECIPE,
      createdAt: a.importedAt,
      thumb: null,
      screen: null,
      deleted: false,
    });
  }
  return {
    assets: new Map(assets.map((a) => [a.id, a])),
    versions,
    albums: new Map((extra.albums ?? []).map((al) => [al.id, al])),
    settings: new Map(extra.settings ?? []),
    presets: new Map(),
    exportPresets: new Map(),
  };
}
