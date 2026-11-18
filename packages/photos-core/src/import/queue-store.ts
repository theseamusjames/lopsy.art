/**
 * The import queue (spec 6.7, 6.8): what an import job must remember to
 * carry on after a reload. The file content itself is in staging.
 */

import type { Recipe } from '../library/recipe';
import type { AlbumId, AssetId } from '../library/types';
import type { ImportItemState, ImportOptions } from './types';

export interface ImportItemRecord {
  readonly index: number;
  readonly fileName: string;
  readonly byteSize: number;
  readonly lastModified: number;
  /** Chosen when the job starts; carried by the original's tags and previews. */
  readonly plannedAssetId: AssetId;
  readonly sha256: string | null;
  readonly state: ImportItemState;
  readonly assetId: AssetId | null;
  readonly error: string | null;
  /** True once the file's copy is in staging, keyed by `sha256`. */
  readonly staged: boolean;
  /** The pair partner, settled before the file is staged. */
  readonly pairedWith: AssetId | null;
  /** Where the original goes under `Originals/`, once chosen. */
  readonly folderSegments: readonly string[] | null;
  readonly destinationName: string | null;
}

export interface ImportJobRecord {
  readonly id: string;
  readonly libraryId: string;
  /** ISO 8601. */
  readonly createdAt: string;
  readonly options: ImportOptions;
  readonly recipe: Recipe | null;
  readonly keywords: readonly string[] | null;
  readonly albumId: AlbumId | null;
  readonly items: readonly ImportItemRecord[];
}

export interface ImportQueueStore {
  saveJob(job: ImportJobRecord): Promise<void>;
  /** Merges `patch` into one item; no-op when the job or item is gone. */
  updateItem(jobId: string, index: number, patch: Partial<ImportItemRecord>): Promise<void>;
  listJobs(libraryId: string): Promise<ImportJobRecord[]>;
  deleteJob(jobId: string): Promise<void>;
}

function patched(job: ImportJobRecord, index: number, patch: Partial<ImportItemRecord>): ImportJobRecord {
  return { ...job, items: job.items.map((item) => (item.index === index ? { ...item, ...patch, index } : item)) };
}

export class MemoryImportQueueStore implements ImportQueueStore {
  readonly jobs = new Map<string, ImportJobRecord>();

  async saveJob(job: ImportJobRecord): Promise<void> {
    this.jobs.set(job.id, structuredClone(job));
  }

  async updateItem(jobId: string, index: number, patch: Partial<ImportItemRecord>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) this.jobs.set(jobId, patched(job, index, structuredClone(patch)));
  }

  async listJobs(libraryId: string): Promise<ImportJobRecord[]> {
    return [...this.jobs.values()].filter((j) => j.libraryId === libraryId).map((j) => structuredClone(j));
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }
}

const STORE = 'jobs';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Browser-only: one object store of job records. Each item update is one read-write transaction. */
export class IndexedDbImportQueueStore implements ImportQueueStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = 'lopsy-photos-import-queue'): Promise<IndexedDbImportQueueStore> {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('libraryId', 'libraryId');
    };
    return new IndexedDbImportQueueStore(await request(req));
  }

  async saveJob(job: ImportJobRecord): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(job);
    await done(tx);
  }

  async updateItem(jobId: string, index: number, patch: Partial<ImportItemRecord>): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const job = (await request(store.get(jobId))) as ImportJobRecord | undefined;
    if (job) store.put(patched(job, index, patch));
    await done(tx);
  }

  async listJobs(libraryId: string): Promise<ImportJobRecord[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    const jobs = (await request(tx.objectStore(STORE).index('libraryId').getAll(libraryId))) as ImportJobRecord[];
    return jobs;
  }

  async deleteJob(jobId: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(jobId);
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}
