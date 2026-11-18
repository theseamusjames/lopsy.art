/**
 * The sync engine (spec 6.6). It writes this device's outbox as new
 * journal segments, reads other devices' segments, applies them to the
 * merge store and writes snapshots. It never rewrites a file another
 * device wrote, and an op leaves the outbox only once the segment holding
 * it has been created in storage.
 */

import { isStorageError } from '../storage/errors';
import type { FileId, StorageAdapter, StoredFile } from '../storage/types';
import { DecodeError } from './gzip';
import { isDeviceId } from './ids';
import { decodeSegment, encodeSegment, parseSegmentName, SEGMENT_MIME_TYPE, segmentName } from './journal';
import { ROLES } from './layout';
import type { LocalStore, LocalStorePatch, SyncBookkeeping } from './local-store';
import type { ChangedEntity, MergeStore, SerializedStore } from './merge-store';
import { rollUpSegments } from './rollup';
import { snapshotName, writeSnapshot } from './snapshot';
import type { Json, LibraryLayout, OpEnvelope, SyncStatus } from './types';

export interface SyncTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const DEFAULT_TIMERS: SyncTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const SYNC_INTERVALS = {
  /** Flush this long after the last change... */
  flushDebounceMs: 2_000,
  /** ...but no later than this after the first unflushed one. */
  flushMaxDelayMs: 30_000,
  pullEveryMs: 30_000,
  retryMinMs: 2_000,
  retryMaxMs: 60_000,
  /** The merged state is saved on the device at most this often while flushing. */
  stateSaveMs: 30_000,
  /** `devices/<id>.json` is rewritten at most this often on flush. */
  deviceFileMs: 5 * 60_000,
} as const;

export const NEWER_APP_MESSAGE = 'Another device uses a newer version of Lopsy Photos. Reload to update.';

/** Segments hold at most this many ops, so one huge import does not make one huge file. */
const MAX_OPS_PER_SEGMENT = 10_000;
const MAX_PROBLEMS = 100;
const DEFAULT_ROLLUP_AT = 20;
const DEFAULT_FULL_PULL_EVERY = 60;

export interface SyncEngineOptions {
  readonly adapter: StorageAdapter;
  readonly layout: LibraryLayout;
  /**
   * Set when the library was opened from the device alone because storage
   * was unreachable: finds the library in storage before the first sync,
   * and is retried until it succeeds.
   */
  readonly ensure?: () => Promise<LibraryLayout>;
  /** Journal folders of duplicate library roots, read but never written (layout.ts `otherJournals`). */
  readonly otherJournals?: readonly FileId[];
  /** Why storage could not be reached at open, shown in the first status. */
  readonly initialError?: unknown;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly appVersion: string;
  readonly store: MergeStore;
  readonly local: LocalStore;
  readonly bookkeeping: SyncBookkeeping;
  /** The saved outbox. Ops at or below `bookkeeping.flushedSeq` are in storage already. */
  readonly outbox: readonly OpEnvelope[];
  readonly now: () => number;
  /** A fresh HLC stamp from the device clock (names snapshots). */
  readonly stamp: () => string;
  readonly snapshotEvery: number;
  readonly autoSync: boolean;
  /** The library's schema is newer than this app: read, never write (spec 6.6). */
  readonly readOnly?: boolean;
  /** Roll up this device's segments once this many small ones have been written (default 20). */
  readonly rollUpAt?: number;
  /** List every device folder after this many pulls through the change feed (default 60, 30 minutes). */
  readonly fullPullEvery?: number;
  readonly timers?: SyncTimers;
  /** The synced settings, for the readable `settings.json` copy (spec 6.6). */
  readonly settings?: () => Readonly<Record<string, Json>>;
  /** Called after remote ops changed the store. */
  readonly onApplied: (changed: readonly ChangedEntity[]) => void;
}

interface PendingPatch {
  append: OpEnvelope[];
  removeThrough?: number;
  deviceId?: string;
  nextSeq?: number;
  state?: SerializedStore;
  sync?: SyncBookkeeping;
  layout?: LibraryLayout;
  /** The vector the state in this patch holds. */
  stateVector?: VectorPair;
}

interface VectorPair {
  readonly vector: Readonly<Record<string, number>>;
  readonly ahead: Readonly<Record<string, readonly string[]>>;
}

function copyAhead(ahead: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(ahead).map(([d, names]) => [d, [...names]]));
}

function copyVector(pair: VectorPair): VectorPair {
  return { vector: { ...pair.vector }, ahead: copyAhead(pair.ahead) };
}

function addToPending(pending: PendingPatch, patch: LocalStorePatch, stateVector: VectorPair | undefined): void {
  if (patch.removeOutboxThrough !== undefined) {
    const through = patch.removeOutboxThrough;
    pending.removeThrough = Math.max(pending.removeThrough ?? 0, through);
    if (pending.append.some((op) => op.seq <= through)) {
      pending.append = pending.append.filter((op) => op.seq > through);
    }
  }
  if (patch.appendOutbox) for (const op of patch.appendOutbox) pending.append.push(op);
  if (patch.deviceId !== undefined) pending.deviceId = patch.deviceId;
  if (patch.nextSeq !== undefined) pending.nextSeq = patch.nextSeq;
  if (patch.state !== undefined) {
    pending.state = patch.state;
    if (stateVector) pending.stateVector = stateVector;
  }
  if (patch.sync !== undefined) pending.sync = patch.sync;
  if (patch.layout !== undefined) pending.layout = patch.layout;
}

function pendingAsPatch(p: PendingPatch): LocalStorePatch {
  return {
    ...(p.deviceId !== undefined ? { deviceId: p.deviceId } : {}),
    ...(p.nextSeq !== undefined ? { nextSeq: p.nextSeq } : {}),
    ...(p.append.length > 0 ? { appendOutbox: p.append } : {}),
    ...(p.removeThrough !== undefined ? { removeOutboxThrough: p.removeThrough } : {}),
    ...(p.state !== undefined ? { state: p.state } : {}),
    ...(p.sync !== undefined ? { sync: p.sync } : {}),
    ...(p.layout !== undefined ? { layout: p.layout } : {}),
  };
}

type Bookkeeping = {
  vector: Record<string, number>;
  appliedAhead: Record<string, string[]>;
  snapshot: string | null;
  opsSinceSnapshot: number;
  flushedSeq: number;
  lastSyncedAt: string | null;
  changeCursor: string | null;
};

/** auth: needs the user; network and rate limits: offline, retried; anything else: an error. */
export function classify(error: unknown): { state: 'paused' | 'offline' | 'error'; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (isStorageError(error) && error.code === 'auth') return { state: 'paused', error: message };
  if (isStorageError(error) && (error.code === 'network' || error.code === 'rate-limited')) {
    return { state: 'offline', error: message };
  }
  return { state: 'error', error: message };
}

export class SyncEngine {
  private readonly o: SyncEngineOptions;
  private readonly timers: SyncTimers;
  private outbox: OpEnvelope[];
  private bk: Bookkeeping;
  private status: SyncStatus;
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private pending: PendingPatch | null = null;
  private pendingQueued = false;
  private deviceFolderId: FileId | null = null;
  private deviceFileWrittenAt: number | null = null;
  private layout: LibraryLayout;
  private ready: boolean;
  private lost = false;
  private otherJournals: readonly FileId[];
  private readOnly: boolean;
  private firstPendingAt: number | null = null;
  private flushTimer: unknown = null;
  private pullTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryDelay: number = SYNC_INTERVALS.retryMinMs;
  private closed = false;
  private stateDirty = false;
  private lastStateSave: number;
  private newerSeen = false;
  /** Starts high so a session's first pull lists every folder (and retries segments it skipped before). */
  private pullsSinceFull = Number.POSITIVE_INFINITY;
  /** Journal folder ID -> device, learned from listings and the feed. */
  private readonly deviceFolders = new Map<FileId, string>();
  private segmentsSinceRollUp = 0;
  /** The highest seq of this device whose outbox write has committed; only those ops are uploaded. */
  private committedSeq: number;
  /** The highest seq queued on this device. */
  private lastEnqueuedSeq = 0;
  /** The vector that the state saved on the device holds; the saved bookkeeping never claims more. */
  private savedVector: VectorPair;
  private settingsDirty = false;
  private settingsFileId: FileId | null = null;
  /** The latest segments or lines that could not be read, for diagnostics. */
  readonly problems: string[] = [];

  constructor(options: SyncEngineOptions) {
    this.o = options;
    this.layout = options.layout;
    this.otherJournals = options.otherJournals ?? [];
    this.ready = options.ensure === undefined;
    this.readOnly = options.readOnly === true;
    this.timers = options.timers ?? DEFAULT_TIMERS;
    const b = options.bookkeeping;
    this.outbox = options.outbox.filter((op) => op.seq > b.flushedSeq).sort((x, y) => x.seq - y.seq);
    this.committedSeq = options.outbox.reduce((m, op) => Math.max(m, op.seq), b.flushedSeq);
    this.lastEnqueuedSeq = this.committedSeq;
    this.savedVector = copyVector({ vector: b.vector, ahead: b.appliedAhead });
    this.lastStateSave = options.now();
    this.bk = {
      vector: { ...b.vector },
      appliedAhead: Object.fromEntries(Object.entries(b.appliedAhead).map(([d, names]) => [d, [...names]])),
      snapshot: b.snapshot,
      opsSinceSnapshot: b.opsSinceSnapshot,
      flushedSeq: b.flushedSeq,
      lastSyncedAt: b.lastSyncedAt,
      changeCursor: b.changeCursor ?? null,
    };
    this.newerSeen = options.readOnly === true;
    this.status = {
      state: this.newerSeen ? 'error' : 'idle',
      pendingOps: this.outbox.length,
      lastSyncedAt: b.lastSyncedAt,
      error: this.newerSeen ? NEWER_APP_MESSAGE : null,
    };
    if (options.initialError !== undefined) this.status = { ...this.status, ...classify(options.initialError) };
  }

  /** Duplicate library roots found once storage was reached (offline open). */
  setOtherJournals(journals: readonly FileId[]): void {
    this.otherJournals = journals;
  }

  /** The library turned out to have a newer schema: keep reading, stop writing. */
  markReadOnly(): void {
    this.readOnly = true;
    this.newerSeen = true;
  }

  start(): void {
    if (!this.o.autoSync || this.closed) return;
    this.schedulePull(0);
    if (this.outbox.length > 0) this.scheduleFlush();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Queues ops made on this device. They are already applied to the store. */
  enqueue(ops: readonly OpEnvelope[], nextSeq: number): void {
    if (ops.length === 0) return;
    this.lastEnqueuedSeq = Math.max(this.lastEnqueuedSeq, ...ops.map((op) => op.seq));
    this.outbox.push(...ops);
    this.bk.opsSinceSnapshot += ops.length;
    this.stateDirty = true;
    if (ops.some((e) => e.op.kind === 'setting')) this.settingsDirty = true;
    this.persist({ appendOutbox: ops, nextSeq });
    this.setStatus({ pendingOps: this.outbox.length });
    if (this.firstPendingAt === null) this.firstPendingAt = this.o.now();
    if (this.o.autoSync && !this.closed && this.status.state !== 'paused') this.scheduleFlush();
  }

  /** Writes the outbox and reads other devices' segments now. */
  async syncNow(): Promise<void> {
    await this.exclusive(async () => {
      // Each step stops if another tab took the library over during the one before.
      for (const step of [this.flush, this.pull, this.maybeSnapshot, this.maybeRollUp, this.writeSettings]) {
        if (this.lost) return;
        await step.call(this);
      }
    }, true);
  }

  /** Stops timers, flushes what it can and waits for local writes. */
  async close(): Promise<void> {
    this.closed = true;
    this.clearTimers();
    await this.exclusive(() => this.flush(), true);
    await this.persistQueue;
  }

  /** Waits for every queued local write. */
  async idle(): Promise<void> {
    await this.persistQueue;
  }

  /**
   * Another tab took the library over: stop writing to storage and to the
   * device, for good.
   */
  lose(message: string): void {
    this.lost = true;
    this.closed = true;
    this.clearTimers();
    this.setStatus({ state: 'error', error: message });
  }

  get isLost(): boolean {
    return this.lost;
  }

  private async exclusive(work: () => Promise<void>, saveState: boolean): Promise<void> {
    while (this.running) await this.running;
    if (this.lost) return;
    const run = (async () => {
      this.setStatus({ state: 'syncing' });
      try {
        if (!this.ready && this.o.ensure) {
          this.layout = await this.o.ensure();
          this.ready = true;
        }
        await work();
        if (this.lost) return;
        this.retryDelay = SYNC_INTERVALS.retryMinMs;
        this.bk.lastSyncedAt = new Date(this.o.now()).toISOString();
        this.setStatus({
          state: this.newerSeen ? 'error' : 'idle',
          error: this.newerSeen ? NEWER_APP_MESSAGE : null,
          lastSyncedAt: this.bk.lastSyncedAt,
        });
        if (this.o.autoSync && !this.closed && this.pullTimer === null) this.schedulePull(SYNC_INTERVALS.pullEveryMs);
      } catch (error) {
        if (this.lost) return;
        this.fail(error);
      }
      this.saveState(saveState);
    })();
    this.running = run;
    try {
      await run;
    } finally {
      if (this.running === run) this.running = null;
    }
  }

  private fail(error: unknown): void {
    const status = classify(error);
    this.setStatus(status);
    if (status.state === 'paused') this.clearTimers();
    else this.scheduleRetry();
  }

  /**
   * Uploads the outbox. Only ops whose outbox write has committed on the
   * device go: an op uploaded before that could, after a crash, see its seq
   * issued again to a different op, which other devices would never read.
   */
  private async flush(): Promise<void> {
    // Also retries a device write that failed before, so ops it held can commit.
    await this.whenDurable().catch(() => undefined);
    for (;;) {
      if (this.lost) return;
      const batch = this.outbox.filter((op) => op.seq <= this.committedSeq).slice(0, MAX_OPS_PER_SEGMENT);
      if (batch.length === 0) break;
      const first = (batch[0] as OpEnvelope).seq;
      const last = (batch[batch.length - 1] as OpEnvelope).seq;
      const folderId = await this.deviceFolder();
      const content = await encodeSegment(batch);
      // A tab that lost the library while this was being prepared must not upload it.
      if (this.lost) return;
      await this.o.adapter.createFile(
        {
          parentId: folderId,
          name: segmentName(first, last),
          mimeType: SEGMENT_MIME_TYPE,
          properties: { 'lp.lib': this.layout.libraryId, 'lp.role': ROLES.segment, 'lp.device': this.o.deviceId },
        },
        content,
      );
      this.outbox = this.outbox.filter((op) => op.seq > last);
      this.bk.flushedSeq = Math.max(this.bk.flushedSeq, last);
      // Joins the vector only if every earlier op of this device is in the state (see ownLag).
      this.markApplied(this.o.deviceId, segmentName(first, last), { firstSeq: first, lastSeq: last });
      this.segmentsSinceRollUp += 1;
      // The saved outbox keeps these ops until a saved state holds them (saveState): pulls skip this device's folder.
      this.stateDirty = true;
      this.persist({ sync: this.bookkeeping() });
      this.setStatus({ pendingOps: this.outbox.length });
    }
    if (this.outbox.length === 0) this.firstPendingAt = null;
    const due =
      this.deviceFileWrittenAt === null || this.o.now() - this.deviceFileWrittenAt >= SYNC_INTERVALS.deviceFileMs;
    if (due && this.deviceFolderId !== null && !this.lost) await this.writeDeviceFile();
  }

  private async deviceFolder(): Promise<FileId> {
    if (this.deviceFolderId) return this.deviceFolderId;
    const { adapter, deviceId } = this.o;
    const layout = this.layout;
    const existing = (await adapter.listChildren(layout.journalId)).find(
      (f) => f.isFolder && f.properties['lp.device'] === deviceId,
    );
    const folder =
      existing ??
      (await adapter.createFolder(layout.journalId, deviceId, {
        'lp.lib': layout.libraryId,
        'lp.role': ROLES.deviceJournal,
        'lp.device': deviceId,
      }));
    this.deviceFolderId = folder.id;
    return folder.id;
  }

  private async writeDeviceFile(): Promise<void> {
    const { adapter, deviceId } = this.o;
    const layout = this.layout;
    const content = new Blob(
      [
        JSON.stringify(
          {
            deviceId,
            name: this.o.deviceName,
            appVersion: this.o.appVersion,
            lastSeenAt: new Date(this.o.now()).toISOString(),
          },
          null,
          2,
        ) + '\n',
      ],
      { type: 'application/json' },
    );
    const existing = (await adapter.listChildren(layout.devicesId)).find(
      (f) => !f.isFolder && f.properties['lp.device'] === deviceId,
    );
    if (existing) {
      await adapter.updateContent(existing.id, content);
    } else {
      await adapter.createFile(
        {
          parentId: layout.devicesId,
          name: `${deviceId}.json`,
          mimeType: 'application/json',
          properties: { 'lp.lib': layout.libraryId, 'lp.role': ROLES.device, 'lp.device': deviceId },
        },
        content,
      );
    }
    this.deviceFileWrittenAt = this.o.now();
  }

  /**
   * Reads other devices' new segments. Normally only the devices the
   * storage change feed mentions are listed; every `fullPullEvery` pulls,
   * with no saved cursor, or when the feed fails, every device folder is.
   */
  private async pull(): Promise<void> {
    await this.pullOwnLag();
    const cursor = this.bk.changeCursor;
    const every = this.o.fullPullEvery ?? DEFAULT_FULL_PULL_EVERY;
    if (cursor !== null && this.pullsSinceFull < every) {
      const feed = await this.devicesFromFeed(cursor);
      if (feed) {
        this.pullsSinceFull += 1;
        let appliedAny = false;
        for (const [device, folderId] of feed.devices) {
          if (await this.pullDevice(device, folderId)) appliedAny = true;
        }
        if (appliedAny) this.stateDirty = true;
        // Saved only once the pulls it covers have succeeded.
        this.bk.changeCursor = feed.cursor;
        return;
      }
    }
    await this.fullPull();
  }

  private async fullPull(): Promise<void> {
    const { adapter, deviceId } = this.o;
    let cursor: string | null = null;
    try {
      // Taken before listing, so a change made while listing shows in the next feed read.
      cursor = await adapter.getChangeCursor();
    } catch (error) {
      if (!isStorageError(error) || error.code === 'auth' || error.retryable) throw error;
      this.report(`Change feed unavailable: ${error.message}`);
    }
    const folders: StoredFile[] = [];
    for (const journalId of [this.layout.journalId, ...(this.otherJournals)]) {
      for (const f of await adapter.listChildren(journalId)) if (f.isFolder) folders.push(f);
    }
    let appliedAny = false;
    for (const folder of folders) {
      const device = folder.properties['lp.device'] ?? folder.name;
      if (!isDeviceId(device) || device === deviceId) continue;
      this.deviceFolders.set(folder.id, device);
      if (await this.pullDevice(device, folder.id)) appliedAny = true;
    }
    if (appliedAny) this.stateDirty = true;
    this.bk.changeCursor = cursor;
    this.pullsSinceFull = 0;
  }

  /**
   * The devices with new journal files since `cursor`, by device folder,
   * and the feed's new cursor saved; null when the feed cannot be used.
   */
  private async devicesFromFeed(cursor: string): Promise<{ devices: Map<string, FileId>; cursor: string } | null> {
    const devices = new Map<string, FileId>();
    let next = cursor;
    try {
      for (;;) {
        const page = await this.o.adapter.listChanges(next);
        for (const change of page.changes) {
          const file = change.file;
          if (!file || file.trashed || file.parentId === null) continue;
          if (file.isFolder && (file.parentId === this.layout.journalId || this.otherJournals.includes(file.parentId))) {
            const device = file.properties['lp.device'] ?? file.name;
            if (isDeviceId(device) && device !== this.o.deviceId) {
              this.deviceFolders.set(file.id, device);
              devices.set(device, file.id);
            }
            continue;
          }
          const device = this.deviceFolders.get(file.parentId) ?? file.properties['lp.device'];
          if (file.isFolder || device === undefined || device === this.o.deviceId) continue;
          if (file.properties['lp.role'] !== ROLES.segment && !this.deviceFolders.has(file.parentId)) continue;
          if (!isDeviceId(device)) continue;
          devices.set(device, file.parentId);
        }
        next = page.cursor;
        if (!page.hasMore) break;
      }
    } catch (error) {
      if (!isStorageError(error) || error.code === 'auth' || error.retryable) throw error;
      // An expired or refused cursor: list everything instead.
      this.report(`Change feed failed, listing folders instead: ${error.message}`);
      return null;
    }
    return { devices, cursor: next };
  }

  /**
   * This device's own segments that its state does not hold: after the
   * state was rebuilt from a snapshot, or after a state write was lost.
   * Pulls otherwise skip this device's folder.
   */
  private async pullOwnLag(): Promise<void> {
    const self = this.o.deviceId;
    if ((this.bk.vector[self] ?? 0) >= this.bk.flushedSeq) return;
    const folder = (await this.o.adapter.listChildren(this.layout.journalId)).find(
      (f) => f.isFolder && f.properties['lp.device'] === self,
    );
    if (!folder) return;
    this.deviceFolderId ??= folder.id;
    if (await this.pullDevice(self, folder.id)) this.stateDirty = true;
  }

  /**
   * Saves the merged state with the bookkeeping, and drops from the saved
   * outbox the ops that are now both in storage and in the saved state.
   */
  private saveState(force: boolean): void {
    if (!this.stateDirty) {
      this.persist({ sync: this.bookkeeping() });
      return;
    }
    if (!force && this.o.now() - this.lastStateSave < SYNC_INTERVALS.stateSaveMs) {
      this.persist({ sync: this.bookkeeping() });
      return;
    }
    this.stateDirty = false;
    this.lastStateSave = this.o.now();
    this.persist(
      { state: this.o.store.serialize(), removeOutboxThrough: this.bk.flushedSeq, sync: this.bookkeeping() },
      copyVector({ vector: this.bk.vector, ahead: this.bk.appliedAhead }),
    );
  }

  private async pullDevice(device: string, folderId: FileId): Promise<boolean> {
    const seen = this.bk.vector[device] ?? 0;
    const ahead = new Set(this.bk.appliedAhead[device] ?? []);
    const segments = (await this.o.adapter.listChildren(folderId))
      .map((file) => ({ file, range: parseSegmentName(file.name) }))
      .filter(
        (s): s is { file: StoredFile; range: { firstSeq: number; lastSeq: number } } =>
          s.range !== null && s.range.lastSeq > seen && !ahead.has(s.file.name),
      )
      .sort((a, b) => a.range.firstSeq - b.range.firstSeq || a.range.lastSeq - b.range.lastSeq);
    let applied = false;
    for (const { file, range } of segments) {
      let ops: OpEnvelope[];
      try {
        let content: Blob;
        try {
          content = await this.o.adapter.readContent(file.id);
        } catch (error) {
          // Rolled up and deleted since the listing; the roll-up is read next time.
          if (isStorageError(error) && error.code === 'not-found') continue;
          throw error;
        }
        const decoded = await decodeSegment(content, { device, range });
        for (const e of decoded.errors) this.report(`${device}/${file.name} line ${e.line}: ${e.reason}`);
        ops = decoded.ops;
        if (decoded.errors.some((e) => e.newer)) {
          // Read again after an update rather than marking it done and losing those ops.
          this.newerSeen = true;
          const changed = this.o.store.applyOps(ops);
          if (changed.length > 0) this.o.onApplied(changed);
          applied = true;
          continue;
        }
      } catch (error) {
        if (!(error instanceof DecodeError)) throw error;
        this.report(`${device}/${file.name}: ${error.message}`);
        continue;
      }
      const changed = this.o.store.applyOps(ops);
      if (changed.some((c) => c.kind === 'setting')) this.settingsDirty = true;
      this.bk.opsSinceSnapshot += ops.length;
      applied = true;
      if (changed.length > 0) this.o.onApplied(changed);
      this.markApplied(device, file.name, range);
    }
    return applied;
  }

  private markApplied(device: string, name: string, range: { firstSeq: number; lastSeq: number }): void {
    const vector = this.bk.vector;
    if (range.firstSeq <= (vector[device] ?? 0) + 1) {
      vector[device] = Math.max(vector[device] ?? 0, range.lastSeq);
    } else {
      (this.bk.appliedAhead[device] ??= []).push(name);
    }
    // Segments read out of order join the vector once the gap before them is filled.
    const pending = (this.bk.appliedAhead[device] ?? [])
      .map((n) => ({ n, r: parseSegmentName(n) }))
      .filter((p): p is { n: string; r: { firstSeq: number; lastSeq: number } } => p.r !== null)
      .sort((a, b) => a.r.firstSeq - b.r.firstSeq);
    const left: string[] = [];
    for (const { n, r } of pending) {
      const at = vector[device] ?? 0;
      if (r.lastSeq <= at) continue;
      if (r.firstSeq <= at + 1) vector[device] = r.lastSeq;
      else left.push(n);
    }
    if (left.length > 0) this.bk.appliedAhead[device] = left;
    else delete this.bk.appliedAhead[device];
  }

  private async maybeSnapshot(): Promise<void> {
    if (this.readOnly) return;
    if (this.bk.opsSinceSnapshot < this.o.snapshotEvery) return;
    // A snapshot must not hold an op whose seq could be issued again after a crash.
    await this.whenDurable().catch(() => undefined);
    if (this.committedSeq < this.lastEnqueuedSeq) return;
    const hlc = this.o.stamp();
    await writeSnapshot(this.o.adapter, this.layout.snapshotsId, {
      format: 1,
      libraryId: this.layout.libraryId,
      device: this.o.deviceId,
      hlc,
      vector: { ...this.bk.vector },
      store: this.o.store.serialize(),
    });
    this.bk.snapshot = snapshotName(hlc, this.o.deviceId);
    this.bk.opsSinceSnapshot = 0;
    this.persist({ sync: this.bookkeeping() });
  }

  private async writeSettings(): Promise<void> {
    if (!this.settingsDirty || this.readOnly || !this.o.settings) return;
    const { adapter } = this.o;
    const layout = this.layout;
    const content = new Blob([JSON.stringify(this.o.settings(), null, 2) + '\n'], { type: 'application/json' });
    this.settingsFileId ??=
      (await adapter.listChildren(layout.dataId)).find((f) => !f.isFolder && f.properties['lp.role'] === ROLES.settings)
        ?.id ?? null;
    if (this.settingsFileId) {
      await adapter.updateContent(this.settingsFileId, content);
    } else {
      const file = await adapter.createFile(
        {
          parentId: layout.dataId,
          name: 'settings.json',
          mimeType: 'application/json',
          properties: { 'lp.lib': layout.libraryId, 'lp.role': ROLES.settings },
        },
        content,
      );
      this.settingsFileId = file.id;
    }
    this.settingsDirty = false;
  }

  private async maybeRollUp(): Promise<void> {
    if (this.readOnly || this.deviceFolderId === null) return;
    const minRun = this.o.rollUpAt ?? DEFAULT_ROLLUP_AT;
    if (this.segmentsSinceRollUp < minRun) return;
    try {
      const result = await rollUpSegments({
        adapter: this.o.adapter,
        folderId: this.deviceFolderId,
        deviceId: this.o.deviceId,
        libraryId: this.layout.libraryId,
        throughSeq: this.bk.flushedSeq,
        minRun,
      });
      for (const problem of result.problems) this.report(problem);
      this.segmentsSinceRollUp = 0;
    } catch (error) {
      // Housekeeping only: the journal is complete without it, so it waits for the next sync.
      this.report(`Roll-up failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private report(problem: string): void {
    if (this.problems.includes(problem)) return;
    this.problems.push(problem);
    if (this.problems.length > MAX_PROBLEMS) this.problems.splice(0, this.problems.length - MAX_PROBLEMS);
  }

  private bookkeeping(): SyncBookkeeping {
    return {
      vector: { ...this.bk.vector },
      appliedAhead: Object.fromEntries(Object.entries(this.bk.appliedAhead).map(([d, n]) => [d, [...n]])),
      snapshot: this.bk.snapshot,
      opsSinceSnapshot: this.bk.opsSinceSnapshot,
      flushedSeq: this.bk.flushedSeq,
      changeCursor: this.bk.changeCursor,
      lastSyncedAt: this.bk.lastSyncedAt,
    };
  }

  /**
   * Queues a write to the device. Patches queued while a write is in
   * flight are merged into one, so a burst of commands (an import of
   * thousands of photos) costs a few transactions, not one each. The
   * saved bookkeeping's vector is always the one the saved state holds
   * (`stateVector` comes with a state), and a failed write is kept and
   * retried with the next one rather than dropped.
   */
  private persist(patch: LocalStorePatch, stateVector?: VectorPair): void {
    // The tab that took over owns the device's saved data now.
    if (this.lost) return;
    const pending = (this.pending ??= { append: [] });
    addToPending(pending, patch, stateVector);
    this.drain();
  }

  private drain(): void {
    if (this.pendingQueued) return;
    this.pendingQueued = true;
    this.persistQueue = this.persistQueue.then(async () => {
      const next = this.pending;
      this.pending = null;
      this.pendingQueued = false;
      if (!next || this.lost) return;
      const vector = next.stateVector ?? this.savedVector;
      const merged: LocalStorePatch = {
        ...(next.deviceId !== undefined ? { deviceId: next.deviceId } : {}),
        ...(next.nextSeq !== undefined ? { nextSeq: next.nextSeq } : {}),
        ...(next.append.length > 0 ? { appendOutbox: next.append } : {}),
        ...(next.removeThrough !== undefined ? { removeOutboxThrough: next.removeThrough } : {}),
        ...(next.state !== undefined ? { state: next.state } : {}),
        ...(next.sync !== undefined
          ? { sync: { ...next.sync, vector: { ...vector.vector }, appliedAhead: copyAhead(vector.ahead) } }
          : {}),
        ...(next.layout !== undefined ? { layout: next.layout } : {}),
      };
      try {
        await this.o.local.write(this.layout.libraryId, merged);
      } catch (error) {
        console.error('Could not save library state on this device', error);
        this.setStatus({ state: 'error', error: 'Could not save changes on this device' });
        await this.salvage(next, merged);
        return;
      }
      this.markCommitted(next.append);
      if (next.stateVector) this.savedVector = next.stateVector;
    });
  }

  /**
   * After a failed device write. Without state in it, the whole write is
   * retried with the next one. With state (the large part, the likeliest
   * to fail on a nearly full disk) the state is dropped and saved afresh
   * later, and the small, vital part (new outbox ops, seq counter, layout)
   * is written at once on its own, so a state that keeps failing never
   * stops ops from committing. Bookkeeping (`sync`) and outbox trimming
   * are put back to go with the state: the stored vector must never get
   * ahead of the stored state, and the stored outbox keeps every op the
   * stored state lacks.
   */
  private async salvage(next: PendingPatch, merged: LocalStorePatch): Promise<void> {
    if (next.state === undefined) {
      this.requeue(merged);
      return;
    }
    this.stateDirty = true;
    const { state: _dropped, deviceId, nextSeq, appendOutbox, layout, ...rest } = merged;
    const vital: LocalStorePatch = {
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(nextSeq !== undefined ? { nextSeq } : {}),
      ...(appendOutbox !== undefined ? { appendOutbox } : {}),
      ...(layout !== undefined ? { layout } : {}),
    };
    if (Object.keys(vital).length > 0) {
      try {
        await this.o.local.write(this.layout.libraryId, vital);
      } catch (error) {
        console.error('Could not save changes on this device', error);
        this.requeue({ ...vital, ...rest });
        return;
      }
      this.markCommitted(next.append);
    }
    // Waits for the state, which is saved afresh with the next write.
    if (Object.keys(rest).length > 0) this.requeue(rest);
  }

  private markCommitted(appended: readonly OpEnvelope[]): void {
    if (appended.length > 0) this.committedSeq = Math.max(this.committedSeq, ...appended.map((op) => op.seq));
  }

  /** Puts a failed write back, ahead of anything queued since, to go with the next one. */
  private requeue(patch: LocalStorePatch): void {
    const newer = this.pending as PendingPatch | null;
    const retry: PendingPatch = { append: [] };
    addToPending(retry, patch, undefined);
    if (newer) addToPending(retry, pendingAsPatch(newer), newer.stateVector);
    this.pending = retry;
  }

  /**
   * Resolves once every command so far is saved on this device, so it
   * survives the tab closing; rejects when that write failed. Callers do
   * this before an action that cannot be undone, such as trashing files.
   */
  async whenDurable(): Promise<void> {
    // A few rounds: writes queued meanwhile, and one more try of a write that was put back.
    for (let round = 0; round < 4; round++) {
      await this.persistQueue;
      if (this.pending === null) break;
      if (!this.pendingQueued) this.drain();
    }
    await this.persistQueue;
    if (this.lost) throw new Error('Opened in another tab.');
    if (this.committedSeq < this.lastEnqueuedSeq) throw new Error('Could not save changes on this device.');
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    const next = { ...this.status, ...patch };
    if (
      next.state === this.status.state &&
      next.pendingOps === this.status.pendingOps &&
      next.lastSyncedAt === this.status.lastSyncedAt &&
      next.error === this.status.error
    ) {
      return;
    }
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) this.timers.clearTimeout(this.flushTimer);
    const since = this.firstPendingAt === null ? 0 : this.o.now() - this.firstPendingAt;
    const delay = Math.max(0, Math.min(SYNC_INTERVALS.flushDebounceMs, SYNC_INTERVALS.flushMaxDelayMs - since));
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = null;
      if (this.status.state === 'paused' || this.closed) return;
      void this.exclusive(() => this.flush(), false);
    }, delay);
  }

  private schedulePull(delay: number): void {
    if (this.pullTimer !== null) this.timers.clearTimeout(this.pullTimer);
    this.pullTimer = this.timers.setTimeout(() => {
      this.pullTimer = null;
      if (this.closed) return;
      if (this.status.state !== 'paused') void this.syncNow();
      this.schedulePull(SYNC_INTERVALS.pullEveryMs);
    }, delay);
  }

  private scheduleRetry(): void {
    if (!this.o.autoSync || this.closed) return;
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(SYNC_INTERVALS.retryMaxMs, this.retryDelay * 2);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (this.status.state !== 'paused' && !this.closed) void this.syncNow();
    }, delay);
  }

  private clearTimers(): void {
    for (const handle of [this.flushTimer, this.pullTimer, this.retryTimer]) {
      if (handle !== null) this.timers.clearTimeout(handle);
    }
    this.flushTimer = null;
    this.pullTimer = null;
    this.retryTimer = null;
  }
}
