/**
 * Where GoogleDriveAdapter keeps resumable upload sessions between page
 * loads, keyed by WriteOptions.resumeKey (spec 6.5: "session URIs are kept
 * in IndexedDB, so an upload resumes after a reload").
 */

export interface UploadSessionRecord {
  /** Drive's resumable session URI (the Location of the initiation response). */
  readonly sessionUri: string;
  /** The upload's total size; a resume only applies to content of the same size. */
  readonly totalBytes: number;
  /** Bytes Drive confirmed last time. Drive is asked again before resuming. */
  readonly offset: number;
  /** What the session uploads to: 'create', or the ID of the file being updated. */
  readonly target: string;
  /** Milliseconds since the epoch; for pruning old records. */
  readonly updatedAt: number;
}

export interface UploadSessionStore {
  get(key: string): Promise<UploadSessionRecord | null>;
  set(key: string, record: UploadSessionRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryUploadSessionStore implements UploadSessionStore {
  private readonly records = new Map<string, UploadSessionRecord>();

  async get(key: string): Promise<UploadSessionRecord | null> {
    return this.records.get(key) ?? null;
  }

  async set(key: string, record: UploadSessionRecord): Promise<void> {
    this.records.set(key, record);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  get size(): number {
    return this.records.size;
  }
}

function isRecord(value: unknown): value is UploadSessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'sessionUri') === 'string' &&
    typeof Reflect.get(value, 'totalBytes') === 'number' &&
    typeof Reflect.get(value, 'offset') === 'number' &&
    typeof Reflect.get(value, 'target') === 'string' &&
    typeof Reflect.get(value, 'updatedAt') === 'number'
  );
}

/** Plain IndexedDB, one object store. Browser only. Partition by account by giving each its own database name. */
export class IndexedDbUploadSessionStore implements UploadSessionStore {
  private db: Promise<IDBDatabase> | null = null;
  private static readonly STORE = 'sessions';

  constructor(private readonly databaseName: string = 'lopsy-photos-upload-sessions') {}

  async get(key: string): Promise<UploadSessionRecord | null> {
    const value = await this.run('readonly', (store) => store.get(key));
    return isRecord(value) ? value : null;
  }

  async set(key: string, record: UploadSessionRecord): Promise<void> {
    await this.run('readwrite', (store) => store.put(record, key));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(IndexedDbUploadSessionStore.STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.db = null;
          reject(request.error ?? new Error('Could not open IndexedDB'));
        };
      });
    }
    return this.db;
  }

  private async run(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IndexedDbUploadSessionStore.STORE, mode);
      const request = action(transaction.objectStore(IndexedDbUploadSessionStore.STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
}
