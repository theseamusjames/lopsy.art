/**
 * The library's data model and the API the UI uses. The design is in
 * docs/lopsy-photos-spec.md, 6.6 and 7.
 *
 * Storage model: every entity (asset, version, album, setting) is a bag of
 * last-writer-wins fields plus last-writer-wins set memberships. Every
 * change is an `Op`, stamped with a hybrid logical clock and appended to
 * this device's journal. Merging is order-independent: the same ops in any
 * order give the same state. The typed views below (`Asset`, `Version`,
 * `Album`) are read from those fields.
 */

import type { FileId, StorageAdapter } from '../storage/types';
import type { ExportSettings } from '../export/types';
import type { Recipe, RecipeGroupId } from './recipe';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type AssetId = string;
export type VersionId = string;
export type AlbumId = string;

export type EntityKind = 'asset' | 'version' | 'album' | 'setting' | 'preset' | 'exportPreset';

export type PresetId = string;
export type ExportPresetId = string;

/** An edit preset (spec 5.4): the values of some recipe groups, applied with `applyRecipeValues`. */
export interface Preset {
  readonly id: PresetId;
  readonly name: string;
  readonly groups: readonly RecipeGroupId[];
  /** Recipe values by dotted path, as `pickGroups` gives them. */
  readonly values: Readonly<Record<string, Json>>;
  readonly createdAt: string;
  readonly deleted: boolean;
  /** One of `BUILT_IN_PRESETS`, which live in code and are never stored. */
  readonly builtIn?: boolean;
}

/** Saved export settings (spec 5.5). */
export interface ExportPreset {
  readonly id: ExportPresetId;
  readonly name: string;
  readonly settings: ExportSettings;
  readonly createdAt: string;
  readonly deleted: boolean;
  readonly builtIn?: boolean;
}

/** One change. Fields are dotted paths into the entity (`recipe.tone.exposure`). */
export type Op =
  | {
      /** Sets fields, each last-writer-wins by the envelope's HLC. */
      readonly t: 'set';
      readonly kind: EntityKind;
      readonly id: string;
      readonly fields: Readonly<Record<string, Json>>;
    }
  | {
      /** Adds or removes one member of a set field, last-writer-wins per member. */
      readonly t: 'member';
      readonly kind: EntityKind;
      readonly id: string;
      readonly set: string;
      readonly member: string;
      readonly present: boolean;
    };

export interface OpStep {
  readonly id: string;
  readonly label: string;
  /** Set on an undo: the ID of the step it reverts. */
  readonly undoes?: string;
  /** Set on a redo: the ID of the step it re-applies. */
  readonly redoes?: string;
}

export interface OpEnvelope {
  /** `${device}:${seq}`, unique across the library. */
  readonly id: string;
  readonly device: string;
  /** Counts up from 1 per device, with no gaps. */
  readonly seq: number;
  /** Hybrid logical clock stamp; compares as a string (hlc.ts). */
  readonly hlc: string;
  /** Schema version of the op. */
  readonly v: number;
  /** Groups ops into one history step (one slider release, one paste). */
  readonly step?: OpStep;
  readonly op: Op;
}

export type Rating = 0 | 1 | 2 | 3 | 4 | 5;
export type ColorLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type ImageFormat = 'raf' | 'dng' | 'jpeg' | 'png' | 'webp' | 'lopsy';

export interface CameraInfo {
  readonly make: string;
  readonly model: string;
}

export interface ExposureInfo {
  readonly iso: number | null;
  /** As written for people: '1/250', '2.5'. */
  readonly shutter: string | null;
  readonly aperture: number | null;
  /** Millimetres. */
  readonly focalLength: number | null;
}

export interface GpsInfo {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number | null;
}

export interface PreviewRef {
  readonly fileId: FileId;
  /** The recipe the preview was rendered from (recipe.ts `recipeHash`). */
  readonly recipeHash: string;
  readonly width: number;
  readonly height: number;
}

/** Facts about the file, fixed at import. */
export interface AssetFacts {
  readonly kind: 'original' | 'document';
  /** The original's file in storage. */
  readonly fileId: FileId;
  readonly sha256: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly format: ImageFormat;
  readonly mimeType: string;
  /** Capture time as the camera wrote it, e.g. '2026-11-14T16:02:11' (+ offset when known). */
  readonly capturedAt: string | null;
  /** ISO 8601. */
  readonly importedAt: string;
  readonly importId: string;
  /** Oriented size, when known. */
  readonly width: number | null;
  readonly height: number | null;
  /** EXIF orientation, 1 to 8. */
  readonly orientation: number;
  readonly camera: CameraInfo | null;
  readonly lens: string | null;
  readonly exposure: ExposureInfo | null;
  readonly gps: GpsInfo | null;
  /** The other half of a RAW+JPEG pair. */
  readonly pairedWith: AssetId | null;
  /** Documents only: the photo and edit it was made from. */
  readonly source: { readonly assetId: AssetId; readonly versionId: VersionId; readonly recipeHash: string } | null;
  /** Documents only: the flattened render of the `.lopsy`. */
  readonly renderFileId: FileId | null;
}

/** What the user sets on a photo. */
export interface AssetMarks {
  readonly rating: Rating;
  readonly label: ColorLabel | null;
  readonly setAside: boolean;
  readonly title: string;
  readonly caption: string;
}

export interface Asset extends AssetFacts, AssetMarks {
  readonly id: AssetId;
  readonly keywords: readonly string[];
  /** The version the grid shows. Created with the asset. */
  readonly primaryVersionId: VersionId;
  readonly deleted: boolean;
  /**
   * What the last repair found in storage for the original: absent or
   * 'ok' when it is there and matches. Set by `repairLibrary` (repair.ts).
   */
  readonly originalStatus?: OriginalStatus;
}

/** 'missing': deleted from storage; 'trashed': in the storage's trash; 'changed': its checksum differs. */
export type OriginalStatus = 'ok' | 'missing' | 'trashed' | 'changed';

export interface Version {
  readonly id: VersionId;
  readonly assetId: AssetId;
  readonly name: string;
  readonly recipe: Recipe;
  readonly createdAt: string;
  /** 512 px, for the grid. */
  readonly thumb: PreviewRef | null;
  /** 2048 px, for Single view and Compare. */
  readonly screen: PreviewRef | null;
  readonly deleted: boolean;
}

export interface Album {
  readonly id: AlbumId;
  readonly name: string;
  readonly assetIds: readonly AssetId[];
  readonly deleted: boolean;
}

/** The merged state, as the UI reads it. A new object only when something changed. */
export interface LibraryView {
  readonly assets: ReadonlyMap<AssetId, Asset>;
  readonly versions: ReadonlyMap<VersionId, Version>;
  readonly albums: ReadonlyMap<AlbumId, Album>;
  /** Synced settings, by key. */
  readonly settings: ReadonlyMap<string, Json>;
  /** The user's edit presets, deleted ones included (filter on `deleted`); built-ins are in presets.ts. */
  readonly presets: ReadonlyMap<PresetId, Preset>;
  readonly exportPresets: ReadonlyMap<ExportPresetId, ExportPreset>;
}

/** Folder IDs of a library (spec 6.5, Layout). */
export interface LibraryLayout {
  readonly libraryId: string;
  /** `Lopsy Photos/` */
  readonly rootId: FileId;
  readonly originalsId: FileId;
  readonly documentsId: FileId;
  readonly exportsId: FileId;
  /** `Library data/` */
  readonly dataId: FileId;
  /** `Library data/journal/` (one subfolder per device under it). */
  readonly journalId: FileId;
  readonly snapshotsId: FileId;
  readonly previewsId: FileId;
  readonly devicesId: FileId;
}

export interface SyncStatus {
  /**
   * idle: up to date; syncing: talking to storage; offline: storage
   * unreachable, retrying; paused: needs the user (sign in again);
   * error: a failure that needs attention (see `error`).
   */
  readonly state: 'idle' | 'syncing' | 'offline' | 'paused' | 'error';
  /** Local ops not yet written to storage. */
  readonly pendingOps: number;
  readonly lastSyncedAt: string | null;
  readonly error: string | null;
}

export interface HistoryStep {
  readonly id: string;
  readonly label: string;
  readonly hlc: string;
  /** False once undone (and not redone). */
  readonly active: boolean;
  /** Made on this device. Undo and redo act only on this device's steps. */
  readonly own?: boolean;
  /**
   * This device's active step with at least one field nobody has changed
   * since; undoing it restores only those fields.
   */
  readonly undoable?: boolean;
  /** The step `undo()` would undo now. */
  readonly nextUndo?: boolean;
  /** The step `redo()` would redo now. */
  readonly nextRedo?: boolean;
}

/** A new asset: its facts plus optional starting marks. */
export interface NewAsset extends AssetFacts {
  readonly id?: AssetId;
  readonly marks?: Partial<AssetMarks>;
  readonly keywords?: readonly string[];
  /** The primary version's starting recipe (a preset applied at import). */
  readonly recipe?: Recipe;
}

export interface LibrarySession {
  readonly libraryId: string;
  readonly deviceId: string;
  readonly layout: LibraryLayout;
  readonly adapter: StorageAdapter;

  /** Current merged state. Stable identity until something changes (fits useSyncExternalStore). */
  getView(): LibraryView;
  /** Called after any change, local or merged from another device. */
  subscribe(listener: () => void): () => void;

  /** Each command applies locally at once and is queued for sync. */
  addAsset(asset: NewAsset): { readonly assetId: AssetId; readonly versionId: VersionId };
  setMarks(assetIds: readonly AssetId[], marks: Partial<AssetMarks>): void;
  setKeyword(assetIds: readonly AssetId[], keyword: string, present: boolean): void;
  /** Tombstones the assets. Trashing their files is the caller's job. */
  deleteAssets(assetIds: readonly AssetId[]): void;
  restoreAssets(assetIds: readonly AssetId[]): void;

  createVersion(assetId: AssetId, name: string, recipe?: Recipe): VersionId;
  renameVersion(versionId: VersionId, name: string): void;
  deleteVersion(versionId: VersionId): void;
  /** Sets recipe values by dotted path ('tone.exposure') as one history step. */
  editRecipe(versionId: VersionId, changes: Readonly<Record<string, Json>>, label: string): void;
  /** Replaces the whole recipe (paste, reset, preset) as one history step. */
  setRecipe(versionId: VersionId, recipe: Recipe, label: string): void;
  setPreview(versionId: VersionId, size: 'thumb' | 'screen', preview: PreviewRef): void;

  /** Undo or redo the version's latest recipe step. False when there is none. */
  undo(versionId: VersionId): boolean;
  redo(versionId: VersionId): boolean;
  history(versionId: VersionId): readonly HistoryStep[];

  createAlbum(name: string): AlbumId;
  renameAlbum(albumId: AlbumId, name: string): void;
  deleteAlbum(albumId: AlbumId): void;
  setAlbumMember(albumId: AlbumId, assetId: AssetId, present: boolean): void;

  setSetting(key: string, value: Json): void;

  /**
   * Sets recipe values on each version as its own history step labelled
   * `label` (Paste edits, a preset, Sync). Paths outside the recipe are
   * dropped and values clamped as `recipeFromPaths` reads them.
   */
  applyRecipeValues(versionIds: readonly VersionId[], values: Readonly<Record<string, Json>>, label: string): void;

  /** Saves the recipe's values for `groups` as a preset. */
  savePreset(name: string, recipe: Recipe, groups: readonly RecipeGroupId[]): PresetId;
  renamePreset(presetId: PresetId, name: string): void;
  deletePreset(presetId: PresetId): void;

  saveExportPreset(name: string, settings: ExportSettings): ExportPresetId;
  renameExportPreset(presetId: ExportPresetId, name: string): void;
  deleteExportPreset(presetId: ExportPresetId): void;

  /**
   * Resolves once every command made so far is saved on this device, so it
   * survives the tab closing; rejects if that save failed. Await it before
   * an action that cannot be taken back, such as trashing files or
   * deleting a staged import.
   */
  whenDurable(): Promise<void>;
  /** Writes queued ops and reads other devices' now. */
  syncNow(): Promise<void>;
  getSyncStatus(): SyncStatus;
  subscribeSync(listener: () => void): () => void;
  /** Flushes what it can, stops timers. */
  close(): Promise<void>;
}
