/**
 * Finding photos (spec 5.2): the facet filters of the filter bar, saved
 * searches, and the whole query the grid shows — collection, text,
 * facets, sort and burst grouping — computed once per change, never per
 * frame. Pure.
 */

import type { Album, Asset, AssetId, ImageFormat, LibraryView } from '@lopsy/photos-core/library/types';
import { compileSearch, type LabelChoice, type SavedSearch, type SearchRule } from '@lopsy/photos-core/search/rules';
import { computeFacets, type Facets } from '@lopsy/photos-core/search/facets';
import { groupBursts } from '@lopsy/photos-core/search/bursts';
import { versionItemId, versionsByAsset, type ItemId } from './items';
import { baseAssets, compareAssets, isHiddenPairHalf, lastEditedIn, type AssetQuery, type Collection } from './asset-query';

export interface FacetFilter {
  readonly cameras: readonly string[];
  readonly lenses: readonly string[];
  /** At least this many stars; null for any. */
  readonly minRating: number | null;
  readonly labels: readonly LabelChoice[];
  readonly formats: readonly ImageFormat[];
  /** true: edited only; false: unedited only; null: either. */
  readonly edited: boolean | null;
}

export const NO_FACETS: FacetFilter = { cameras: [], lenses: [], minRating: null, labels: [], formats: [], edited: null };

export function hasFacets(f: FacetFilter): boolean {
  return f.cameras.length + f.lenses.length + f.labels.length + f.formats.length > 0 || f.minRating !== null || f.edited !== null;
}

/** The facets as one search rule (all must hold); null when none is set. */
export function facetRule(f: FacetFilter): SearchRule | null {
  const rules: SearchRule[] = [];
  if (f.cameras.length > 0) rules.push({ kind: 'camera', in: f.cameras });
  if (f.lenses.length > 0) rules.push({ kind: 'lens', in: f.lenses });
  if (f.minRating !== null) rules.push({ kind: 'rating', op: 'gte', value: f.minRating });
  if (f.labels.length > 0) rules.push({ kind: 'label', in: f.labels });
  if (f.formats.length > 0) rules.push({ kind: 'format', in: f.formats });
  if (f.edited !== null) rules.push({ kind: 'edited', value: f.edited });
  if (rules.length === 0) return null;
  return rules.length === 1 ? (rules[0] ?? null) : { kind: 'group', match: 'all', rules };
}

/** Adds or removes one value of a list facet. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** The rule a "Save search" stores: what the sidebar collection and the facets select (the free text is not a rule). */
export function ruleForSaving(collection: Collection, facets: FacetFilter, savedRule: SearchRule | null): SearchRule | null {
  const rules: SearchRule[] = [];
  switch (collection.kind) {
    case 'all':
      rules.push({ kind: 'setAside', value: false });
      break;
    case 'set-aside':
      rules.push({ kind: 'setAside', value: true });
      break;
    case 'album':
      rules.push({ kind: 'inAlbum', albumId: collection.albumId });
      break;
    case 'keyword':
      rules.push({ kind: 'keyword', value: collection.keyword });
      break;
    case 'date': {
      const p = collection.prefix;
      const from = p.length === 4 ? `${p}-01-01` : p.length === 7 ? `${p}-01` : p;
      const to = p.length === 4 ? `${p}-12-31` : p.length === 7 ? `${p}-31` : p;
      rules.push({ kind: 'captureDate', from, to });
      break;
    }
    case 'saved':
      if (savedRule) rules.push(savedRule);
      break;
    case 'recent':
    case 'import':
      break;
  }
  const facet = facetRule(facets);
  if (facet) rules.push(facet);
  if (rules.length === 0) return null;
  return rules.length === 1 ? (rules[0] ?? null) : { kind: 'group', match: 'all', rules };
}

export function newSavedSearchId(): string {
  return `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface FindQuery extends AssetQuery {
  readonly facets: FacetFilter;
  readonly groupBursts: boolean;
  /** Burst covers whose burst is shown open. */
  readonly expanded: ReadonlySet<AssetId>;
  readonly savedSearches: readonly SavedSearch[];
  /** For the Last edited order: when the photo was last edited (sortable), or null. Default: `lastEditedIn(view)`. */
  readonly lastEdited?: (asset: Asset) => string | null;
}

export interface FindResult {
  /** What the grid shows, in order. */
  readonly ids: readonly AssetId[];
  /** Counts over what the collection and text leave, before the facets narrow it. */
  readonly facets: Facets;
  /** Burst covers to the size of their burst (bursts of two or more). */
  readonly bursts: ReadonlyMap<AssetId, number>;
  /** Photos to how many Lopsy documents made from them are stacked behind them. */
  readonly documents: ReadonlyMap<AssetId, number>;
}

/**
 * Stacks Lopsy documents behind the photo they were made from (spec 5.6),
 * when that photo is in the list: the documents leave the list and the
 * photo carries their count; an open stack shows them right after it.
 */
export function stackDocuments(
  ids: readonly AssetId[],
  view: LibraryView,
  expanded: ReadonlySet<AssetId>,
): { ids: AssetId[]; documents: Map<AssetId, number> } {
  const shown = new Set(ids);
  const bySource = new Map<AssetId, AssetId[]>();
  for (const id of ids) {
    const asset = view.assets.get(id);
    const source = asset?.kind === 'document' ? asset.source?.assetId : undefined;
    if (source === undefined || source === id || !shown.has(source)) continue;
    const list = bySource.get(source) ?? [];
    list.push(id);
    bySource.set(source, list);
  }
  if (bySource.size === 0) return { ids: [...ids], documents: new Map() };
  const stacked = new Set([...bySource.values()].flat());
  const out: AssetId[] = [];
  const documents = new Map<AssetId, number>();
  for (const id of ids) {
    if (stacked.has(id)) continue;
    out.push(id);
    const docs = bySource.get(id);
    if (!docs) continue;
    documents.set(id, docs.length);
    if (expanded.has(id)) out.push(...docs);
  }
  return { ids: out, documents };
}

export function findAssets(view: LibraryView, query: FindQuery, textMatch: ((asset: Asset) => boolean) | null): FindResult {
  let savedPredicate: ((asset: Asset) => boolean) | null = null;
  if (query.collection.kind === 'saved') {
    const id = query.collection.searchId;
    const saved = query.savedSearches.find((s) => s.id === id);
    const compiled = saved ? compileSearch(saved.rule) : null;
    savedPredicate = compiled ? (a) => compiled(a, view) : () => false;
  }
  const base = baseAssets(view, query, textMatch, savedPredicate);
  const facets = computeFacets(base, view);
  const rule = facetRule(query.facets);
  const predicate = rule ? compileSearch(rule) : null;
  const shown = predicate ? base.filter((a) => predicate(a, view)) : base;
  let editedAt: ((asset: Asset) => string | null) | undefined;
  if (query.sort.key === 'edited') {
    const lastEdited = query.lastEdited ?? lastEditedIn(view);
    const memo = new Map<AssetId, string | null>();
    editedAt = (asset) => {
      if (!memo.has(asset.id)) memo.set(asset.id, lastEdited(asset));
      return memo.get(asset.id) ?? null;
    };
  }
  shown.sort((a, b) => compareAssets(a, b, query.sort, editedAt));

  const bursts = new Map<AssetId, number>();
  const album = query.collection.kind === 'album' ? view.albums.get(query.collection.albumId) : undefined;
  const finish = (ids: readonly AssetId[]): ItemId[] => {
    const opened = openVersions(ids, view, query.expanded);
    return album ? albumItems(opened, album, view) : opened;
  };
  if (!query.groupBursts) {
    const stacked = stackDocuments(shown.map((a) => a.id), view, query.expanded);
    return { ids: finish(stacked.ids), facets, bursts, documents: stacked.documents };
  }
  const ids: AssetId[] = [];
  for (const burst of groupBursts(shown)) {
    const size = burst.assetIds.length;
    if (size > 1) bursts.set(burst.coverId, size);
    ids.push(burst.coverId);
    if (size > 1 && query.expanded.has(burst.coverId)) {
      for (const id of burst.assetIds) if (id !== burst.coverId) ids.push(id);
    }
  }
  const stacked = stackDocuments(ids, view, query.expanded);
  return { ids: finish(stacked.ids), facets, bursts, documents: stacked.documents };
}

/** "March 2026", "14 March 2026", "2026". */
export function datePrefixLabel(prefix: string): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, m, d] = prefix.split('-');
  const month = m ? months[Number(m) - 1] : undefined;
  if (d && month) return `${Number(d)} ${month} ${y}`;
  if (month) return `${month} ${y}`;
  return y ?? prefix;
}

export interface ImportBatch {
  readonly importId: string;
  /** ISO time of the batch's first photo. */
  readonly importedAt: string;
  readonly count: number;
}

/** One entry per import, newest first. */
export function importBatches(view: LibraryView): ImportBatch[] {
  const batches = new Map<string, { importedAt: string; count: number }>();
  for (const a of view.assets.values()) {
    if (a.deleted || isHiddenPairHalf(a, view.assets)) continue;
    const b = batches.get(a.importId);
    if (!b) batches.set(a.importId, { importedAt: a.importedAt, count: 1 });
    else {
      b.count++;
      if (a.importedAt < b.importedAt) b.importedAt = a.importedAt;
    }
  }
  return [...batches]
    .map(([importId, b]) => ({ importId, importedAt: b.importedAt, count: b.count }))
    .sort((x, y) => (x.importedAt < y.importedAt ? 1 : x.importedAt > y.importedAt ? -1 : 0));
}

/** An import batch's name in the sidebar: "14 Mar, 09:30"; the year only when it is not this year's. */
export function importLabel(iso: string, now: Date = new Date(), withSeconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const two = (n: number) => String(n).padStart(2, '0');
  const time = `${two(d.getHours())}:${two(d.getMinutes())}${withSeconds ? `:${two(d.getSeconds())}` : ''}`;
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${months[d.getMonth()]}${year}, ${time}`;
}

/** Every batch's label, with seconds for batches that would otherwise share one (two imports in a minute). */
export function importLabels(batches: readonly ImportBatch[], now: Date = new Date()): Map<string, string> {
  const short = batches.map((b) => importLabel(b.importedAt, now));
  const out = new Map<string, string>();
  batches.forEach((b, i) => {
    const label = short[i] ?? '';
    const clash = short.indexOf(label) !== i || short.lastIndexOf(label) !== i;
    out.set(b.importId, clash ? importLabel(b.importedAt, now, true) : label);
  });
  return out;
}

/** After each open photo, its other versions as their own tiles (`assetId#versionId`). */
export function openVersions(ids: readonly ItemId[], view: LibraryView, expanded: ReadonlySet<AssetId>): ItemId[] {
  if (expanded.size === 0) return [...ids];
  const byAsset = versionsByAsset(view);
  const out: ItemId[] = [];
  for (const id of ids) {
    out.push(id);
    if (!expanded.has(id)) continue;
    const asset = view.assets.get(id);
    for (const v of byAsset.get(id) ?? []) {
      if (asset && v.id !== asset.primaryVersionId) out.push(versionItemId(id, v.id));
    }
  }
  return out;
}

/**
 * An album's tiles (spec 7): a photo that is a whole member shows as
 * itself; a single version as its own tile (the photo's tile when it is
 * the shown version). Each tile once, in the order of `ids`.
 */
export function albumItems(ids: readonly ItemId[], album: Album, view: LibraryView): ItemId[] {
  const whole = new Set<AssetId>();
  const versions = new Map<AssetId, ItemId[]>();
  for (const m of album.members) {
    if (m.versionId === null) {
      whole.add(m.assetId);
      continue;
    }
    const asset = view.assets.get(m.assetId);
    if (!asset || view.versions.get(m.versionId)?.deleted !== false) continue;
    const item = m.versionId === asset.primaryVersionId ? asset.id : versionItemId(asset.id, m.versionId);
    const list = versions.get(m.assetId) ?? [];
    list.push(item);
    versions.set(m.assetId, list);
  }
  const out: ItemId[] = [];
  const seen = new Set<ItemId>();
  const push = (id: ItemId) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) {
    // Versions an open stack adds are not members; the album shows only what it holds.
    if (id.includes('#')) continue;
    if (whole.has(id)) push(id);
    for (const item of versions.get(id) ?? []) push(item);
  }
  return out;
}
