/**
 * Typed views over the merge store. Every value is narrowed with a default,
 * because a field may come from another device or a newer app. An entity
 * shows only once its creating fields have arrived (an asset needs its
 * file, a version its asset, an album its name).
 */

import { RECIPE_PREFIX, type EntityRecord, type MergeStore, type ChangedEntity } from './merge-store';
import { OverlayMap } from './overlay-map';
import { exportSettingsFromJson } from '../export/types';
import { BUILT_IN_PREFIX } from './presets';
import { isRecipeGroupId, recipeFromPaths, sanitizeRecipeValues } from './recipe';
import type {
  Album,
  AlbumMember,
  Asset,
  CameraInfo,
  ColorLabel,
  ExportPreset,
  ExposureInfo,
  GpsInfo,
  ImageFormat,
  Json,
  LibraryView,
  OriginalStatus,
  Preset,
  PreviewRef,
  Rating,
  Version,
} from './types';
import { isRecord } from './validate';

const FORMATS: ReadonlySet<string> = new Set<ImageFormat>(['raf', 'dng', 'jpeg', 'png', 'webp', 'lopsy']);
const LABELS: ReadonlySet<string> = new Set<ColorLabel>(['red', 'yellow', 'green', 'blue', 'purple']);

function field(record: EntityRecord, path: string): Json | undefined {
  return record.fields.get(path)?.value;
}

function str(value: Json | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function numOrNull(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function members(record: EntityRecord, set: string): string[] {
  const out: string[] = [];
  for (const [member, r] of record.sets.get(set) ?? []) if (r.present) out.push(member);
  return out.sort();
}

function camera(value: Json | undefined): CameraInfo | null {
  if (!isRecord(value) || typeof value.make !== 'string' || typeof value.model !== 'string') return null;
  return { make: value.make, model: value.model };
}

function exposure(value: Json | undefined): ExposureInfo | null {
  if (!isRecord(value)) return null;
  const v = value as Readonly<Record<string, Json>>;
  return {
    iso: numOrNull(v.iso),
    shutter: strOrNull(v.shutter),
    aperture: numOrNull(v.aperture),
    focalLength: numOrNull(v.focalLength),
  };
}

function gps(value: Json | undefined): GpsInfo | null {
  if (!isRecord(value)) return null;
  const v = value as Readonly<Record<string, Json>>;
  const lat = numOrNull(v.lat);
  const lon = numOrNull(v.lon);
  if (lat === null || lon === null) return null;
  return { lat, lon, alt: numOrNull(v.alt) };
}

function source(value: Json | undefined): Asset['source'] {
  if (!isRecord(value)) return null;
  const { assetId, versionId, recipeHash } = value;
  if (typeof assetId !== 'string' || typeof versionId !== 'string' || typeof recipeHash !== 'string') return null;
  return { assetId, versionId, recipeHash };
}

function preview(value: Json | undefined): PreviewRef | null {
  if (!isRecord(value)) return null;
  const { fileId, recipeHash, width, height } = value;
  if (typeof fileId !== 'string' || typeof recipeHash !== 'string') return null;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return { fileId, recipeHash, width, height };
}

function rating(value: Json | undefined): Rating {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : 0;
}

export function assetFromRecord(id: string, record: EntityRecord): Asset | null {
  const fileId = field(record, 'fileId');
  if (typeof fileId !== 'string') return null;
  const format = field(record, 'format');
  const label = field(record, 'label');
  const orientation = field(record, 'orientation');
  return {
    id,
    kind: field(record, 'kind') === 'document' ? 'document' : 'original',
    fileId,
    sha256: str(field(record, 'sha256'), ''),
    fileName: str(field(record, 'fileName'), ''),
    byteSize: numOrNull(field(record, 'byteSize')) ?? 0,
    format: typeof format === 'string' && FORMATS.has(format) ? (format as ImageFormat) : 'jpeg',
    mimeType: str(field(record, 'mimeType'), 'application/octet-stream'),
    capturedAt: strOrNull(field(record, 'capturedAt')),
    importedAt: str(field(record, 'importedAt'), ''),
    importId: str(field(record, 'importId'), ''),
    width: numOrNull(field(record, 'width')),
    height: numOrNull(field(record, 'height')),
    orientation:
      typeof orientation === 'number' && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8
        ? orientation
        : 1,
    camera: camera(field(record, 'camera')),
    lens: strOrNull(field(record, 'lens')),
    exposure: exposure(field(record, 'exposure')),
    gps: gps(field(record, 'gps')),
    pairedWith: strOrNull(field(record, 'pairedWith')),
    source: source(field(record, 'source')),
    renderFileId: strOrNull(field(record, 'renderFileId')),
    rating: rating(field(record, 'rating')),
    label: typeof label === 'string' && LABELS.has(label) ? (label as ColorLabel) : null,
    setAside: field(record, 'setAside') === true,
    title: str(field(record, 'title'), ''),
    caption: str(field(record, 'caption'), ''),
    keywords: members(record, 'keywords'),
    primaryVersionId: str(field(record, 'primaryVersionId'), ''),
    deleted: field(record, 'deleted') === true,
    originalStatus: originalStatus(field(record, 'originalStatus')),
  };
}

function originalStatus(value: Json | undefined): OriginalStatus {
  return value === 'missing' || value === 'trashed' || value === 'changed' ? value : 'ok';
}

export function recipePathsOf(record: EntityRecord): Record<string, Json> {
  const paths: Record<string, Json> = {};
  for (const [path, r] of record.fields) {
    if (path.startsWith(RECIPE_PREFIX)) paths[path.slice(RECIPE_PREFIX.length)] = r.value;
  }
  return paths;
}

export function versionFromRecord(id: string, record: EntityRecord): Version | null {
  const assetId = field(record, 'assetId');
  if (typeof assetId !== 'string') return null;
  return {
    id,
    assetId,
    name: str(field(record, 'name'), ''),
    recipe: recipeFromPaths(recipePathsOf(record)),
    createdAt: str(field(record, 'createdAt'), ''),
    thumb: preview(field(record, 'thumb')),
    screen: preview(field(record, 'screen')),
    deleted: field(record, 'deleted') === true,
  };
}

export function albumFromRecord(id: string, record: EntityRecord): Album | null {
  const name = field(record, 'name');
  if (typeof name !== 'string') return null;
  const assetIds = members(record, 'assets');
  const versionMembers: AlbumMember[] = [];
  for (const member of members(record, 'versions')) {
    const [assetId, versionId, extra] = member.split('/');
    if (assetId && versionId && extra === undefined) versionMembers.push({ assetId, versionId });
  }
  return {
    id,
    name,
    assetIds,
    members: [...assetIds.map((assetId) => ({ assetId, versionId: null })), ...versionMembers],
    deleted: field(record, 'deleted') === true,
  };
}

/** A setting's value; undefined when it has none. */
export function settingFromRecord(record: EntityRecord): Json | undefined {
  return field(record, 'value');
}

interface MapsView {
  readonly assets: OverlayMap<string, Asset>;
  readonly versions: OverlayMap<string, Version>;
  readonly albums: OverlayMap<string, Album>;
  readonly settings: OverlayMap<string, Json>;
  readonly presets: OverlayMap<string, Preset>;
  readonly exportPresets: OverlayMap<string, ExportPreset>;
}

function emptyView(): MapsView {
  return {
    assets: OverlayMap.empty(),
    versions: OverlayMap.empty(),
    albums: OverlayMap.empty(),
    settings: OverlayMap.empty(),
    presets: OverlayMap.empty(),
    exportPresets: OverlayMap.empty(),
  };
}

export function presetFromRecord(id: string, record: EntityRecord): Preset | null {
  // Built-in IDs belong to the presets in code: a stored record claiming one is ignored.
  if (id.startsWith(BUILT_IN_PREFIX)) return null;
  const name = field(record, 'name');
  if (typeof name !== 'string') return null;
  const groups = field(record, 'groups');
  const values = field(record, 'values');
  return {
    id,
    name,
    groups: Array.isArray(groups) ? groups.filter(isRecipeGroupId) : [],
    // Stored values are re-read through the recipe's own validation, as any recipe field is.
    values: isRecord(values) ? sanitizeRecipeValues(values) : {},
    createdAt: str(field(record, 'createdAt'), ''),
    deleted: field(record, 'deleted') === true,
  };
}

export function exportPresetFromRecord(id: string, record: EntityRecord): ExportPreset | null {
  if (id.startsWith(BUILT_IN_PREFIX)) return null;
  const name = field(record, 'name');
  if (typeof name !== 'string') return null;
  return {
    id,
    name,
    settings: exportSettingsFromJson(field(record, 'settings')),
    createdAt: str(field(record, 'createdAt'), ''),
    deleted: field(record, 'deleted') === true,
  };
}

class Changes<V> {
  readonly set = new Map<string, V>();
  readonly remove: string[] = [];
  put(id: string, value: V | null): void {
    if (value === null) this.remove.push(id);
    else this.set.set(id, value);
  }
}

/**
 * Keeps a `LibraryView` in step with a store. Unchanged entities keep their
 * object, unchanged collections keep their map, and the view object itself
 * is replaced only when something in it changed. Collections are overlay
 * maps, so one change does not copy the whole library (spec 11).
 */
export class ViewCache {
  private current: MapsView = emptyView();
  private readonly deferred = new Map<string, ChangedEntity>();
  private readonly store: MergeStore;

  constructor(store: MergeStore) {
    this.store = store;
    this.rebuildAll();
  }

  get view(): LibraryView {
    if (this.deferred.size > 0) {
      const changed = [...this.deferred.values()];
      this.deferred.clear();
      this.update(changed);
    }
    return this.current;
  }

  /**
   * Records changes to apply when the view is next read, so a burst of
   * commands nobody reads in between (an import) rebuilds each entity once.
   */
  defer(changed: readonly ChangedEntity[]): boolean {
    for (const c of changed) this.deferred.set(`${c.kind}/${c.id}`, c);
    return changed.length > 0;
  }

  rebuildAll(): void {
    const all: ChangedEntity[] = [];
    for (const kind of ['asset', 'version', 'album', 'setting', 'preset', 'exportPreset'] as const) {
      for (const id of this.store.ids(kind)) all.push({ kind, id });
    }
    this.current = emptyView();
    this.update(all);
  }

  /** Returns whether the view changed. */
  update(changed: readonly ChangedEntity[]): boolean {
    if (changed.length === 0) return false;
    const assets = new Changes<Asset>();
    const versions = new Changes<Version>();
    const albums = new Changes<Album>();
    const presets = new Changes<Preset>();
    const exportPresets = new Changes<ExportPreset>();
    const settings = new Map<string, Json>();
    const removedSettings: string[] = [];
    for (const { kind, id } of changed) {
      const record = this.store.get(kind, id);
      if (!record) continue;
      if (kind === 'asset') assets.put(id, assetFromRecord(id, record));
      else if (kind === 'version') versions.put(id, versionFromRecord(id, record));
      else if (kind === 'album') albums.put(id, albumFromRecord(id, record));
      else if (kind === 'preset') presets.put(id, presetFromRecord(id, record));
      else if (kind === 'exportPreset') exportPresets.put(id, exportPresetFromRecord(id, record));
      else {
        const value = settingFromRecord(record);
        if (value === undefined) removedSettings.push(id);
        else settings.set(id, value);
      }
    }
    this.current = {
      assets: this.current.assets.with(assets.set, assets.remove),
      versions: this.current.versions.with(versions.set, versions.remove),
      albums: this.current.albums.with(albums.set, albums.remove),
      settings: this.current.settings.with(settings, removedSettings),
      presets: this.current.presets.with(presets.set, presets.remove),
      exportPresets: this.current.exportPresets.with(exportPresets.set, exportPresets.remove),
    };
    return true;
  }
}
