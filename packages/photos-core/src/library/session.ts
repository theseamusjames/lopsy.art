/**
 * `openLibrary`: the `LibrarySession` the UI uses (types.ts). Commands turn
 * into ops that apply to the local merge store at once, go into the outbox
 * and are written to storage by the sync engine.
 */

import type { StorageAdapter } from '../storage/types';
import { HybridClock } from './hlc';
import { newId } from './ids';
import { ensureLibrary, LIBRARY_SCHEMA_VERSION } from './layout';
import { EMPTY_BOOKKEEPING, type LocalStore, type SyncBookkeeping } from './local-store';
import { MergeStore, type RecipeWrite } from './merge-store';
import { DEFAULT_RECIPE, recipeToPaths, type Recipe } from './recipe';
import { loadNewestSnapshot } from './snapshot';
import { SyncEngine, type SyncTimers } from './sync';
import type {
  AlbumId,
  AssetId,
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

/** The recipe as `recipe.*` field values. */
export function recipeFields(recipe: Recipe): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, value] of Object.entries(recipeToPaths(recipe))) {
    out[`recipe.${path}`] =
      typeof value === 'object' && value !== null
        ? { x: value.x, y: value.y, width: value.width, height: value.height }
        : value;
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
          iso: asset.exposure.iso,
          shutter: asset.exposure.shutter,
          aperture: asset.exposure.aperture,
          focalLength: asset.exposure.focalLength,
        }
      : null,
    gps: asset.gps ? { lat: asset.gps.lat, lon: asset.gps.lon, alt: asset.gps.alt } : null,
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
  /** The step's first write, for ordering. */
  readonly first: RecipeWrite;
  readonly fields: Record<string, Json>;
  active: boolean;
  /** HLC of the latest undo or redo of this step. */
  lastEventHlc: string | null;
  lastUndoHlc: string | null;
}

function before(a: RecipeWrite, b: RecipeWrite): boolean {
  return a.hlc < b.hlc || (a.hlc === b.hlc && a.opId < b.opId);
}

function analyseHistory(writes: readonly RecipeWrite[]): StepInfo[] {
  const steps = new Map<string, StepInfo>();
  const events: { target: string; undo: boolean; hlc: string }[] = [];
  for (const w of writes) {
    const step = w.step;
    if (!step) continue;
    if (step.undoes !== undefined) {
      events.push({ target: step.undoes, undo: true, hlc: w.hlc });
    } else if (step.redoes !== undefined) {
      events.push({ target: step.redoes, undo: false, hlc: w.hlc });
    } else {
      const existing = steps.get(step.id);
      if (existing) Object.assign(existing.fields, w.fields);
      else
        steps.set(step.id, {
          id: step.id,
          label: step.label,
          hlc: w.hlc,
          first: w,
          fields: { ...w.fields },
          active: true,
          lastEventHlc: null,
          lastUndoHlc: null,
        });
    }
  }
  for (const e of events) {
    const s = steps.get(e.target);
    if (!s || (s.lastEventHlc !== null && s.lastEventHlc > e.hlc)) continue;
    s.lastEventHlc = e.hlc;
    s.active = !e.undo;
    if (e.undo) s.lastUndoHlc = e.hlc;
  }
  return [...steps.values()].sort((a, b) => (before(a.first, b.first) ? -1 : 1));
}

class Session implements LibrarySession {
  readonly libraryId: string;
  readonly deviceId: string;
  readonly layout: LibraryLayout;
  readonly adapter: StorageAdapter;
  private readonly merge: MergeStore;
  private readonly clock: HybridClock;
  private readonly cache: ViewCache;
  private readonly engine: SyncEngine;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private nextSeq: number;
  /** True when the library was made by a newer app (sync status says so too). */
  readonly readOnly: boolean;

  constructor(init: {
    layout: LibraryLayout;
    adapter: StorageAdapter;
    deviceId: string;
    nextSeq: number;
    merge: MergeStore;
    clock: HybridClock;
    now: () => number;
    readOnly: boolean;
    makeEngine: (onApplied: (changed: Parameters<ViewCache['update']>[0]) => void) => SyncEngine;
  }) {
    this.readOnly = init.readOnly;
    this.layout = init.layout;
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
      if (this.cache.update(changed)) this.notify();
    });
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
    const existing = this.cache.view.assets.get(assetId);
    if (existing) return { assetId, versionId: existing.primaryVersionId };
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
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields: { [size]: value } }]);
  }

  undo(versionId: VersionId): boolean {
    const writes = this.merge.recipeWrites(versionId);
    const steps = analyseHistory(writes);
    const target = [...steps].reverse().find((s) => s.active);
    if (!target) return false;
    const fields: Record<string, Json> = {};
    for (const path of Object.keys(target.fields)) {
      fields[`recipe.${path}`] = this.valueBefore(versionId, writes, target.first, path);
    }
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], {
      id: newId(this.now()),
      label: `Undo ${target.label}`,
      undoes: target.id,
    });
    return true;
  }

  redo(versionId: VersionId): boolean {
    const steps = analyseHistory(this.merge.recipeWrites(versionId));
    let target: StepInfo | null = null;
    for (const s of steps) {
      if (s.active || s.lastUndoHlc === null) continue;
      if (!target || (target.lastUndoHlc !== null && s.lastUndoHlc > target.lastUndoHlc)) target = s;
    }
    if (!target || target.lastUndoHlc === null) return false;
    const undoneAt = target.lastUndoHlc;
    // A new edit after the undo ends the redo chain, as in any editor.
    if (steps.some((s) => s.hlc > undoneAt)) return false;
    const fields: Record<string, Json> = {};
    for (const [path, value] of Object.entries(target.fields)) fields[`recipe.${path}`] = value;
    this.emit([{ t: 'set', kind: 'version', id: versionId, fields }], {
      id: newId(this.now()),
      label: `Redo ${target.label}`,
      redoes: target.id,
    });
    return true;
  }

  history(versionId: VersionId): readonly HistoryStep[] {
    return analyseHistory(this.merge.recipeWrites(versionId)).map((s) => ({
      id: s.id,
      label: s.label,
      hlc: s.hlc,
      active: s.active,
    }));
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

  close(): Promise<void> {
    return this.engine.close();
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

  private emit(ops: readonly Op[], step?: OpStep): void {
    if (this.readOnly) throw new LibraryReadOnlyError();
    if (ops.length === 0) return;
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
      const checked = validateEnvelope(JSON.parse(JSON.stringify(env)));
      if (typeof checked === 'string') throw new Error(`Invalid change: ${checked}`);
      envelopes.push(env);
      this.nextSeq += 1;
    }
    const changed = this.merge.applyOps(envelopes);
    this.engine.enqueue(envelopes, this.nextSeq);
    if (this.cache.update(changed)) this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
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

/** Opens (creating if needed) the library in `adapter`'s storage. */
export async function openLibrary(options: OpenLibraryOptions): Promise<LibrarySession> {
  const now = options.now ?? Date.now;
  const { adapter, store } = options;
  const { layout, manifest } = await ensureLibrary(adapter, { now });
  const readOnly = manifest.schemaVersion > LIBRARY_SCHEMA_VERSION;
  const saved = await store.load(layout.libraryId);

  let deviceId: string;
  let nextSeq: number;
  let merge: MergeStore | null = null;
  let bookkeeping: SyncBookkeeping;
  let outbox: readonly OpEnvelope[] = [];
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
      const fresh = await bootstrap(adapter, layout);
      merge = fresh.merge;
      bookkeeping = { ...fresh.bookkeeping, flushedSeq: bookkeeping.flushedSeq };
    }
    merge.applyOps(outbox);
  } else {
    deviceId = newId(now());
    nextSeq = 1;
    const fresh = await bootstrap(adapter, layout);
    merge = fresh.merge;
    bookkeeping = fresh.bookkeeping;
    await store.write(layout.libraryId, { deviceId, nextSeq, state: merge.serialize(), sync: bookkeeping });
  }

  const clock = new HybridClock(deviceId, now);
  if (merge.maxHlc) clock.receive(merge.maxHlc);
  const mergeStore = merge;
  const session = new Session({
    layout,
    adapter,
    deviceId,
    nextSeq,
    merge: mergeStore,
    clock,
    now,
    readOnly,
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
        ...(options.rollUpAt !== undefined ? { rollUpAt: options.rollUpAt } : {}),
        ...(options.timers ? { timers: options.timers } : {}),
        onApplied,
      }),
  });
  session.syncEngine.start();
  return session;
}
