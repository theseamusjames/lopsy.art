/**
 * Saved searches (spec 5.2): rules over the library's assets, stored as a
 * synced setting. Rules read from storage are untrusted and validated.
 */

import type { AlbumId, Asset, ColorLabel, ImageFormat, Json, LibrarySession, LibraryView } from '../library/types';
import { assetDay, cameraName, isEdited } from './asset-fields';

export type LabelChoice = ColorLabel | 'none';

export type SearchRule =
  | { readonly kind: 'rating'; readonly op: 'gte' | 'eq'; readonly value: number }
  | { readonly kind: 'label'; readonly in: readonly LabelChoice[] }
  | { readonly kind: 'setAside'; readonly value: boolean }
  /** Inclusive 'YYYY-MM-DD' bounds over the capture date (else the import date); null for open. */
  | { readonly kind: 'captureDate'; readonly from: string | null; readonly to: string | null }
  /** Camera names as `cameraName` gives them, compared without case. */
  | { readonly kind: 'camera'; readonly in: readonly string[] }
  | { readonly kind: 'lens'; readonly in: readonly string[] }
  | { readonly kind: 'focalLength'; readonly min: number | null; readonly max: number | null }
  | { readonly kind: 'iso'; readonly min: number | null; readonly max: number | null }
  | { readonly kind: 'format'; readonly in: readonly ImageFormat[] }
  | { readonly kind: 'keyword'; readonly value: string }
  /** The primary version's recipe changes something. */
  | { readonly kind: 'edited'; readonly value: boolean }
  | { readonly kind: 'hasLocation'; readonly value: boolean }
  | { readonly kind: 'inAlbum'; readonly albumId: AlbumId }
  | { readonly kind: 'group'; readonly match: 'all' | 'any'; readonly rules: readonly SearchRule[] };

export type SavedSearch = { readonly id: string; readonly name: string; readonly rule: SearchRule };

export type AssetPredicate = (asset: Asset, view: LibraryView) => boolean;

export const SAVED_SEARCHES_KEY = 'savedSearches';

const LABELS: readonly LabelChoice[] = ['red', 'yellow', 'green', 'blue', 'purple', 'none'];
const FORMATS: readonly ImageFormat[] = ['raf', 'dng', 'arw', 'jpeg', 'png', 'webp', 'lopsy'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DEPTH = 8;
const MAX_RULES = 200;
const MAX_LIST = 500;
const MAX_TEXT = 500;

function inRange(value: number | null | undefined, min: number | null, max: number | null): boolean {
  if (value === null || value === undefined) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

/** Album membership by album, rebuilt when the view's albums change. */
function albumMembers(): (view: LibraryView, albumId: AlbumId) => ReadonlySet<string> {
  let albums: LibraryView['albums'] | null = null;
  const sets = new Map<AlbumId, ReadonlySet<string>>();
  return (view, albumId) => {
    if (view.albums !== albums) {
      albums = view.albums;
      sets.clear();
    }
    let set = sets.get(albumId);
    if (!set) {
      const album = view.albums.get(albumId);
      set = new Set(album && !album.deleted ? album.members.map((m) => m.assetId) : []);
      sets.set(albumId, set);
    }
    return set;
  };
}

/** A predicate for the rule. Compile once per rule, then call per asset. */
export function compileSearch(rule: SearchRule): AssetPredicate {
  const members = albumMembers();
  const compile = (r: SearchRule): AssetPredicate => {
    switch (r.kind) {
      case 'rating':
        return r.op === 'eq' ? (a) => a.rating === r.value : (a) => a.rating >= r.value;
      case 'label': {
        const set = new Set<LabelChoice>(r.in);
        return (a) => set.has(a.label ?? 'none');
      }
      case 'setAside':
        return (a) => a.setAside === r.value;
      case 'captureDate':
        return (a) => {
          const day = assetDay(a);
          return (r.from === null || day >= r.from) && (r.to === null || day <= r.to);
        };
      case 'camera': {
        const set = new Set(r.in.map((s) => s.toLowerCase()));
        return (a) => set.has(cameraName(a).toLowerCase());
      }
      case 'lens': {
        const set = new Set(r.in.map((s) => s.toLowerCase()));
        return (a) => a.lens !== null && set.has(a.lens.toLowerCase());
      }
      case 'focalLength':
        return (a) => inRange(a.exposure?.focalLength, r.min, r.max);
      case 'iso':
        return (a) => inRange(a.exposure?.iso, r.min, r.max);
      case 'format': {
        const set = new Set(r.in);
        return (a) => set.has(a.format);
      }
      case 'keyword': {
        const wanted = r.value.toLowerCase();
        return (a) => a.keywords.some((k) => k.toLowerCase() === wanted);
      }
      case 'edited':
        return (a, view) => isEdited(a, view) === r.value;
      case 'hasLocation':
        return (a) => (a.gps !== null) === r.value;
      case 'inAlbum':
        return (a, view) => members(view, r.albumId).has(a.id);
      case 'group': {
        const parts = r.rules.map(compile);
        if (r.match === 'all') return (a, view) => parts.every((p) => p(a, view));
        return (a, view) => parts.some((p) => p(a, view));
      }
    }
  };
  return compile(rule);
}

/** The assets of the view that match, in the view's order. */
export function filterAssets(view: LibraryView, rule: SearchRule, includeDeleted = false): Asset[] {
  const predicate = compileSearch(rule);
  const out: Asset[] = [];
  for (const asset of view.assets.values()) {
    if ((includeDeleted || !asset.deleted) && predicate(asset, view)) out.push(asset);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST) return null;
  if (!value.every((v) => typeof v === 'string' && v.length <= MAX_TEXT)) return null;
  return value as string[];
}

function dayOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && DAY.test(value) ? value : undefined;
}

/** A rule from untrusted JSON; null when it is not a valid rule. */
export function parseSearchRule(value: unknown): SearchRule | null {
  let count = 0;
  const parse = (v: unknown, depth: number): SearchRule | null => {
    if (++count > MAX_RULES || depth > MAX_DEPTH || !isRecord(v)) return null;
    switch (v['kind']) {
      case 'rating': {
        const value = v['value'];
        const op = v['op'];
        if ((op !== 'gte' && op !== 'eq') || typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) return null;
        return { kind: 'rating', op, value };
      }
      case 'label': {
        const list = stringList(v['in']);
        if (!list || !list.every((l) => (LABELS as readonly string[]).includes(l))) return null;
        return { kind: 'label', in: list as LabelChoice[] };
      }
      case 'setAside':
      case 'edited':
      case 'hasLocation': {
        const value = v['value'];
        return typeof value === 'boolean' ? { kind: v['kind'], value } : null;
      }
      case 'captureDate': {
        const from = dayOrNull(v['from']);
        const to = dayOrNull(v['to']);
        return from === undefined || to === undefined ? null : { kind: 'captureDate', from, to };
      }
      case 'camera':
      case 'lens': {
        const list = stringList(v['in']);
        return list ? { kind: v['kind'], in: list } : null;
      }
      case 'focalLength':
      case 'iso': {
        const min = finiteOrNull(v['min']);
        const max = finiteOrNull(v['max']);
        return min === undefined || max === undefined ? null : { kind: v['kind'], min, max };
      }
      case 'format': {
        const list = stringList(v['in']);
        if (!list || !list.every((f) => (FORMATS as readonly string[]).includes(f))) return null;
        return { kind: 'format', in: list as ImageFormat[] };
      }
      case 'keyword': {
        const value = v['value'];
        return typeof value === 'string' && value !== '' && value.length <= MAX_TEXT ? { kind: 'keyword', value } : null;
      }
      case 'inAlbum': {
        const albumId = v['albumId'];
        return typeof albumId === 'string' && albumId !== '' && albumId.length <= MAX_TEXT ? { kind: 'inAlbum', albumId } : null;
      }
      case 'group': {
        const match = v['match'];
        const rules = v['rules'];
        if ((match !== 'all' && match !== 'any') || !Array.isArray(rules) || rules.length > MAX_RULES) return null;
        const parsed: SearchRule[] = [];
        for (const r of rules) {
          const rule = parse(r, depth + 1);
          if (!rule) return null;
          parsed.push(rule);
        }
        return { kind: 'group', match, rules: parsed };
      }
      default:
        return null;
    }
  };
  return parse(value, 0);
}

/** Saved searches from untrusted JSON; invalid entries are dropped. */
export function parseSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return [];
  const out: SavedSearch[] = [];
  const ids = new Set<string>();
  for (const entry of value.slice(0, MAX_LIST)) {
    if (!isRecord(entry)) continue;
    const { id, name } = entry;
    if (typeof id !== 'string' || id === '' || id.length > MAX_TEXT || ids.has(id)) continue;
    if (typeof name !== 'string' || name.length > MAX_TEXT) continue;
    const rule = parseSearchRule(entry['rule']);
    if (!rule) continue;
    ids.add(id);
    out.push({ id, name, rule });
  }
  return out;
}

export function readSavedSearches(view: LibraryView): SavedSearch[] {
  return parseSavedSearches(view.settings.get(SAVED_SEARCHES_KEY));
}

export function writeSavedSearches(session: Pick<LibrarySession, 'setSetting'>, list: readonly SavedSearch[]): void {
  // Rules are plain JSON by construction; the cast only drops the narrower static type.
  session.setSetting(SAVED_SEARCHES_KEY, list as unknown as Json);
}
