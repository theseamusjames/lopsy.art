/**
 * Which photos the grid shows and in what order: the sidebar's collection,
 * the search text and the sort. Pure; memoised by the caller on the
 * library view's identity.
 */

import type { AlbumId, Asset, AssetId, LibraryView } from '@lopsy/photos-core/library/types';
import { isDefaultRecipe } from '@lopsy/photos-core/library/recipe';

export type Collection =
  | { readonly kind: 'all' }
  | { readonly kind: 'recent' }
  | { readonly kind: 'set-aside' }
  | { readonly kind: 'album'; readonly albumId: AlbumId }
  | { readonly kind: 'keyword'; readonly keyword: string };

export type SortKey = 'captured' | 'imported' | 'name' | 'rating';

export interface SortOrder {
  readonly key: SortKey;
  readonly descending: boolean;
}

export interface AssetQuery {
  readonly collection: Collection;
  readonly sort: SortOrder;
  readonly text: string;
}

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  captured: 'Date taken',
  imported: 'Date added',
  name: 'File name',
  rating: 'Rating',
};

const RAW_FORMATS = new Set(['raf', 'dng']);

export function isRaw(asset: Asset): boolean {
  return RAW_FORMATS.has(asset.format);
}

/**
 * A RAW and the JPEG shot with it show as one tile with the RAW in front,
 * so the JPEG half is hidden while its RAW is in the library.
 */
export function isHiddenPairHalf(asset: Asset, assets: ReadonlyMap<AssetId, Asset>): boolean {
  if (asset.pairedWith === null || isRaw(asset)) return false;
  const other = assets.get(asset.pairedWith);
  return other !== undefined && !other.deleted && isRaw(other);
}

/** The import id of the latest import, or null with no photos. */
export function latestImportId(assets: Iterable<Asset>): string | null {
  let best: Asset | null = null;
  for (const a of assets) {
    if (a.deleted) continue;
    if (best === null || a.importedAt > best.importedAt) best = a;
  }
  return best?.importId ?? null;
}

function inCollection(asset: Asset, collection: Collection, view: LibraryView, recentImport: string | null): boolean {
  switch (collection.kind) {
    case 'all':
      return !asset.setAside;
    case 'recent':
      return asset.importId === recentImport;
    case 'set-aside':
      return asset.setAside;
    case 'album': {
      const album = view.albums.get(collection.albumId);
      return album !== undefined && !album.deleted && album.assetIds.includes(asset.id);
    }
    case 'keyword':
      return asset.keywords.includes(collection.keyword);
  }
}

export function matchesText(asset: Asset, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (q === '') return true;
  if (asset.fileName.toLowerCase().includes(q)) return true;
  if (asset.title.toLowerCase().includes(q)) return true;
  if (asset.caption.toLowerCase().includes(q)) return true;
  return asset.keywords.some((k) => k.toLowerCase().includes(q));
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort comparator; ties fall back to file name, then id, so the order is stable. */
export function compareAssets(a: Asset, b: Asset, sort: SortOrder): number {
  let c = 0;
  switch (sort.key) {
    case 'captured':
      c = compareStrings(a.capturedAt ?? a.importedAt, b.capturedAt ?? b.importedAt);
      break;
    case 'imported':
      c = compareStrings(a.importedAt, b.importedAt);
      break;
    case 'name':
      c = a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
      break;
    case 'rating':
      c = a.rating - b.rating;
      break;
  }
  if (sort.descending) c = -c;
  if (c !== 0) return c;
  return compareStrings(a.fileName, b.fileName) || compareStrings(a.id, b.id);
}

/** The ids the grid shows, in order. */
export function queryAssets(view: LibraryView, query: AssetQuery): AssetId[] {
  const recent = query.collection.kind === 'recent' ? latestImportId(view.assets.values()) : null;
  const out: Asset[] = [];
  for (const asset of view.assets.values()) {
    if (asset.deleted) continue;
    if (isHiddenPairHalf(asset, view.assets)) continue;
    if (!inCollection(asset, query.collection, view, recent)) continue;
    if (!matchesText(asset, query.text)) continue;
    out.push(asset);
  }
  out.sort((a, b) => compareAssets(a, b, query.sort));
  return out.map((a) => a.id);
}

/** Whether the asset's shown version has edits. */
export function isEdited(asset: Asset, view: LibraryView): boolean {
  const version = view.versions.get(asset.primaryVersionId);
  return version !== undefined && !isDefaultRecipe(version.recipe);
}

/** Live versions per asset. */
export function versionCount(assetId: AssetId, view: LibraryView): number {
  let n = 0;
  for (const v of view.versions.values()) if (v.assetId === assetId && !v.deleted) n++;
  return n;
}

export interface SidebarCounts {
  readonly all: number;
  readonly recent: number;
  readonly setAside: number;
  readonly albums: ReadonlyMap<AlbumId, number>;
  /** Keyword to photo count, sorted by keyword. */
  readonly keywords: ReadonlyArray<readonly [string, number]>;
}

export function sidebarCounts(view: LibraryView): SidebarCounts {
  const recentImport = latestImportId(view.assets.values());
  let all = 0;
  let recent = 0;
  let setAside = 0;
  const keywords = new Map<string, number>();
  for (const a of view.assets.values()) {
    if (a.deleted || isHiddenPairHalf(a, view.assets)) continue;
    if (a.setAside) setAside++;
    else all++;
    if (a.importId === recentImport) recent++;
    for (const k of a.keywords) keywords.set(k, (keywords.get(k) ?? 0) + 1);
  }
  const albums = new Map<AlbumId, number>();
  for (const album of view.albums.values()) {
    if (album.deleted) continue;
    albums.set(album.id, album.assetIds.filter((id) => view.assets.get(id)?.deleted === false).length);
  }
  const sortedKeywords = [...keywords.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  return { all, recent, setAside, albums, keywords: sortedKeywords };
}

export function sameCollection(a: Collection, b: Collection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'album' && b.kind === 'album') return a.albumId === b.albumId;
  if (a.kind === 'keyword' && b.kind === 'keyword') return a.keyword === b.keyword;
  return true;
}
