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
import type { ChangedEntity, MergeStore } from './merge-store';
import { rollUpSegments } from './rollup';
import { snapshotName, writeSnapshot } from './snapshot';
import type { LibraryLayout, OpEnvelope, SyncStatus } from './types';

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
} as const;

export const NEWER_APP_MESSAGE = 'Another device uses a newer version of Lopsy Photos. Reload to update.';

/** Segments hold at most this many ops, so one huge import does not make one huge file. */
const MAX_OPS_PER_SEGMENT = 10_000;
const MAX_PROBLEMS = 100;
const DEFAULT_ROLLUP_AT = 20;

export interface SyncEngineOptions {
  readonly adapter: StorageAdapter;
  readonly layout: LibraryLayout;
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
  readonly timers?: SyncTimers;
  /** Called after remote ops changed the store. */
  readonly onApplied: (changed: readonly ChangedEntity[]) => void;
}

type Bookkeeping = {
  vector: Record<string, number>;
  appliedAhead: Record<string, string[]>;
  snapshot: string | null;
  opsSinceSnapshot: number;
  flushedSeq: number;
  lastSyncedAt: string | null;
};

export class SyncEngine {
  private readonly o: SyncEngineOptions;
  private readonly timers: SyncTimers;
  private outbox: OpEnvelope[];
  private bk: Bookkeeping;
  private status: SyncStatus;
  private readonly listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private deviceFolderId: FileId | null = null;
  private deviceFileWritten = false;
  private firstPendingAt: number | null = null;
  private flushTimer: unknown = null;
  private pullTimer: unknown = null;
  private retryTimer: unknown = null;
  private retryDelay: number = SYNC_INTERVALS.retryMinMs;
  private closed = false;
  private stateDirty = false;
  private lastStateSave: number;
  private newerSeen = false;
  private segmentsSinceRollUp = 0;
  /** The latest segments or lines that could not be read, for diagnostics. */
  readonly problems: string[] = [];

  constructor(options: SyncEngineOptions) {
    this.o = options;
    this.timers = options.timers ?? DEFAULT_TIMERS;
    const b = options.bookkeeping;
    this.outbox = options.outbox.filter((op) => op.seq > b.flushedSeq).sort((x, y) => x.seq - y.seq);
    this.lastStateSave = options.now();
    this.bk = {
      vector: { ...b.vector },
      appliedAhead: Object.fromEntries(Object.entries(b.appliedAhead).map(([d, names]) => [d, [...names]])),
      snapshot: b.snapshot,
      opsSinceSnapshot: b.opsSinceSnapshot,
      flushedSeq: b.flushedSeq,
      lastSyncedAt: b.lastSyncedAt,
    };
    this.newerSeen = options.readOnly === true;
    this.status = {
      state: this.newerSeen ? 'error' : 'idle',
      pendingOps: this.outbox.length,
      lastSyncedAt: b.lastSyncedAt,
      error: this.newerSeen ? NEWER_APP_MESSAGE : null,
    };
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
    this.outbox.push(...ops);
    this.bk.opsSinceSnapshot += ops.length;
    this.stateDirty = true;
    this.persist({ appendOutbox: ops, nextSeq });
    this.setStatus({ pendingOps: this.outbox.length });
    if (this.firstPendingAt === null) this.firstPendingAt = this.o.now();
    if (this.o.autoSync && !this.closed && this.status.state !== 'paused') this.scheduleFlush();
  }

  /** Writes the outbox and reads other devices' segments now. */
  async syncNow(): Promise<void> {
    await this.exclusive(async () => {
      await this.flush();
      await this.pull();
      await this.maybeSnapshot();
      await this.maybeRollUp();
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

  private async exclusive(work: () => Promise<void>, saveState: boolean): Promise<void> {
    while (this.running) await this.running;
    const run = (async () => {
      this.setStatus({ state: 'syncing' });
      try {
        await work();
        this.retryDelay = SYNC_INTERVALS.retryMinMs;
        this.bk.lastSyncedAt = new Date(this.o.now()).toISOString();
        this.setStatus({
          state: this.newerSeen ? 'error' : 'idle',
          error: this.newerSeen ? NEWER_APP_MESSAGE : null,
          lastSyncedAt: this.bk.lastSyncedAt,
        });
        if (this.o.autoSync && !this.closed && this.pullTimer === null) this.schedulePull(SYNC_INTERVALS.pullEveryMs);
      } catch (error) {
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
    const message = error instanceof Error ? error.message : String(error);
    if (isStorageError(error) && error.code === 'auth') {
      this.clearTimers();
      this.setStatus({ state: 'paused', error: message });
      return;
    }
    if (isStorageError(error) && (error.code === 'network' || error.code === 'rate-limited')) {
      this.setStatus({ state: 'offline', error: message });
      this.scheduleRetry();
      return;
    }
    this.setStatus({ state: 'error', error: message });
    this.scheduleRetry();
  }

  private async flush(): Promise<void> {
    while (this.outbox.length > 0) {
      const batch = this.outbox.slice(0, MAX_OPS_PER_SEGMENT);
      const first = (batch[0] as OpEnvelope).seq;
      const last = (batch[batch.length - 1] as OpEnvelope).seq;
      const folderId = await this.deviceFolder();
      const content = await encodeSegment(batch);
      await this.o.adapter.createFile(
        {
          parentId: folderId,
          name: segmentName(first, last),
          mimeType: SEGMENT_MIME_TYPE,
          properties: { 'lp.lib': this.o.layout.libraryId, 'lp.role': ROLES.segment, 'lp.device': this.o.deviceId },
        },
        content,
      );
      this.outbox = this.outbox.filter((op) => op.seq > last);
      this.bk.flushedSeq = Math.max(this.bk.flushedSeq, last);
      this.bk.vector[this.o.deviceId] = this.bk.flushedSeq;
      this.segmentsSinceRollUp += 1;
      // The saved outbox keeps these ops until a saved state holds them (saveState): pulls skip this device's folder.
      this.stateDirty = true;
      this.persist({ sync: this.bookkeeping() });
      this.setStatus({ pendingOps: this.outbox.length });
    }
    this.firstPendingAt = null;
    if (!this.deviceFileWritten && this.deviceFolderId !== null) await this.writeDeviceFile();
  }

  private async deviceFolder(): Promise<FileId> {
    if (this.deviceFolderId) return this.deviceFolderId;
    const { adapter, layout, deviceId } = this.o;
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
    const { adapter, layout, deviceId } = this.o;
    const content = new Blob(
      [
        JSON.stringify(
          {
            deviceId,
            name: this.o.deviceName,
            appVersion: this.o.appVersion,
            lastSeen: new Date(this.o.now()).toISOString(),
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
    this.deviceFileWritten = true;
  }

  private async pull(): Promise<void> {
    const { adapter, layout, deviceId } = this.o;
    const folders = (await adapter.listChildren(layout.journalId)).filter((f) => f.isFolder);
    let appliedAny = false;
    for (const folder of folders) {
      const device = folder.properties['lp.device'] ?? folder.name;
      if (!isDeviceId(device) || device === deviceId) continue;
      if (await this.pullDevice(device, folder)) appliedAny = true;
    }
    if (appliedAny) this.stateDirty = true;
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
    this.persist({
      state: this.o.store.serialize(),
      removeOutboxThrough: this.bk.flushedSeq,
      sync: this.bookkeeping(),
    });
  }

  private async pullDevice(device: string, folder: StoredFile): Promise<boolean> {
    const seen = this.bk.vector[device] ?? 0;
    const ahead = new Set(this.bk.appliedAhead[device] ?? []);
    const segments = (await this.o.adapter.listChildren(folder.id))
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
    if (this.o.readOnly) return;
    if (this.bk.opsSinceSnapshot < this.o.snapshotEvery) return;
    const hlc = this.o.stamp();
    await writeSnapshot(this.o.adapter, this.o.layout.snapshotsId, {
      format: 1,
      libraryId: this.o.layout.libraryId,
      device: this.o.deviceId,
      hlc,
      vector: { ...this.bk.vector },
      store: this.o.store.serialize(),
    });
    this.bk.snapshot = snapshotName(hlc, this.o.deviceId);
    this.bk.opsSinceSnapshot = 0;
    this.persist({ sync: this.bookkeeping() });
  }

  private async maybeRollUp(): Promise<void> {
    if (this.o.readOnly || this.deviceFolderId === null) return;
    const minRun = this.o.rollUpAt ?? DEFAULT_ROLLUP_AT;
    if (this.segmentsSinceRollUp < minRun) return;
    try {
      const result = await rollUpSegments({
        adapter: this.o.adapter,
        folderId: this.deviceFolderId,
        deviceId: this.o.deviceId,
        libraryId: this.o.layout.libraryId,
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
      lastSyncedAt: this.bk.lastSyncedAt,
    };
  }

  private persist(patch: LocalStorePatch): void {
    this.persistQueue = this.persistQueue
      .then(() => this.o.local.write(this.o.layout.libraryId, patch))
      .catch((error: unknown) => {
        console.error('Could not save library state on this device', error);
        this.setStatus({ state: 'error', error: 'Could not save changes on this device' });
      });
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
