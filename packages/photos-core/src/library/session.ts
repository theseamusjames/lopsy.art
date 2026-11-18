/**
 * `openLibrary`: the `LibrarySession` the UI uses (types.ts). Commands turn
 * into ops that apply to the local merge store at once, go into the outbox
 * and are written to storage by the sync engine.
 */

import type { FileId, StorageAdapter } from '../storage/types';
import { HybridClock } from './hlc';
import { newId } from './ids';
import { ensureLibrary, LIBRARY_SCHEMA_VERSION } from './layout';
import {
  LibraryBusyError,
  libraryLockName,
  LibraryLockLostError,
  LOCK_LOST_MESSAGE,
  NoopLibraryLock,
  WebLocksLibraryLock,
  type LibraryLock,
  type LibraryLockHandle,
} from './lock';
import { isStorageError } from '../storage/errors';
import { EMPTY_BOOKKEEPING, type LocalStore, type SyncBookkeeping } from './local-store';
import { MergeStore, type RecipeWrite } from './merge-store';
import { exportSettingsFromJson, exportSettingsProblem, type ExportSettings } from '../export/types';
import { BUILT_IN_PREFIX } from './presets';
import {
  isRecipeGroupId,
  pickGroups,
  sanitizeRecipeValues,
  type RecipeGroupId,
  DEFAULT_RECIPE,
  removedAreaValues,
  recipeHash,
  recipeToPaths,
  type CropRect,
  type CurvePoint,
  type Recipe,
  type RecipeLeaf,
} from './recipe';
import { loadNewestSnapshot } from './snapshot';
import { SyncEngine, type SyncTimers } from './sync';
import type {
  AlbumId,
  AssetId,
  AssetFacts,
  AssetMarks,
  HistoryStep,
  Json,
  LibraryLayout,
  LibrarySession,
  LibraryView,
  NewAsset,
  Op,
  OpEnvelope,
  OpStep,
  LibraryHistory,
  EntityKind,
  OriginalStatus,
  PresetId,
  ExportPresetId,
  PreviewRef,
  SyncStatus,
  VersionId,
} from './types';
import { OP_SCHEMA_VERSION, validateEnvelope } from './validate';
import { ViewCache } from './view';

export interface OpenLibraryOptions {
  readonly adapter: StorageAdapter;
  readonly store: LocalStore;
  readonly deviceName?: string;
  readonly appVersion?: string;
  readonly now?: () => number;
  /** Timers for flush, pull and retry. False: only `syncNow()` and `close()` talk to storage. */
  readonly autoSync?: boolean;
  /** Write a snapshot after this many ops applied since the last one (spec: 5,000). */
  readonly snapshotEvery?: number;
  readonly timers?: SyncTimers;
  /** List every journal folder after this many pulls through the storage change feed (default 60). */
  readonly fullPullEvery?: number;
  /** One writer per device (lock.ts). Default: Web Locks in browsers, none elsewhere. */
  readonly lock?: LibraryLock;
  /** Take the library over from another tab instead of failing with `LibraryBusyError`. */
  readonly takeOver?: boolean;
  /** Roll up this device's journal segments after this many small ones (default 20). */
  readonly rollUpAt?: number;
}

export const DEFAULT_SNAPSHOT_EVERY = 5000;

/** Thrown by commands on a library whose schema is newer than this app. */
export class LibraryReadOnlyError extends Error {
  constructor() {
    super('This library was updated by a newer version of Lopsy Photos. Reload to update before making changes.');
    this.name = 'LibraryReadOnlyError';
  }
}

function leafJson(value: RecipeLeaf): Json {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return (value as readonly CurvePoint[]).map((p) => ({ x: p.x, y: p.y }));
  const crop = value as CropRect;
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

/** The recipe as `recipe.*` field values. */
export function recipeFields(recipe: Recipe): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, value] of Object.entries(recipeToPaths(recipe))) {
    out[`recipe.${path}`] = leafJson(value);
  }
  return out;
}

function nonDefaultRecipeFields(recipe: Recipe): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, value] of Object.entries(recipeFields(recipe))) {
    if (JSON.stringify(value) !== DEFAULT_FIELD_TEXT.get(path)) out[path] = value;
  }
  return out;
}

const DEFAULT_FIELD_TEXT: ReadonlyMap<string, string> = new Map(
  Object.entries(recipeFields(DEFAULT_RECIPE)).map(([path, value]) => [path, JSON.stringify(value)]),
);

const DEFAULT_PATHS: Readonly<Record<string, Json>> = Object.fromEntries(
  Object.entries(recipeFields(DEFAULT_RECIPE)).map(([k, v]) => [k.slice('recipe.'.length), v]),
);

function assetFields(asset: NewAsset, versionId: VersionId): Record<string, Json> {
  const marks = asset.marks ?? {};
  return {
    kind: asset.kind,
    fileId: asset.fileId,
    sha256: asset.sha256,
    fileName: asset.fileName,
    byteSize: asset.byteSize,
    format: asset.format,
    mimeType: asset.mimeType,
    capturedAt: asset.capturedAt,
    importedAt: asset.importedAt,
    importId: asset.importId,
    width: asset.width,
    height: asset.height,
    orientation: asset.orientation,
    camera: asset.camera ? { make: asset.camera.make, model: asset.camera.model } : null,
    lens: asset.lens,
    exposure: asset.exposure
      ? {
          iso: asset.exposure.iso ?? null,
          shutter: asset.exposure.shutter ?? null,
          aperture: asset.exposure.aperture ?? null,
          focalLength: asset.exposure.focalLength ?? null,
        }
      : null,
    gps: asset.gps ? { lat: asset.gps.lat, lon: asset.gps.lon, alt: asset.gps.alt ?? null } : null,
    pairedWith: asset.pairedWith,
    source: asset.source
      ? { assetId: asset.source.assetId, versionId: asset.source.versionId, recipeHash: asset.source.recipeHash }
      : null,
    renderFileId: asset.renderFileId,
    rating: marks.rating ?? 0,
    label: marks.label ?? null,
    setAside: marks.setAside ?? false,
    title: marks.title ?? '',
    caption: marks.caption ?? '',
    primaryVersionId: versionId,
    deleted: false,
  };
}

function marksFields(marks: Partial<AssetMarks>): Record<string, Json> {
  const out: Record<string, Json> = {};
  if (marks.rating !== undefined) out.rating = marks.rating;
  if (marks.label !== undefined) out.label = marks.label;
  if (marks.setAside !== undefined) out.setAside = marks.setAside;
  if (marks.title !== undefined) out.title = marks.title;
  if (marks.caption !== undefined) out.caption = marks.caption;
  return out;
}

interface StepInfo {
  readonly id: string;
  readonly label: string;
  readonly hlc: string;
  /** The device that made the step. */
  readonly device: string;
  /** The step's first write, for ordering. */
  readonly first: RecipeWrite;
  readonly fields: Record<string, Json>;
  /** The ops that wrote the step. */
  readonly opIds: Set<string>;
  /** The step's latest write. */
  lastWrite: { hlc: string; opId: string };
  active: boolean;
  /** The latest undo or redo of this step. */
  lastEvent: { readonly hlc: string; readonly opId: string; readonly undo: boolean } | null;
  lastUndoHlc: string | null;
}

function deviceOf(opId: string): string {
  return opId.slice(0, opId.indexOf(':'));
}

function before(a: RecipeWrite, b: RecipeWrite): boolean {
  return a.hlc < b.hlc || (a.hlc === b.hlc && a.opId < b.opId);
}

function analyseHistory(writes: readonly RecipeWrite[]): StepInfo[] {
  const steps = new Map<string, StepInfo>();
  const events: { target: string; undo: boolean; hlc: string; opId: string }[] = [];
  for (const w of writes) {
    const step = w.step;
    if (!step) continue;
    if (step.undoes !== undefined) {
      events.push({ target: step.undoes, undo: true, hlc: w.hlc, opId: w.opId });
    } else if (step.redoes !== undefined) {
      events.push({ target: step.redoes, undo: false, hlc: w.hlc, opId: w.opId });
    } else {
      const existing = steps.get(step.id);
      if (existing) {
        Object.assign(existing.fields, w.fields);
        existing.opIds.add(w.opId);
        existing.lastWrite = { hlc: w.hlc, opId: w.opId };
      } else {
        steps.set(step.id, {
          id: step.id,
          label: step.label,
          hlc: w.hlc,
          device: deviceOf(w.opId),
          first: w,
          fields: { ...w.fields },
          opIds: new Set([w.opId]),
          lastWrite: { hlc: w.hlc, opId: w.opId },
          active: true,
          lastEvent: null,
          lastUndoHlc: null,
        });
      }
    }
  }
  for (const e of events) {
    const s = steps.get(e.target);
    if (!s) continue;
    const last = s.lastEvent;
    if (last && (last.hlc > e.hlc || (last.hlc === e.hlc && last.opId > e.opId))) continue;
    s.lastEvent = { hlc: e.hlc, opId: e.opId, undo: e.undo };
    s.active = !e.undo;
    if (e.undo) s.lastUndoHlc = e.hlc;
  }
  return [...steps.values()].sort((a, b) => (before(a.first, b.first) ? -1 : 1));
}

/** What `openLibrary` returns: the `LibrarySession` contract plus maintenance commands. */
export interface PhotosLibrarySession extends LibrarySession {
  /** Records what a repair found for the assets' originals (shown as a badge). */
  setOriginalStatus(assetIds: readonly AssetId[], status: OriginalStatus): void;
  /**
   * Updates a document's file facts after it was saved again in place
   * (spec 6.12). Documents only: an original's facts never change, and the
   * originals cache keys on its sha256. Throws for anything else.
   */
  setAssetFacts(assetId: AssetId, facts: DocumentFacts): void;
}

/** The file facts a re-saved document can change. */
export type DocumentFacts = Partial<Pick<AssetFacts, 'sha256' | 'byteSize' | 'width' | 'height' | 'renderFileId'>>;

export class NotADocumentError extends Error {
  constructor(assetId: AssetId) {
    super(`Asset ${assetId} is not a document; an original's facts never change.`);
    this.name = 'NotADocumentError';
  }
}

/** A field or a set member that library history tracks. */
type LibTarget =
  | { readonly t: 'field'; readonly kind: EntityKind; readonly id: string; readonly path: string }
  | { readonly t: 'member'; readonly kind: EntityKind; readonly id: string; readonly set: string; readonly member: string };

/** One field or set member a library step changed, with its values before and after. */
type LibEntry =
  | (Extract<LibTarget, { t: 'field' }> & { readonly before: Json; readonly after: Json })
  | (Extract<LibTarget, { t: 'member' }> & { readonly before: boolean; readonly after: boolean });

interface LibStep {
  readonly label: string;
  readonly entries: LibEntry[];
}

/** Library undo keeps this many steps. */
const MAX_LIBRARY_STEPS = 100;

function marksLabel(marks: Partial<AssetMarks>): string {
  const keys = Object.keys(marks).filter((k) => marks[k as keyof AssetMarks] !== undefined);
  if (keys.length !== 1) return 'Edit info';
  switch (keys[0]) {
    case 'rating':
      return 'Rating';
    case 'label':
      return 'Label';
    case 'setAside':
      return marks.setAside ? 'Set aside' : 'Bring back';
    case 'title':
      return 'Title';
    default:
      return 'Caption';
  }
}

function isShownVersionEntry(e: LibEntry): e is Extract<LibEntry, { t: 'field' }> {
  return e.t === 'field' && e.kind === 'asset' && e.path === 'primaryVersionId';
}

/** The ops that write `write` ('before' to undo, 'after' to redo) for each entry, one set op per entity. */
function libraryOps(entries: readonly LibEntry[], write: 'before' | 'after'): Op[] {
  const ops: Op[] = [];
  const sets = new Map<string, Extract<Op, { t: 'set' }>>();
  for (const e of entries) {
    if (e.t === 'member') {
      ops.push({ t: 'member', kind: e.kind, id: e.id, set: e.set, member: e.member, present: e[write] });
      continue;
    }
    const key = `${e.kind}\u0000${e.id}`;
    let op = sets.get(key);
    if (!op) {
      op = { t: 'set', kind: e.kind, id: e.id, fields: {} };
      sets.set(key, op);
      ops.push(op);
    }
    (op.fields as Record<string, Json>)[e.path] = e[write];
  }
  return ops;
}

class Session implements PhotosLibrarySession {
  private readonly libUndo: LibStep[] = [];
  private readonly libRedo: LibStep[] = [];
  /** Envelope IDs library history wrote: a field last written by any other op has been changed since. */
  private readonly libOps = new Set<string>();
  private libGroup: LibStep | null = null;
  private libQuiet = 0;
  private libHistoryView: { undo: LibStep | undefined; redo: LibStep | undefined; value: LibraryHistory } | null = null;
  readonly libraryId: string;
  readonly deviceId: string;
  readonly adapter: StorageAdapter;
  private currentLayout: LibraryLayout;
  private readonly lockHandle: LibraryLockHandle;
  private lockLost = false;
  private readonlyFlag: boolean;
  private readonly merge: MergeStore;
  private readonly clock: HybridClock;
  private readonly cache: ViewCache;
  private readonly engine: SyncEngine;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private nextSeq: number;

  constructor(init: {
    layout: LibraryLayout;
    adapter: StorageAdapter;
    deviceId: string;
    nextSeq: number;
    merge: MergeStore;
    clock: HybridClock;
    now: () => number;
    readOnly: boolean;
    lock: LibraryLockHandle;
    makeEngine: (onApplied: (changed: Parameters<ViewCache['update']>[0]) => void) => SyncEngine;
  }) {
    this.readonlyFlag = init.readOnly;
    this.currentLayout = init.layout;
    this.lockHandle = init.lock;
    this.libraryId = init.layout.libraryId;
    this.adapter = init.adapter;
    this.deviceId = init.deviceId;
    this.nextSeq = init.nextSeq;
    this.merge = init.merge;
    this.clock = init.clock;
    this.now = init.now;
    this.cache = new ViewCache(this.merge);
    this.engine = init.makeEngine((changed) => {
      if (this.merge.maxHlc) this.clock.receive(this.merge.maxHlc);
      if (this.cache.defer(changed)) this.notify();
    });
    this.lockHandle.onLost(() => {
      this.lockLost = true;
      this.engine.lose(LOCK_LOST_MESSAGE);
      this.notify();
    });
  }

  get layout(): LibraryLayout {
    return this.currentLayout;
  }

  /** True when the library was made by a newer app (sync status says so too). */
  get readOnly(): boolean {
    return this.readonlyFlag;
  }

  /** True once another tab took the library over; commands then throw. */
  get lostToAnotherTab(): boolean {
    return this.lockLost;
  }

  updateLayout(layout: LibraryLayout): void {
    this.currentLayout = layout;
  }

  markReadOnly(): void {
    this.readonlyFlag = true;
    this.engine.markReadOnly();
  }

  get syncEngine(): SyncEngine {
    return this.engine;
  }

  getView(): LibraryView {
    return this.cache.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addAsset(asset: NewAsset): { readonly assetId: AssetId; readonly versionId: VersionId } {
    const assetId = asset.id ?? newId(this.now());
    // Read from the store, not the view, so an import does not rebuild the view after every photo.
    const existing = asset.id === undefined ? undefined : this.merge.get('asset', assetId);
    const primary = existing?.fields.get('primaryVersionId')?.value;
    if (existing?.fields.has('fileId') && typeof primary === 'string') return { assetId, versionId: primary };
    const versionId = newId(this.now());
    const ops: Op[] = [
      { t: 'set', kind: 'asset', id: assetId, fields: assetFields(asset, versionId) },
      ...normalizedKeywords(asset.keywords ?? []).map(
        (member): Op => ({ t: 'member', kind: 'asset', id: assetId, set: 'keywords', member, present: true }),
      ),
      { t: 'set', kind: 'version', id: versionId, fields: this.versionFields(assetId, 'Original', asset.recipe) },
    ];
    this.emit(ops);
    return { assetId, versionId };
  }

  setMarks(assetIds: readonly AssetId[], marks: Partial<AssetMarks>): void {
    const fields = marksFields(marks);
    if (Object.keys(fields).length === 0) return;
    this.recordLibrary(
      marksLabel(marks),
      assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields })),
    );
  }

  setKeyword(assetIds: readonly AssetId[], keyword: string, present: boolean): void {
    const [member] = normalizedKeywords([keyword]);
    if (member === undefined) return;
    this.recordLibrary(
      present ? 'Add keyword' : 'Remove keyword',
      assetIds.map((id): Op => ({ t: 'member', kind: 'asset', id, set: 'keywords', member, present })),
    );
  }

  deleteAssets(assetIds: readonly AssetId[]): void {
    this.recordLibrary(
      'Delete',
      assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields: { deleted: true } })),
    );
  }

  restoreAssets(assetIds: readonly AssetId[]): void {
    this.recordLibrary(
      'Restore',
      assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields: { deleted: false } })),
    );
  }

  createVersion(assetId: AssetId, name: string, recipe?: Recipe): VersionId {
    const versionId = newId(this.now());
    // Undo of a new version deletes it; redo brings it back.
    this.recordLibrary(
      'New version',
      [{ t: 'set', kind: 'version', id: versionId, fields: this.versionFields(assetId, name, recipe) }],
      [{ t: 'field', kind: 'version', id: versionId, path: 'deleted', before: true, after: false }],
    );
    return versionId;
  }

  renameVersion(versionId: VersionId, name: string): void {
    this.recordLibrary('Rename version', [{ t: 'set', kind: 'version', id: versionId, fields: { name } }]);
  }

  deleteVersion(versionId: VersionId): void {
    this.recordLibrary('Delete version', [{ t: 'set', kind: 'version', id: versionId, fields: { deleted: true } }]);
  }

  undoLibrary(): string | null {
    return this.moveLibraryStep(this.libUndo, this.libRedo, 'after', 'before');
  }

  redoLibrary(): string | null {
    return this.moveLibraryStep(this.libRedo, this.libUndo, 'before', 'after');
  }

  libraryHistory(): LibraryHistory {
    const undo = this.libUndo[this.libUndo.length - 1];
    const redo = this.libRedo[this.libRedo.length - 1];
    const cached = this.libHistoryView;
    if (cached && cached.undo === undo && cached.redo === redo) return cached.value;
    const value: LibraryHistory = { canUndo: !!undo, canRedo: !!redo, undoLabel: undo?.label ?? null, redoLabel: redo?.label ?? null };
    this.libHistoryView = { undo, redo, value };
    return value;
  }

  libraryStep<T>(label: string, fn: () => T): T {
    if (this.libGroup) return fn();
    const group: LibStep = { label, entries: [] };
    this.libGroup = group;
    try {
      return fn();
    } finally {
      this.libGroup = null;
      if (group.entries.length > 0) this.pushLibraryStep(group);
    }
  }

  withoutLibraryHistory<T>(fn: () => T): T {
    this.libQuiet += 1;
    try {
      return fn();
    } finally {
      this.libQuiet -= 1;
    }
  }

  /** The value an entry's field or member holds now, and whether this session's library history wrote it last. */
  private libCurrent(entry: LibTarget): { value: Json; ours: boolean } {
    const record = this.merge.get(entry.kind, entry.id);
    if (entry.t === 'member') {
      const reg = record?.sets.get(entry.set)?.get(entry.member);
      return reg ? { value: reg.present, ours: this.libOps.has(reg.opId) } : { value: false, ours: true };
    }
    const reg = record?.fields.get(entry.path);
    return reg ? { value: reg.value, ours: this.libOps.has(reg.opId) } : { value: null, ours: true };
  }

  /**
   * Emits `ops` as a library step: what each field and member held before
   * is kept so the step can be undone. `entries` replaces the computed ones.
   */
  private recordLibrary(label: string, ops: readonly Op[], entries?: readonly LibEntry[]): void {
    if (this.libQuiet > 0) {
      this.emit(ops);
      return;
    }
    const computed: LibEntry[] = [];
    if (!entries) {
      for (const op of ops) {
        if (op.t === 'member') {
          const target = { t: 'member', kind: op.kind, id: op.id, set: op.set, member: op.member } as const;
          const before = this.libCurrent(target).value === true;
          if (before !== op.present) computed.push({ ...target, before, after: op.present });
          continue;
        }
        for (const [path, after] of Object.entries(op.fields)) {
          if (after === undefined) continue;
          const target = { t: 'field', kind: op.kind, id: op.id, path } as const;
          const before = this.libCurrent(target).value;
          if (!sameJson(before, after)) computed.push({ ...target, before, after });
        }
      }
    }
    for (const env of this.emit(ops)) this.libOps.add(env.id);
    const step: LibStep = { label, entries: entries ? [...entries] : computed };
    if (step.entries.length === 0) return;
    if (this.libGroup) {
      this.libGroup.entries.push(...step.entries);
      return;
    }
    this.pushLibraryStep(step);
  }

  private pushLibraryStep(step: LibStep): void {
    this.libUndo.push(step);
    if (this.libUndo.length > MAX_LIBRARY_STEPS) this.libUndo.shift();
    this.libRedo.length = 0;
    this.notify();
  }

  /** Undo or redo: writes `to` for every entry still holding `expect`, written by this history. */
  private moveLibraryStep(from: LibStep[], to: LibStep[], expect: 'before' | 'after', write: 'before' | 'after'): string | null {
    for (;;) {
      const step = from.pop();
      if (!step) {
        this.notify();
        return null;
      }
      const held = step.entries.filter((e) => {
        const now = this.libCurrent(e);
        return now.ours && sameJson(now.value, e[expect]);
      });
      // The shown version is written last and only when it is still a live version of that photo
      // (another device may have deleted it since); the rest of the step may be what brings it back.
      const shown = held.filter(isShownVersionEntry);
      const rest = held.filter((e) => !isShownVersionEntry(e));
      this.emitLibraryOps(libraryOps(rest, write));
      const live = shown.filter((e) => this.isLiveVersionOf(e.id, e[write]));
      this.emitLibraryOps(libraryOps(live, write));
      const done = [...rest, ...live];
      // Everything in it was changed since: dropped, and the step before is tried.
      if (done.length === 0) continue;
      to.push({ label: step.label, entries: done });
      this.notify();
      return step.label;
    }
  }

  private emitLibraryOps(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    for (const env of this.emit(ops)) this.libOps.add(env.id);
  }

  /** Whether `versionId` is a version of `assetId` that is not deleted, in the merged state. */
  private isLiveVersionOf(assetId: AssetId, versionId: Json): boolean {
    if (typeof versionId !== 'string') return false;
    const fields = this.merge.get('version', versionId)?.fields;
    return fields?.get('assetId')?.value === assetId && fields.get('deleted')?.value !== true;
  }

  setPrimaryVersion(assetId: AssetId, versionId: VersionId): void {
    const version = this.getView().versions.get(versionId);
    if (!version || version.deleted || version.assetId !== assetId) {
      throw new Error(`${versionId} is not a live version of ${assetId}`);
    }
    this.recordLibrary('Show version', [{ t: 'set', kind: 'asset', id: assetId, fields: { primaryVersionId: versionId } }]);
  }

  editRecipe(versionId: VersionId, changes: Readonly<Record<string, Json>>, label: string): void {
    const fields: Record<string, Json> = {};
    for (const [path, value] of Object.entries(changes)) fields[`recipe.${path}`] = value;
    if (Object.keys(fields).length === 0) return;
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], { id: newId(this.now()), label });
  }

  setRecipe(versionId: VersionId, recipe: Recipe, label: string): void {
    const current = this.getView().versions.get(versionId)?.recipe;
    const fields = recipeFields(recipe);
    // An area left out of the new recipe is deleted, not left as it was.
    if (current) for (const [path, value] of Object.entries(removedAreaValues(current, recipe))) fields[`recipe.${path}`] = value;
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], {
      id: newId(this.now()),
      label,
    });
  }

  setPreview(versionId: VersionId, size: 'thumb' | 'screen', preview: PreviewRef): void {
    const value: Json = {
      fileId: preview.fileId,
      recipeHash: preview.recipeHash,
      width: preview.width,
      height: preview.height,
    };
    // A render of an older edit, finishing after a newer one (here or on another device), is not kept.
    const version = this.getView().versions.get(versionId);
    if (version && recipeHash(version.recipe) !== preview.recipeHash) return;
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields: { [size]: value } }], undefined, true);
  }

  /**
   * Undoes this device's latest step that can still be undone. Only fields
   * the step (or its last redo) still holds are written back: a field
   * someone changed since, on any device, keeps that newer value.
   */
  undo(versionId: VersionId): boolean {
    const writes = this.merge.recipeWrites(versionId);
    const steps = analyseHistory(writes);
    const target = [...steps].reverse().find((s) => this.undoable(versionId, s, steps));
    if (!target) return false;
    const fields: Record<string, Json> = {};
    for (const path of this.heldFields(versionId, target, steps)) {
      fields[`recipe.${path}`] = this.valueBefore(versionId, writes, target.first, path);
    }
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], {
      id: newId(this.now()),
      label: `Undo ${target.label}`,
      undoes: target.id,
    });
    return true;
  }

  /** Redoes this device's most recently undone step, for the fields its undo still holds. */
  redo(versionId: VersionId): boolean {
    const steps = analyseHistory(this.merge.recipeWrites(versionId));
    const target = this.redoTarget(versionId, steps);
    if (!target) return false;
    const fields: Record<string, Json> = {};
    for (const path of this.heldFields(versionId, target, steps)) fields[`recipe.${path}`] = target.fields[path] as Json;
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], {
      id: newId(this.now()),
      label: `Redo ${target.label}`,
      redoes: target.id,
    });
    return true;
  }

  history(versionId: VersionId): readonly HistoryStep[] {
    const steps = analyseHistory(this.merge.recipeWrites(versionId));
    const undoTarget = [...steps].reverse().find((s) => this.undoable(versionId, s, steps));
    const redoTarget = this.redoTarget(versionId, steps);
    return steps.map((s) => ({
      id: s.id,
      label: s.label,
      hlc: s.hlc,
      active: s.active,
      own: s.device === this.deviceId,
      undoable: this.undoable(versionId, s, steps),
      nextUndo: s === undoTarget,
      nextRedo: s === redoTarget,
    }));
  }

  /**
   * The step's fields nobody has changed since the step's latest write (the
   * step itself, or its last undo or redo): no other device, and no newer
   * edit here, has written them after it. This device's undos and redos,
   * and its steps undone since, do not count, so undoing several steps in
   * a row still works.
   */
  private heldFields(versionId: VersionId, step: StepInfo, steps: readonly StepInfo[]): string[] {
    const writes = this.merge.recipeWrites(versionId);
    const undoneHere = new Set(steps.filter((s) => s.device === this.deviceId && !s.active).map((s) => s.id));
    const ref = step.lastEvent ?? step.lastWrite;
    const touched = new Set<string>();
    // What the field held right after `ref`: the step's value, or the value its undo restored.
    const held = (path: string): Json =>
      step.lastEvent?.undo === true
        ? this.valueBefore(versionId, writes, step.first, path)
        : ((step.fields[path] ?? null) as Json);
    for (const w of writes) {
      if (w.hlc < ref.hlc || (w.hlc === ref.hlc && w.opId <= ref.opId)) continue;
      const ownUndoRedo =
        deviceOf(w.opId) === this.deviceId && w.step !== null && (w.step.undoes !== undefined || w.step.redoes !== undefined);
      // This device's own steps that it has undone since do not count either: their change is gone.
      if (ownUndoRedo || (w.step !== null && undoneHere.has(w.step.id))) continue;
      for (const [path, value] of Object.entries(w.fields)) {
        // A write of the value the field already held (a command that changed nothing) does not count.
        if (!sameJson(value, held(path))) touched.add(path);
      }
    }
    return Object.keys(step.fields).filter((path) => !touched.has(path));
  }

  private undoable(versionId: VersionId, step: StepInfo, steps: readonly StepInfo[]): boolean {
    return step.device === this.deviceId && step.active && this.heldFields(versionId, step, steps).length > 0;
  }

  private redoTarget(versionId: VersionId, steps: readonly StepInfo[]): StepInfo | null {
    let target: StepInfo | null = null;
    for (const s of steps) {
      if (s.device !== this.deviceId || s.active || !s.lastEvent || deviceOf(s.lastEvent.opId) !== this.deviceId) continue;
      if (!target || (s.lastUndoHlc ?? '') > (target.lastUndoHlc ?? '')) target = s;
    }
    if (!target || target.lastUndoHlc === null) return null;
    const undoneAt = target.lastUndoHlc;
    // A new edit on this device after the undo ends the redo chain, as in any editor.
    if (steps.some((s) => s.device === this.deviceId && s.hlc > undoneAt)) return null;
    return this.heldFields(versionId, target, steps).length > 0 ? target : null;
  }

  createAlbum(name: string): AlbumId {
    const albumId = newId(this.now());
    this.emit([{ t: 'set', kind: 'album', id: albumId, fields: { name, deleted: false } }]);
    return albumId;
  }

  renameAlbum(albumId: AlbumId, name: string): void {
    this.emit([{ t: 'set', kind: 'album', id: albumId, fields: { name } }]);
  }

  deleteAlbum(albumId: AlbumId): void {
    this.emit([{ t: 'set', kind: 'album', id: albumId, fields: { deleted: true } }]);
  }

  setAlbumMember(albumId: AlbumId, assetId: AssetId, present: boolean, versionId: VersionId | null = null): void {
    const label = present ? 'Add to album' : 'Remove from album';
    if (versionId === null) {
      this.recordLibrary(label, [{ t: 'member', kind: 'album', id: albumId, set: 'assets', member: assetId, present }]);
      return;
    }
    if (assetId.includes('/') || versionId.includes('/')) throw new Error('Invalid album member');
    this.recordLibrary(label, [
      { t: 'member', kind: 'album', id: albumId, set: 'versions', member: `${assetId}/${versionId}`, present },
    ]);
  }

  setOriginalStatus(assetIds: readonly AssetId[], status: OriginalStatus): void {
    this.emit(
      assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields: { originalStatus: status } })),
      undefined,
      true,
    );
  }

  setAssetFacts(assetId: AssetId, facts: DocumentFacts): void {
    const kind = this.merge.get('asset', assetId)?.fields.get('kind')?.value;
    if (kind !== 'document') throw new NotADocumentError(assetId);
    const fields: Record<string, Json> = {};
    if (facts.sha256 !== undefined) fields.sha256 = facts.sha256;
    if (facts.byteSize !== undefined) fields.byteSize = facts.byteSize;
    if (facts.width !== undefined) fields.width = facts.width;
    if (facts.height !== undefined) fields.height = facts.height;
    if (facts.renderFileId !== undefined) fields.renderFileId = facts.renderFileId;
    if (Object.keys(fields).length === 0) return;
    this.emit([{ t: 'set', kind: 'asset', id: assetId, fields }]);
  }

  applyRecipeValues(versionIds: readonly VersionId[], values: Readonly<Record<string, Json>>, label: string): void {
    const clean = sanitizeRecipeValues(values);
    const fields: Record<string, Json> = {};
    for (const [path, value] of Object.entries(clean)) fields[`recipe.${path}`] = value;
    if (Object.keys(fields).length === 0) return;
    // History is per version, so each version gets its own step and undoes on its own.
    for (const id of new Set(versionIds)) {
      this.emit([{ t: 'set', kind: 'version', id, fields }], { id: newId(this.now()), label });
    }
  }

  savePreset(name: string, recipe: Recipe, groups: readonly RecipeGroupId[]): PresetId {
    const id = newId(this.now());
    const kept = [...new Set(groups)].filter(isRecipeGroupId);
    this.emit([
      {
        t: 'set',
        kind: 'preset',
        id,
        fields: {
          name,
          groups: kept,
          values: pickGroups(recipe, kept),
          createdAt: new Date(this.now()).toISOString(),
          deleted: false,
        },
      },
    ]);
    return id;
  }

  renamePreset(presetId: PresetId, name: string): void {
    if (presetId.startsWith(BUILT_IN_PREFIX)) return;
    this.emit([{ t: 'set', kind: 'preset', id: presetId, fields: { name } }]);
  }

  deletePreset(presetId: PresetId): void {
    if (presetId.startsWith(BUILT_IN_PREFIX)) return;
    this.emit([{ t: 'set', kind: 'preset', id: presetId, fields: { deleted: true } }]);
  }

  saveExportPreset(name: string, settings: ExportSettings): ExportPresetId {
    const problem = exportSettingsProblem(settings);
    if (problem !== null) throw new Error(problem);
    const id = newId(this.now());
    const stored = JSON.parse(JSON.stringify(exportSettingsFromJson(settings))) as Json;
    this.emit([
      {
        t: 'set',
        kind: 'exportPreset',
        id,
        fields: { name, settings: stored, createdAt: new Date(this.now()).toISOString(), deleted: false },
      },
    ]);
    return id;
  }

  renameExportPreset(presetId: ExportPresetId, name: string): void {
    if (presetId.startsWith(BUILT_IN_PREFIX)) return;
    this.emit([{ t: 'set', kind: 'exportPreset', id: presetId, fields: { name } }]);
  }

  deleteExportPreset(presetId: ExportPresetId): void {
    if (presetId.startsWith(BUILT_IN_PREFIX)) return;
    this.emit([{ t: 'set', kind: 'exportPreset', id: presetId, fields: { deleted: true } }]);
  }

  setSetting(key: string, value: Json): void {
    this.emit([{ t: 'set', kind: 'setting', id: key, fields: { value } }]);
  }

  whenDurable(): Promise<void> {
    return this.engine.whenDurable();
  }

  syncNow(): Promise<void> {
    return this.engine.syncNow();
  }

  getSyncStatus(): SyncStatus {
    return this.engine.getStatus();
  }

  subscribeSync(listener: () => void): () => void {
    return this.engine.subscribe(listener);
  }

  async close(): Promise<void> {
    try {
      await this.engine.close();
    } finally {
      this.lockHandle.release();
    }
  }

  private versionFields(assetId: AssetId, name: string, recipe: Recipe | undefined): Record<string, Json> {
    return {
      assetId,
      name,
      createdAt: new Date(this.now()).toISOString(),
      thumb: null,
      screen: null,
      deleted: false,
      // Leaves at their default are left out: a missing leaf reads as the default, and a new version's
      // 70-odd recipe fields would otherwise dominate the size of a large library's state.
      ...nonDefaultRecipeFields(recipe ?? DEFAULT_RECIPE),
    };
  }

  private valueBefore(versionId: VersionId, writes: readonly RecipeWrite[], step: RecipeWrite, path: string): Json {
    for (let i = writes.length - 1; i >= 0; i--) {
      const w = writes[i] as RecipeWrite;
      if (before(w, step) && Object.prototype.hasOwnProperty.call(w.fields, path)) return w.fields[path] as Json;
    }
    return this.merge.foldedRecipeValue(versionId, path) ?? DEFAULT_PATHS[path] ?? null;
  }

  /**
   * Applies and queues ops. `internal` writes (previews, repair marks) drop
   * values that are already there. A user's command is always written in
   * full, so it beats any older change from another device that has not
   * arrived yet; a recipe step that changes nothing here is written
   * without a history step, so it does not show in history.
   */
  private emit(given: readonly Op[], step?: OpStep, internal = false): readonly OpEnvelope[] {
    if (this.lockLost) throw new LibraryLockLostError();
    if (this.readonlyFlag) throw new LibraryReadOnlyError();
    // An undo or redo is always recorded, even when it changes nothing, so the history moves on.
    const undoRedo = step !== undefined && (step.undoes !== undefined || step.redoes !== undefined);
    const ops: Op[] = [];
    let changesSomething = false;
    for (const op of given) {
      const cleaned = op.t === 'set' ? withoutUndefined(op) : op;
      const effective = this.withoutNoOps(cleaned);
      if (effective) changesSomething = true;
      if (internal) {
        if (effective) ops.push(effective);
      } else {
        ops.push(cleaned);
      }
    }
    if (ops.length === 0) return [];
    if (step && !undoRedo && !changesSomething) step = undefined;
    const envelopes: OpEnvelope[] = [];
    for (const op of ops) {
      const seq = this.nextSeq;
      const env: OpEnvelope = {
        id: `${this.deviceId}:${seq}`,
        device: this.deviceId,
        seq,
        hlc: this.clock.now(),
        v: OP_SCHEMA_VERSION,
        ...(step ? { step } : {}),
        op,
      };
      // Every device validates what it reads, so anything that would be rejected there is refused here.
      const checked = validateEnvelope(env);
      if (typeof checked === 'string') throw new Error(`Invalid change: ${checked}`);
      envelopes.push(env);
      this.nextSeq += 1;
    }
    const changed = this.merge.applyOps(envelopes);
    this.engine.enqueue(envelopes, this.nextSeq);
    if (this.cache.defer(changed)) this.notify();
    return envelopes;
  }

  /** The op without what would not change the local state; null when nothing is left. */
  private withoutNoOps(op: Op): Op | null {
    const record = this.merge.get(op.kind, op.id);
    if (!record) return op;
    if (op.t === 'member') {
      const current = record.sets.get(op.set)?.get(op.member);
      // A member never added counts as absent.
      return (current?.present ?? false) === op.present ? null : op;
    }
    let fields: Record<string, Json> | null = null;
    for (const [path, value] of Object.entries(op.fields)) {
      const current = record.fields.get(path);
      // A recipe leaf never written holds its default.
      const unchanged =
        current !== undefined
          ? sameJson(current.value, value)
          : op.kind === 'version' && DEFAULT_FIELD_TEXT.get(path) === JSON.stringify(value);
      if (unchanged) {
        fields ??= { ...op.fields };
        delete fields[path];
      }
    }
    if (!fields) return op;
    return Object.keys(fields).length === 0 ? null : { ...op, fields };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Callers may leave optional values undefined; JSON would drop them, so they are dropped here too. */
function withoutUndefined(op: Extract<Op, { t: 'set' }>): Op {
  if (!Object.values(op.fields).some((v) => v === undefined)) return op;
  const fields: Record<string, Json> = {};
  for (const [k, v] of Object.entries(op.fields)) if (v !== undefined) fields[k] = v;
  return { ...op, fields };
}

function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizedKeywords(keywords: readonly string[]): string[] {
  return [...new Set(keywords.map((k) => k.trim()).filter((k) => k !== ''))];
}

function loadingKey(libraryId: string): string {
  return `loading-snapshot:${libraryId}`;
}

function badKey(libraryId: string): string {
  return `bad-snapshots:${libraryId}`;
}

/**
 * The snapshots that must not be loaded again: one whose loading marker
 * is still set crashed this device (too large, or hostile) last time.
 */
async function badSnapshots(store: LocalStore, libraryId: string): Promise<Set<string>> {
  const bad = new Set<string>();
  try {
    const parsed: unknown = JSON.parse((await store.getMarker(badKey(libraryId))) ?? '[]');
    if (Array.isArray(parsed)) for (const n of parsed) if (typeof n === 'string') bad.add(n);
  } catch {
    // A damaged list only loses the memory of old crashes.
  }
  const crashed = await store.getMarker(loadingKey(libraryId));
  if (crashed !== null) {
    bad.add(crashed);
    await store.setMarker(badKey(libraryId), JSON.stringify([...bad].slice(-20)));
    await store.setMarker(loadingKey(libraryId), null);
  }
  return bad;
}

async function bootstrap(
  adapter: StorageAdapter,
  layout: LibraryLayout,
  store: LocalStore,
): Promise<{ merge: MergeStore; bookkeeping: SyncBookkeeping }> {
  const skip = await badSnapshots(store, layout.libraryId);
  const newest = await loadNewestSnapshot(adapter, layout.snapshotsId, layout.libraryId, {
    skip,
    // Set before decoding and cleared once the session is built: if decoding kills the tab, the next open skips it.
    before: (name) => store.setMarker(loadingKey(layout.libraryId), name),
  });
  for (const problem of newest.errors) console.warn('Skipped snapshot', problem);
  if (!newest.snapshot || !newest.file) return { merge: new MergeStore(), bookkeeping: EMPTY_BOOKKEEPING };
  return {
    merge: newest.snapshot.store,
    bookkeeping: { ...EMPTY_BOOKKEEPING, vector: newest.snapshot.vector, snapshot: newest.file.name },
  };
}

function defaultLock(): LibraryLock {
  const nav: unknown = typeof navigator === 'undefined' ? undefined : navigator;
  const hasLocks = typeof nav === 'object' && nav !== null && 'locks' in nav && nav.locks !== undefined;
  return hasLocks ? new WebLocksLibraryLock() : new NoopLibraryLock();
}

function canOpenOffline(error: unknown): boolean {
  return isStorageError(error) && (error.code === 'network' || error.code === 'rate-limited' || error.code === 'auth');
}

/**
 * Opens (creating if needed) the library in `adapter`'s storage. When storage
 * is unreachable but this device has opened the library before, it opens
 * from the device and finds the library in storage in the background.
 */
export async function openLibrary(options: OpenLibraryOptions): Promise<PhotosLibrarySession> {
  const now = options.now ?? Date.now;
  const { adapter, store } = options;
  let layout: LibraryLayout;
  let readOnly = false;
  let offlineError: unknown;
  let otherJournals: readonly FileId[] = [];
  const last = await store.lastLayout();
  const ensureOptions = { now, ...(last ? { preferLibraryId: last.libraryId, preferRootId: last.rootId } : {}) };
  try {
    const ensured = await ensureLibrary(adapter, ensureOptions);
    layout = ensured.layout;
    otherJournals = ensured.otherJournals.map((j) => j.journalId);
    readOnly = ensured.manifest.schemaVersion > LIBRARY_SCHEMA_VERSION;
  } catch (error) {
    const savedLayout = canOpenOffline(error) ? await store.lastLayout() : null;
    if (!savedLayout) throw error;
    layout = savedLayout;
    offlineError = error;
  }
  const online = offlineError === undefined;

  const lock = options.lock ?? defaultLock();
  const handle = await lock.acquire(libraryLockName(layout.libraryId), { steal: options.takeOver === true });
  if (!handle) throw new LibraryBusyError();

  try {
    const saved = await store.load(layout.libraryId);
    let deviceId: string;
    let nextSeq: number;
    let merge: MergeStore | null = null;
    let bookkeeping: SyncBookkeeping;
    let outbox: readonly OpEnvelope[] = [];
    const fromStorage = async () =>
      online ? bootstrap(adapter, layout, store) : { merge: new MergeStore(), bookkeeping: EMPTY_BOOKKEEPING };
    if (saved) {
      deviceId = saved.deviceId;
      outbox = saved.outbox;
      bookkeeping = saved.sync ?? EMPTY_BOOKKEEPING;
      const maxOutbox = outbox.reduce((m, op) => Math.max(m, op.seq), 0);
      nextSeq = Math.max(saved.nextSeq, maxOutbox + 1, bookkeeping.flushedSeq + 1);
      if (saved.state) {
        try {
          merge = MergeStore.deserialize(saved.state);
        } catch (error) {
          console.warn('Saved library state is unreadable; reloading from storage', error);
        }
      }
      if (!merge) {
        const fresh = await fromStorage();
        merge = fresh.merge;
        bookkeeping = { ...fresh.bookkeeping, flushedSeq: bookkeeping.flushedSeq };
      }
      merge.applyOps(outbox);
      if (online) await store.write(layout.libraryId, { layout });
    } else {
      deviceId = newId(now());
      nextSeq = 1;
      const fresh = await fromStorage();
      merge = fresh.merge;
      bookkeeping = fresh.bookkeeping;
      await store.write(layout.libraryId, { deviceId, nextSeq, state: merge.serialize(), sync: bookkeeping, layout });
    }

    const clock = new HybridClock(deviceId, now);
    if (merge.maxHlc) clock.receive(merge.maxHlc);
    const mergeStore = merge;
    const libraryId = layout.libraryId;
    const ensure = async (): Promise<LibraryLayout> => {
      const ensured = await ensureLibrary(adapter, { now, preferLibraryId: libraryId, preferRootId: layout.rootId });
      if (ensured.layout.libraryId !== libraryId) {
        throw new Error('The library in storage is not the one this device opened before.');
      }
      if (ensured.manifest.schemaVersion > LIBRARY_SCHEMA_VERSION) session.markReadOnly();
      await store.write(libraryId, { layout: ensured.layout });
      session.updateLayout(ensured.layout);
      session.syncEngine.setOtherJournals(ensured.otherJournals.map((j) => j.journalId));
      return ensured.layout;
    };
    const session: Session = new Session({
      layout,
      adapter,
      deviceId,
      nextSeq,
      merge: mergeStore,
      clock,
      now,
      readOnly,
      lock: handle,
      makeEngine: (onApplied) =>
        new SyncEngine({
          adapter,
          layout,
          deviceId,
          deviceName: options.deviceName ?? 'This device',
          appVersion: options.appVersion ?? '0.0.0',
          store: mergeStore,
          local: store,
          bookkeeping,
          outbox,
          now,
          stamp: () => clock.now(),
          snapshotEvery: options.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY,
          autoSync: options.autoSync ?? true,
          readOnly,
          settings: () => Object.fromEntries(session.getView().settings),
          ...(online ? {} : { ensure, initialError: offlineError }),
          otherJournals,
          ...(options.fullPullEvery !== undefined ? { fullPullEvery: options.fullPullEvery } : {}),
          ...(options.rollUpAt !== undefined ? { rollUpAt: options.rollUpAt } : {}),
          ...(options.timers ? { timers: options.timers } : {}),
          onApplied,
        }),
    });
    await store.setMarker(loadingKey(layout.libraryId), null);
    session.syncEngine.start();
    return session;
  } catch (error) {
    handle.release();
    throw error;
  }
}
