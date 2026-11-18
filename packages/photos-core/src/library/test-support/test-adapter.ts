/**
 * A small in-memory StorageAdapter for the library's tests. It keeps the
 * properties of the real backends that the library relies on: opaque IDs,
 * whole-content writes (no append), trashed files hidden from listings and
 * property search, and no checksum for content it was not asked to hash.
 */

import { StorageError, type StorageErrorCode } from '../../storage/errors';
import type {
  ChangePage,
  FileId,
  NewFile,
  StorageAdapter,
  StorageKind,
  StorageQuota,
  StoredFile,
} from '../../storage/types';

interface Entry {
  file: StoredFile;
  content: Uint8Array;
}

export class TestAdapter implements StorageAdapter {
  readonly kind: StorageKind = 'memory';
  readonly label = 'Test storage';
  private readonly files = new Map<FileId, Entry>();
  private readonly rootId: FileId;
  private counter = 0;
  private failures: { code: StorageErrorCode; method: string | null; remaining: number }[] = [];
  /** Every call, by method name, for assertions. */
  readonly calls: string[] = [];

  constructor() {
    this.rootId = this.nextId();
    this.files.set(this.rootId, { file: this.makeFile(this.rootId, 'root', null, true, '', {}, 0), content: new Uint8Array() });
  }

  /** Makes the next `count` calls (of `method`, or of any method) throw a StorageError. */
  failNext(code: StorageErrorCode, options: { method?: string; count?: number } = {}): void {
    this.failures.push({ code, method: options.method ?? null, remaining: options.count ?? 1 });
  }

  /** Drops failures queued with `failNext` that have not fired yet. */
  clearFailures(): void {
    this.failures = [];
  }

  /** Every file and folder, trashed or not. */
  allFiles(): StoredFile[] {
    return [...this.files.values()].map((e) => e.file);
  }

  async getRoot(): Promise<StoredFile> {
    this.enter('getRoot');
    return this.must(this.rootId).file;
  }

  async createFolder(parentId: FileId, name: string, properties: Readonly<Record<string, string>> = {}): Promise<StoredFile> {
    this.enter('createFolder');
    this.mustFolder(parentId);
    const id = this.nextId();
    const file = this.makeFile(id, name, parentId, true, 'application/vnd.google-apps.folder', properties, 0);
    this.files.set(id, { file, content: new Uint8Array() });
    return file;
  }

  async createFile(file: NewFile, content: Blob): Promise<StoredFile> {
    this.enter('createFile');
    this.mustFolder(file.parentId);
    const bytes = new Uint8Array(await content.arrayBuffer());
    const id = this.nextId();
    const stored = this.makeFile(id, file.name, file.parentId, false, file.mimeType, file.properties ?? {}, bytes.byteLength);
    this.files.set(id, { file: stored, content: bytes });
    return stored;
  }

  async updateContent(id: FileId, content: Blob): Promise<StoredFile> {
    this.enter('updateContent');
    const entry = this.must(id);
    const bytes = new Uint8Array(await content.arrayBuffer());
    entry.content = bytes;
    entry.file = { ...entry.file, size: bytes.byteLength, revision: this.nextId(), modifiedTime: new Date().toISOString() };
    return entry.file;
  }

  async updateProperties(id: FileId, properties: Readonly<Record<string, string | null>>): Promise<StoredFile> {
    this.enter('updateProperties');
    const entry = this.must(id);
    const next: Record<string, string> = { ...entry.file.properties };
    for (const [k, v] of Object.entries(properties)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    entry.file = { ...entry.file, properties: next };
    return entry.file;
  }

  async move(id: FileId, newParentId: FileId): Promise<StoredFile> {
    this.enter('move');
    this.mustFolder(newParentId);
    const entry = this.must(id);
    entry.file = { ...entry.file, parentId: newParentId };
    return entry.file;
  }

  async getFile(id: FileId): Promise<StoredFile | null> {
    this.enter('getFile');
    return this.files.get(id)?.file ?? null;
  }

  async readContent(id: FileId): Promise<Blob> {
    this.enter('readContent');
    const entry = this.must(id);
    return new Blob([entry.content.slice()]);
  }

  async listChildren(parentId: FileId): Promise<StoredFile[]> {
    this.enter('listChildren');
    this.mustFolder(parentId);
    return [...this.files.values()].map((e) => e.file).filter((f) => f.parentId === parentId && !f.trashed);
  }

  async findByProperty(key: string, value: string): Promise<StoredFile[]> {
    this.enter('findByProperty');
    return [...this.files.values()].map((e) => e.file).filter((f) => !f.trashed && f.properties[key] === value);
  }

  async trash(id: FileId): Promise<void> {
    this.enter('trash');
    const entry = this.must(id);
    entry.file = { ...entry.file, trashed: true };
  }

  async untrash(id: FileId): Promise<void> {
    this.enter('untrash');
    const entry = this.must(id);
    entry.file = { ...entry.file, trashed: false };
  }

  async deletePermanently(id: FileId): Promise<void> {
    this.enter('deletePermanently');
    this.must(id);
    this.files.delete(id);
  }

  async getChangeCursor(): Promise<string> {
    this.enter('getChangeCursor');
    return '0';
  }

  async listChanges(cursor: string): Promise<ChangePage> {
    this.enter('listChanges');
    return { changes: [], cursor, hasMore: false };
  }

  async getQuota(): Promise<StorageQuota> {
    this.enter('getQuota');
    return { usedBytes: 0, limitBytes: null };
  }

  private enter(method: string): void {
    this.calls.push(method);
    const failure = this.failures.find((f) => f.method === null || f.method === method);
    if (!failure) return;
    failure.remaining -= 1;
    if (failure.remaining <= 0) this.failures = this.failures.filter((f) => f !== failure);
    throw new StorageError(failure.code, `Injected ${failure.code} failure in ${method}`);
  }

  private nextId(): FileId {
    this.counter += 1;
    // Opaque on purpose: nothing about a file can be read from its ID.
    return `f${(this.counter * 2654435761 >>> 0).toString(36)}${this.counter.toString(36)}`;
  }

  private must(id: FileId): Entry {
    const entry = this.files.get(id);
    if (!entry) throw new StorageError('not-found', `No file ${id}`);
    return entry;
  }

  private mustFolder(id: FileId): Entry {
    const entry = this.must(id);
    if (!entry.file.isFolder) throw new StorageError('invalid', `${id} is not a folder`);
    return entry;
  }

  private makeFile(
    id: FileId,
    name: string,
    parentId: FileId | null,
    isFolder: boolean,
    mimeType: string,
    properties: Readonly<Record<string, string>>,
    size: number,
  ): StoredFile {
    return {
      id,
      name,
      parentId,
      isFolder,
      size,
      mimeType,
      modifiedTime: new Date().toISOString(),
      sha256: null,
      revision: this.nextId(),
      properties: { ...properties },
      trashed: false,
    };
  }
}
