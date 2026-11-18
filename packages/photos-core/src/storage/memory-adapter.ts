/**
 * A complete StorageAdapter held in memory, for unit tests and for running
 * the app with nothing to sign in to. It follows Drive's semantics where
 * they matter to callers: opaque IDs, duplicate names allowed, trashed
 * files hidden from listings but still readable, a cursor-based change feed.
 */

import { sha256Hex } from './content-hash';
import { StorageError } from './errors';
import { FileIndex, FOLDER_MIME_TYPE, type IndexEntry } from './file-index';
import { applyPropertyPatch, validateProperties } from './properties';
import { realSleep, throwIfAborted } from './signals';
import type {
  ChangePage,
  FileId,
  NewFile,
  ReadOptions,
  StorageAdapter,
  StorageQuota,
  StoredFile,
  WriteOptions,
} from './types';

export type StorageMethod = Exclude<keyof StorageAdapter, 'kind' | 'label'>;

export interface MemoryAdapterOptions {
  readonly label?: string;
  /** Total bytes the store may hold; writes past it throw 'quota-exceeded'. Unlimited when absent. */
  readonly quotaBytes?: number;
  /** Delay before every call, to surface races and loading states. */
  readonly latencyMs?: number;
  /** Changes per `listChanges` page. */
  readonly changePageSize?: number;
  readonly now?: () => Date;
}

export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly label: string;

  private readonly index: FileIndex;
  private readonly contents = new Map<FileId, Blob>();
  private readonly quotaBytes: number | null;
  private readonly changePageSize: number;
  private latencyMs: number;
  private readonly failures = new Map<StorageMethod, StorageError[]>();
  private readonly calls = new Map<StorageMethod, number>();

  constructor(options: MemoryAdapterOptions = {}) {
    this.label = options.label ?? 'Memory';
    this.index = FileIndex.create('Memory', options.now);
    this.quotaBytes = options.quotaBytes ?? null;
    this.changePageSize = options.changePageSize ?? 1000;
    this.latencyMs = options.latencyMs ?? 0;
  }

  /** Makes the next call of `method` throw `error` (a retryable 'unknown' error by default). Queues if called repeatedly. */
  failNext(method: StorageMethod, error: StorageError = new StorageError('unknown', `Injected failure in ${method}`)): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(error);
    this.failures.set(method, queue);
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  /** How many times `method` was called, failures included. */
  callCount(method: StorageMethod): number {
    return this.calls.get(method) ?? 0;
  }

  async getRoot(): Promise<StoredFile> {
    await this.enter('getRoot');
    return this.index.toStored(this.index.require(this.index.rootId));
  }

  async createFolder(
    parentId: FileId,
    name: string,
    properties: Readonly<Record<string, string>> = {},
  ): Promise<StoredFile> {
    await this.enter('createFolder');
    validateProperties(properties);
    const entry = this.index.add({
      name,
      parentId,
      isFolder: true,
      size: 0,
      mimeType: FOLDER_MIME_TYPE,
      sha256: null,
      properties: { ...properties },
    });
    return this.index.toStored(entry);
  }

  async createFile(file: NewFile, content: Blob, options: WriteOptions = {}): Promise<StoredFile> {
    await this.enter('createFile', options.signal);
    const properties = { ...(file.properties ?? {}) };
    validateProperties(properties);
    this.index.requireFolder(file.parentId);
    this.checkQuota(content.size);
    const sha256 = await sha256Hex(content);
    throwIfAborted(options.signal);
    options.onProgress?.(0, content.size);
    const entry = this.index.add({
      name: file.name,
      parentId: file.parentId,
      isFolder: false,
      size: content.size,
      mimeType: file.mimeType,
      sha256,
      properties,
    });
    this.contents.set(entry.id, content.slice(0, content.size, file.mimeType));
    options.onProgress?.(content.size, content.size);
    return this.index.toStored(entry);
  }

  async updateContent(id: FileId, content: Blob, options: WriteOptions = {}): Promise<StoredFile> {
    await this.enter('updateContent', options.signal);
    const entry = this.index.requireFile(id);
    this.checkQuota(content.size - entry.size);
    const sha256 = await sha256Hex(content);
    throwIfAborted(options.signal);
    options.onProgress?.(0, content.size);
    this.contents.set(id, content.slice(0, content.size, entry.mimeType));
    entry.size = content.size;
    entry.sha256 = sha256;
    this.index.touch(entry, true);
    options.onProgress?.(content.size, content.size);
    return this.index.toStored(entry);
  }

  async updateProperties(id: FileId, properties: Readonly<Record<string, string | null>>): Promise<StoredFile> {
    await this.enter('updateProperties');
    const entry = this.index.require(id);
    entry.properties = applyPropertyPatch(entry.properties, properties);
    this.index.touch(entry, false);
    return this.index.toStored(entry);
  }

  async move(id: FileId, newParentId: FileId): Promise<StoredFile> {
    await this.enter('move');
    const entry = this.index.require(id);
    this.index.requireFolder(newParentId);
    if (this.index.subtree(id).some((item) => item.id === newParentId)) {
      throw new StorageError('invalid', 'A folder cannot be moved into itself');
    }
    entry.parentId = newParentId;
    this.index.touch(entry, false);
    return this.index.toStored(entry);
  }

  async getFile(id: FileId): Promise<StoredFile | null> {
    await this.enter('getFile');
    const entry = this.index.get(id);
    return entry ? this.index.toStored(entry) : null;
  }

  async readContent(id: FileId, options: ReadOptions = {}): Promise<Blob> {
    await this.enter('readContent', options.signal);
    const entry = this.index.requireFile(id);
    const content = this.contents.get(id) ?? new Blob([]);
    if (!options.range) return content;
    return content.slice(options.range.start, Math.max(options.range.start, options.range.end), entry.mimeType);
  }

  async listChildren(parentId: FileId): Promise<StoredFile[]> {
    await this.enter('listChildren');
    this.index.requireFolder(parentId);
    return this.index
      .children(parentId)
      .filter((entry) => !this.index.isTrashed(entry))
      .map((entry) => this.index.toStored(entry));
  }

  async findByProperty(key: string, value: string): Promise<StoredFile[]> {
    await this.enter('findByProperty');
    return this.index.findByProperty(key, value).map((entry) => this.index.toStored(entry));
  }

  async trash(id: FileId): Promise<void> {
    await this.enter('trash');
    this.setTrashed(this.index.require(id), true);
  }

  async untrash(id: FileId): Promise<void> {
    await this.enter('untrash');
    this.setTrashed(this.index.require(id), false);
  }

  async deletePermanently(id: FileId): Promise<void> {
    await this.enter('deletePermanently');
    if (id === this.index.rootId) throw new StorageError('invalid', 'The root cannot be deleted');
    for (const entry of this.index.remove(id)) this.contents.delete(entry.id);
  }

  async getChangeCursor(): Promise<string> {
    await this.enter('getChangeCursor');
    return String(this.index.cursor);
  }

  async listChanges(cursor: string): Promise<ChangePage> {
    await this.enter('listChanges');
    return this.index.changesSince(cursor, this.changePageSize);
  }

  async getQuota(): Promise<StorageQuota> {
    await this.enter('getQuota');
    return { usedBytes: this.index.usedBytes(), limitBytes: this.quotaBytes };
  }

  private async enter(method: StorageMethod, signal?: AbortSignal): Promise<void> {
    this.calls.set(method, this.callCount(method) + 1);
    throwIfAborted(signal);
    if (this.latencyMs > 0) await realSleep(this.latencyMs);
    throwIfAborted(signal);
    const failure = this.failures.get(method)?.shift();
    if (failure) throw failure;
  }

  private checkQuota(addedBytes: number): void {
    if (this.quotaBytes !== null && this.index.usedBytes() + addedBytes > this.quotaBytes) {
      throw new StorageError('quota-exceeded', 'The storage is full');
    }
  }

  private setTrashed(entry: IndexEntry, trashed: boolean): void {
    if (entry.id === this.index.rootId) throw new StorageError('invalid', 'The root cannot be trashed');
    if (entry.explicitlyTrashed === trashed) return;
    entry.explicitlyTrashed = trashed;
    this.index.touch(entry, false);
    for (const descendant of this.index.subtree(entry.id)) {
      if (descendant !== entry) this.index.mark(descendant);
    }
  }
}
