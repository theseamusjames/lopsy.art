/**
 * What a device keeps about a library between sessions (spec 6.6, On the
 * device): its device ID and next sequence number, the outbox, the merged
 * state it has applied and the sync bookkeeping. Everything except the
 * outbox can be rebuilt from storage; the outbox cannot, so every write
 * that touches it is atomic with the sequence counter.
 */

import type { SerializedStore } from './merge-store';
import type { VersionVector } from './snapshot';
import type { OpEnvelope } from './types';

export interface SyncBookkeeping {
  /** Per device, the last seq applied with no gaps before it. */
  readonly vector: VersionVector;
  /** Per device, segment names applied beyond `vector` (read out of order). */
  readonly appliedAhead: Readonly<Record<string, readonly string[]>>;
  /** Name of the snapshot the state was bootstrapped from, if any. */
  readonly snapshot: string | null;
  /** Ops applied since the newest snapshot this device loaded or wrote. */
  readonly opsSinceSnapshot: number;
  /** The last seq of this device that is in storage. */
  readonly flushedSeq: number;
  readonly lastSyncedAt: string | null;
}

export interface StoredLibrary {
  readonly deviceId: string;
  readonly nextSeq: number;
  /** Ops not yet in storage, by seq. */
  readonly outbox: readonly OpEnvelope[];
  readonly state: SerializedStore | null;
  readonly sync: SyncBookkeeping | null;
}

/** One atomic change to a library's saved data. Absent parts are left as they are. */
export interface LocalStorePatch {
  readonly deviceId?: string;
  readonly nextSeq?: number;
  readonly appendOutbox?: readonly OpEnvelope[];
  /** Removes outbox ops with seq at or below this. */
  readonly removeOutboxThrough?: number;
  readonly state?: SerializedStore;
  readonly sync?: SyncBookkeeping;
}

export interface LocalStore {
  /** null when this device has never opened the library. */
  load(libraryId: string): Promise<StoredLibrary | null>;
  /** Applies the patch atomically. A patch without `deviceId` needs a library that was saved before. */
  write(libraryId: string, patch: LocalStorePatch): Promise<void>;
}

export const EMPTY_BOOKKEEPING: SyncBookkeeping = {
  vector: {},
  appliedAhead: {},
  snapshot: null,
  opsSinceSnapshot: 0,
  flushedSeq: 0,
  lastSyncedAt: null,
};

function applyPatch(current: StoredLibrary | null, patch: LocalStorePatch): StoredLibrary {
  const deviceId = patch.deviceId ?? current?.deviceId;
  if (deviceId === undefined) throw new Error('The first write for a library must set its device ID');
  let outbox = current?.outbox ?? [];
  if (patch.removeOutboxThrough !== undefined) {
    const through = patch.removeOutboxThrough;
    outbox = outbox.filter((op) => op.seq > through);
  }
  if (patch.appendOutbox) outbox = [...outbox, ...patch.appendOutbox];
  return {
    deviceId,
    nextSeq: patch.nextSeq ?? current?.nextSeq ?? 1,
    outbox,
    state: patch.state ?? current?.state ?? null,
    sync: patch.sync ?? current?.sync ?? null,
  };
}

/** For tests and for running without persistence. Data is copied in and out, as a real store would. */
export class MemoryLocalStore implements LocalStore {
  private readonly libraries = new Map<string, StoredLibrary>();

  async load(libraryId: string): Promise<StoredLibrary | null> {
    const saved = this.libraries.get(libraryId);
    return saved ? structuredClone(saved) : null;
  }

  async write(libraryId: string, patch: LocalStorePatch): Promise<void> {
    const next = applyPatch(this.libraries.get(libraryId) ?? null, structuredClone(patch));
    this.libraries.set(libraryId, next);
  }
}

const DB_VERSION = 1;
const META = 'meta';
const OUTBOX = 'outbox';
const STATE = 'state';

interface MetaRecord {
  readonly libraryId: string;
  readonly deviceId: string;
  readonly nextSeq: number;
  readonly sync: SyncBookkeeping | null;
}

interface OutboxRecord {
  readonly libraryId: string;
  readonly seq: number;
  readonly op: OpEnvelope;
}

interface StateRecord {
  readonly libraryId: string;
  readonly state: SerializedStore;
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Browser persistence: one IndexedDB database per account (`lopsy-photos:<sub>`)
 * holding any number of libraries, keyed by library ID.
 */
export class IndexedDbLocalStore implements LocalStore {
  private readonly name: string;
  private db: Promise<IDBDatabase> | null = null;

  constructor(databaseName: string) {
    this.name = databaseName;
  }

  async load(libraryId: string): Promise<StoredLibrary | null> {
    const db = await this.open();
    const tx = db.transaction([META, OUTBOX, STATE], 'readonly');
    const done = completed(tx);
    const range = IDBKeyRange.bound([libraryId, 0], [libraryId, Number.MAX_SAFE_INTEGER]);
    const [metaResult, outboxResult, stateResult] = await Promise.all([
      promised(tx.objectStore(META).get(libraryId)),
      promised(tx.objectStore(OUTBOX).getAll(range)),
      promised(tx.objectStore(STATE).get(libraryId)),
    ]);
    await done;
    const meta = metaResult as MetaRecord | undefined;
    const outbox = outboxResult as OutboxRecord[];
    const state = stateResult as StateRecord | undefined;
    if (!meta) return null;
    return {
      deviceId: meta.deviceId,
      nextSeq: meta.nextSeq,
      outbox: outbox.sort((a, b) => a.seq - b.seq).map((r) => r.op),
      state: state?.state ?? null,
      sync: meta.sync,
    };
  }

  async write(libraryId: string, patch: LocalStorePatch): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([META, OUTBOX, STATE], 'readwrite');
    const done = completed(tx);
    const metaStore = tx.objectStore(META);
    const current = (await promised(metaStore.get(libraryId))) as MetaRecord | undefined;
    const deviceId = patch.deviceId ?? current?.deviceId;
    if (deviceId === undefined) {
      tx.abort();
      await done.catch(() => undefined);
      throw new Error('The first write for a library must set its device ID');
    }
    const meta: MetaRecord = {
      libraryId,
      deviceId,
      nextSeq: patch.nextSeq ?? current?.nextSeq ?? 1,
      sync: patch.sync ?? current?.sync ?? null,
    };
    metaStore.put(meta);
    const outbox = tx.objectStore(OUTBOX);
    if (patch.removeOutboxThrough !== undefined && patch.removeOutboxThrough >= 0) {
      outbox.delete(IDBKeyRange.bound([libraryId, 0], [libraryId, patch.removeOutboxThrough]));
    }
    for (const op of patch.appendOutbox ?? []) {
      const record: OutboxRecord = { libraryId, seq: op.seq, op };
      outbox.put(record);
    }
    if (patch.state) {
      const record: StateRecord = { libraryId, state: patch.state };
      tx.objectStore(STATE).put(record);
    }
    await done;
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'libraryId' });
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: ['libraryId', 'seq'] });
        if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE, { keyPath: 'libraryId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
}
