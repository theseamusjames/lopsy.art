/**
 * Typed views over the merge store. Every value is narrowed with a default,
 * because a field may come from another device or a newer app. An entity
 * shows only once its creating fields have arrived (an asset needs its
 * file, a version its asset, an album its name).
 */

import { RECIPE_PREFIX, type EntityRecord, type MergeStore, type ChangedEntity } from './merge-store';
import { recipeFromPaths } from './recipe';
import type {
  Album,
  Asset,
  CameraInfo,
  ColorLabel,
  ExposureInfo,
  GpsInfo,
  ImageFormat,
  Json,
  LibraryView,
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
  };
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
  return { id, name, assetIds: members(record, 'assets'), deleted: field(record, 'deleted') === true };
}

/** A setting's value; undefined when it has none. */
export function settingFromRecord(record: EntityRecord): Json | undefined {
  return field(record, 'value');
}

export const EMPTY_VIEW: LibraryView = {
  assets: new Map(),
  versions: new Map(),
  albums: new Map(),
  settings: new Map(),
};

/**
 * Keeps a `LibraryView` in step with a store. Unchanged entities keep their
 * object, unchanged collections keep their map, and the view object itself
 * is replaced only when something in it changed.
 */
export class ViewCache {
  private current: LibraryView = EMPTY_VIEW;
  private readonly store: MergeStore;

  constructor(store: MergeStore) {
    this.store = store;
    this.rebuildAll();
  }

  get view(): LibraryView {
    return this.current;
  }

  rebuildAll(): void {
    const all: ChangedEntity[] = [];
    for (const kind of ['asset', 'version', 'album', 'setting'] as const) {
      for (const id of this.store.ids(kind)) all.push({ kind, id });
    }
    this.current = EMPTY_VIEW;
    this.update(all);
  }

  /** Returns whether the view changed. */
  update(changed: readonly ChangedEntity[]): boolean {
    if (changed.length === 0) return false;
    let assets: Map<string, Asset> | null = null;
    let versions: Map<string, Version> | null = null;
    let albums: Map<string, Album> | null = null;
    let settings: Map<string, Json> | null = null;
    for (const { kind, id } of changed) {
      const record = this.store.get(kind, id);
      if (!record) continue;
      if (kind === 'asset') {
        assets ??= new Map(this.current.assets);
        setOrDelete(assets, id, assetFromRecord(id, record));
      } else if (kind === 'version') {
        versions ??= new Map(this.current.versions);
        setOrDelete(versions, id, versionFromRecord(id, record));
      } else if (kind === 'album') {
        albums ??= new Map(this.current.albums);
        setOrDelete(albums, id, albumFromRecord(id, record));
      } else {
        settings ??= new Map(this.current.settings);
        const value = settingFromRecord(record);
        if (value === undefined) settings.delete(id);
        else settings.set(id, value);
      }
    }
    this.current = {
      assets: assets ?? this.current.assets,
      versions: versions ?? this.current.versions,
      albums: albums ?? this.current.albums,
      settings: settings ?? this.current.settings,
    };
    return true;
  }
}

function setOrDelete<T>(map: Map<string, T>, id: string, value: T | null): void {
  if (value === null) map.delete(id);
  else map.set(id, value);
}
