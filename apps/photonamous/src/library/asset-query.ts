/**
 * Which photos the grid shows and in what order: the sidebar's collection,
 * the search text and the sort. Pure; memoised by the caller on the
 * library view's identity.
 */

import type { Album, AlbumId, Asset, AssetId, LibraryView } from '@lopsy/photos-core/library/types';
import { isDefaultRecipe } from '@lopsy/photos-core/library/recipe';

export type Collection =
  | { readonly kind: 'all' }
  | { readonly kind: 'recent' }
  | { readonly kind: 'set-aside' }
  | { readonly kind: 'album'; readonly albumId: AlbumId }
  | { readonly kind: 'keyword'; readonly keyword: string }
  /** 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' of the capture (else import) date. */
  | { readonly kind: 'date'; readonly prefix: string }
  | { readonly kind: 'import'; readonly importId: string }
  /** A saved search; its rule is compiled by the caller (finding.ts). */
  | { readonly kind: 'saved'; readonly searchId: string };

export type SortKey = 'captured' | 'imported' | 'edited' | 'name' | 'rating';

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
  edited: 'Last edited',
  name: 'File name',
  rating: 'Rating',
};

/** Each order's natural direction: newest, best and most recently edited first; names A to Z. */
export const SORT_DESCENDING: Readonly<Record<SortKey, boolean>> = {
  captured: true,
  imported: true,
  edited: true,
  name: false,
  rating: true,
};

/** The direction button's words for an order. */
export function sortDirectionLabel(sort: SortOrder): string {
  const [down, up] =
    sort.key === 'name'
      ? ['Z to A', 'A to Z']
      : sort.key === 'rating'
        ? ['Highest first', 'Lowest first']
        : sort.key === 'edited'
          ? ['Most recently edited first', 'Longest ago first']
          : ['Newest first', 'Oldest first'];
  return `${sort.descending ? down : up} (click to reverse)`;
}

const RAW_FORMATS = new Set(['raf', 'dng', 'arw']);

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

/**
 * RAW+JPEG partners, both ways. Import records the pair on one half only
 * (the JPEG points at its RAW), so the RAW's tile learns of its JPEG here.
 * Only pairs whose halves are both in the library.
 */
export function pairPartners(assets: ReadonlyMap<AssetId, Asset>): Map<AssetId, AssetId> {
  const out = new Map<AssetId, AssetId>();
  for (const a of assets.values()) {
    if (a.deleted || a.pairedWith === null) continue;
    const other = assets.get(a.pairedWith);
    if (!other || other.deleted || other.id === a.id) continue;
    out.set(a.id, other.id);
    if (!out.has(other.id)) out.set(other.id, a.id);
  }
  return out;
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
      return album !== undefined && !album.deleted && album.members.some((m) => m.assetId === asset.id);
    }
    case 'keyword':
      return asset.keywords.includes(collection.keyword);
    case 'date':
      return !asset.setAside && (asset.capturedAt ?? asset.importedAt).startsWith(collection.prefix);
    case 'import':
      return asset.importId === collection.importId;
    case 'saved':
      return true;
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

const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort comparator; ties fall back to file name, then id, so the order is
 * stable. `editedAt` gives an asset's last edit as a sortable string, or
 * null when it was never edited (`lastEditedIn`); unedited photos come
 * after edited ones either way.
 */
export function compareAssets(a: Asset, b: Asset, sort: SortOrder, editedAt?: (asset: Asset) => string | null): number {
  let c = 0;
  switch (sort.key) {
    case 'edited': {
      const x = editedAt?.(a) ?? null;
      const y = editedAt?.(b) ?? null;
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
        break;
      }
      c = compareStrings(x, y);
      break;
    }
    case 'captured':
      c = compareStrings(a.capturedAt ?? a.importedAt, b.capturedAt ?? b.importedAt);
      break;
    case 'imported':
      c = compareStrings(a.importedAt, b.importedAt);
      break;
    case 'name':
      c = fileNameCollator.compare(a.fileName, b.fileName);
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
/**
 * The assets the collection and the text leave, unsorted. `textMatch`
 * replaces the plain text scan (an index); `extra` narrows further (a
 * saved search's rule).
 */
export function baseAssets(
  view: LibraryView,
  query: AssetQuery,
  textMatch: ((asset: Asset) => boolean) | null = null,
  extra: ((asset: Asset) => boolean) | null = null,
): Asset[] {
  const recent = query.collection.kind === 'recent' ? latestImportId(view.assets.values()) : null;
  const text = query.text.trim();
  const out: Asset[] = [];
  for (const asset of view.assets.values()) {
    if (asset.deleted) continue;
    if (isHiddenPairHalf(asset, view.assets)) continue;
    if (!inCollection(asset, query.collection, view, recent)) continue;
    if (text !== '' && !(textMatch ? textMatch(asset) : matchesText(asset, text))) continue;
    if (extra && !extra(asset)) continue;
    out.push(asset);
  }
  return out;
}

/**
 * When each photo was last edited: the newest `editedAt` among its live
 * versions (synced, so edits made on any device count), or null when none
 * was ever edited. Built once per view.
 */
export function lastEditedIn(view: LibraryView): (asset: Asset) => string | null {
  const latest = new Map<AssetId, string>();
  for (const version of view.versions.values()) {
    if (version.deleted || version.editedAt === undefined) continue;
    const seen = latest.get(version.assetId);
    if (seen === undefined || version.editedAt > seen) latest.set(version.assetId, version.editedAt);
  }
  return (asset) => latest.get(asset.id) ?? null;
}

export function queryAssets(view: LibraryView, query: AssetQuery): AssetId[] {
  const out = baseAssets(view, query);
  const editedAt = query.sort.key === 'edited' ? lastEditedIn(view) : undefined;
  out.sort((a, b) => compareAssets(a, b, query.sort, editedAt));
  return out.map((a) => a.id);
}

/** Whether the asset's shown version has edits. */
export function isEdited(asset: Asset, view: LibraryView): boolean {
  const version = view.versions.get(asset.primaryVersionId);
  return version !== undefined && !isDefaultRecipe(version.recipe);
}

/** Live versions per asset, in one pass. */
export function versionCounts(view: LibraryView): Map<AssetId, number> {
  const counts = new Map<AssetId, number>();
  for (const v of view.versions.values()) if (!v.deleted) counts.set(v.assetId, (counts.get(v.assetId) ?? 0) + 1);
  return counts;
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
    albums.set(album.id, albumItemCount(album, view));
  }
  const sortedKeywords = [...keywords.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  return { all, recent, setAside, albums, keywords: sortedKeywords };
}

export function sameCollection(a: Collection, b: Collection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'album' && b.kind === 'album') return a.albumId === b.albumId;
  if (a.kind === 'keyword' && b.kind === 'keyword') return a.keyword === b.keyword;
  if (a.kind === 'date' && b.kind === 'date') return a.prefix === b.prefix;
  if (a.kind === 'import' && b.kind === 'import') return a.importId === b.importId;
  if (a.kind === 'saved' && b.kind === 'saved') return a.searchId === b.searchId;
  return true;
}

/** How many tiles the album shows: its live photos and live single versions, each once. */
export function albumItemCount(album: Album, view: LibraryView): number {
  const items = new Set<string>();
  for (const m of album.members) {
    const asset = view.assets.get(m.assetId);
    if (!asset || asset.deleted) continue;
    if (m.versionId === null || m.versionId === asset.primaryVersionId) items.add(asset.id);
    else if (view.versions.get(m.versionId)?.deleted === false) items.add(`${asset.id}#${m.versionId}`);
  }
  return items.size;
}
