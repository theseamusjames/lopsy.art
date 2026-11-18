/**
 * `openLibrary`: the `LibrarySession` the UI uses (types.ts). Commands turn
 * into ops that apply to the local merge store at once, go into the outbox
 * and are written to storage by the sync engine.
 */

import type { StorageAdapter } from '../storage/types';
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
import {
  DEFAULT_RECIPE,
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
  OriginalStatus,
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

class Session implements PhotosLibrarySession {
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
    this.emit(assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields })));
  }

  setKeyword(assetIds: readonly AssetId[], keyword: string, present: boolean): void {
    const [member] = normalizedKeywords([keyword]);
    if (member === undefined) return;
    this.emit(assetIds.map((id): Op => ({ t: 'member', kind: 'asset', id, set: 'keywords', member, present })));
  }

  deleteAssets(assetIds: readonly AssetId[]): void {
    this.emit(assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields: { deleted: true } })));
  }

  restoreAssets(assetIds: readonly AssetId[]): void {
    this.emit(assetIds.map((id): Op => ({ t: 'set', kind: 'asset', id, fields: { deleted: false } })));
  }

  createVersion(assetId: AssetId, name: string, recipe?: Recipe): VersionId {
    const versionId = newId(this.now());
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields: this.versionFields(assetId, name, recipe) }]);
    return versionId;
  }

  renameVersion(versionId: VersionId, name: string): void {
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields: { name } }]);
  }

  deleteVersion(versionId: VersionId): void {
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields: { deleted: true } }]);
  }

  editRecipe(versionId: VersionId, changes: Readonly<Record<string, Json>>, label: string): void {
    const fields: Record<string, Json> = {};
    for (const [path, value] of Object.entries(changes)) fields[`recipe.${path}`] = value;
    if (Object.keys(fields).length === 0) return;
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], { id: newId(this.now()), label });
  }

  setRecipe(versionId: VersionId, recipe: Recipe, label: string): void {
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields: recipeFields(recipe) }], {
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
    for (const w of writes) {
      if (w.hlc < ref.hlc || (w.hlc === ref.hlc && w.opId <= ref.opId)) continue;
      const ownUndoRedo =
        deviceOf(w.opId) === this.deviceId && w.step !== null && (w.step.undoes !== undefined || w.step.redoes !== undefined);
      // This device's own steps that it has undone since do not count either: their change is gone.
      if (ownUndoRedo || (w.step !== null && undoneHere.has(w.step.id))) continue;
      for (const path of Object.keys(w.fields)) touched.add(path);
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

  setAlbumMember(albumId: AlbumId, assetId: AssetId, present: boolean): void {
    this.emit([{ t: 'member', kind: 'album', id: albumId, set: 'assets', member: assetId, present }]);
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

  setSetting(key: string, value: Json): void {
    this.emit([{ t: 'set', kind: 'setting', id: key, fields: { value } }]);
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
      ...recipeFields(recipe ?? DEFAULT_RECIPE),
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
  private emit(given: readonly Op[], step?: OpStep, internal = false): void {
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
    if (ops.length === 0) return;
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
      if (current !== undefined && sameJson(current.value, value)) {
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

async function bootstrap(
  adapter: StorageAdapter,
  layout: LibraryLayout,
): Promise<{ merge: MergeStore; bookkeeping: SyncBookkeeping }> {
  const newest = await loadNewestSnapshot(adapter, layout.snapshotsId, layout.libraryId);
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
  try {
    const ensured = await ensureLibrary(adapter, { now });
    layout = ensured.layout;
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
      online ? bootstrap(adapter, layout) : { merge: new MergeStore(), bookkeeping: EMPTY_BOOKKEEPING };
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
      const ensured = await ensureLibrary(adapter, { now });
      if (ensured.layout.libraryId !== libraryId) {
        throw new Error('The library in storage is not the one this device opened before.');
      }
      if (ensured.manifest.schemaVersion > LIBRARY_SCHEMA_VERSION) session.markReadOnly();
      await store.write(libraryId, { layout: ensured.layout });
      session.updateLayout(ensured.layout);
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
          ...(options.fullPullEvery !== undefined ? { fullPullEvery: options.fullPullEvery } : {}),
          ...(options.rollUpAt !== undefined ? { rollUpAt: options.rollUpAt } : {}),
          ...(options.timers ? { timers: options.timers } : {}),
          onApplied,
        }),
    });
    session.syncEngine.start();
    return session;
  } catch (error) {
    handle.release();
    throw error;
  }
}
