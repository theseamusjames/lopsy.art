/**
 * A minimal in-memory StorageAdapter for import tests, with hooks to make
 * uploads fail, report a wrong checksum or hang until aborted. The real
 * memory adapter lives under storage/; this one exists so import tests do
 * not depend on it.
 */

import { StorageError } from '../../storage/errors';
import type { ChangePage, FileId, NewFile, StorageAdapter, StorageQuota, StoredFile, WriteOptions } from '../../storage/types';
import { sha256Hex } from '../hash';

interface Entry {
  file: StoredFile;
  content: Blob;
}

export interface TestAdapterHooks {
  /** Throw this from createFile for matching files. */
  failCreate?: (file: NewFile) => StorageError | null;
  /** Report this checksum instead of the real one. */
  reportSha?: (file: NewFile, real: string) => string | null;
  /** Wait for this before finishing createFile (aborts reject at once). */
  createDelay?: (file: NewFile) => Promise<void> | null;
}

export class TestMemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly label = 'Test memory';
  readonly files = new Map<FileId, Entry>();
  hooks: TestAdapterHooks = {};
  createFolderCalls = 0;
  private nextId = 1;
  private readonly rootId: FileId;

  constructor() {
    this.rootId = this.put({ name: 'root', parentId: null, isFolder: true, mimeType: 'application/vnd.folder' }, new Blob([]), null);
  }

  private put(
    fields: { name: string; parentId: FileId | null; isFolder: boolean; mimeType: string; properties?: Readonly<Record<string, string>> },
    content: Blob,
    sha256: string | null,
  ): FileId {
    const id = `f${this.nextId++}`;
    this.files.set(id, {
      content,
      file: {
        id,
        name: fields.name,
        parentId: fields.parentId,
        isFolder: fields.isFolder,
        size: content.size,
        mimeType: fields.mimeType,
        modifiedTime: new Date(0).toISOString(),
        sha256,
        revision: '1',
        properties: { ...(fields.properties ?? {}) },
        trashed: false,
      },
    });
    return id;
  }

  private entry(id: FileId): Entry {
    const e = this.files.get(id);
    if (!e) throw new StorageError('not-found', `No file ${id}`);
    return e;
  }

  /** Non-trashed, non-folder files under `parentId`. */
  filesIn(parentId: FileId): StoredFile[] {
    return [...this.files.values()].map((e) => e.file).filter((f) => f.parentId === parentId && !f.trashed && !f.isFolder);
  }

  async getRoot(): Promise<StoredFile> {
    return this.entry(this.rootId).file;
  }

  async createFolder(parentId: FileId, name: string, properties?: Readonly<Record<string, string>>): Promise<StoredFile> {
    this.entry(parentId);
    this.createFolderCalls++;
    const id = this.put({ name, parentId, isFolder: true, mimeType: 'application/vnd.folder', properties }, new Blob([]), null);
    return this.entry(id).file;
  }

  async createFile(file: NewFile, content: Blob, options?: WriteOptions): Promise<StoredFile> {
    this.entry(file.parentId);
    const signal = options?.signal;
    const aborted = () => new StorageError('aborted', 'Upload cancelled');
    if (signal?.aborted) throw aborted();
    const failure = this.hooks.failCreate?.(file);
    if (failure) throw failure;
    options?.onProgress?.(Math.floor(content.size / 2), content.size);
    const delay = this.hooks.createDelay?.(file);
    if (delay) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(aborted());
        signal?.addEventListener('abort', onAbort, { once: true });
        delay.then(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, reject);
      });
    }
    if (signal?.aborted) throw aborted();
    options?.onProgress?.(content.size, content.size);
    const real = await sha256Hex(content);
    const sha = this.hooks.reportSha?.(file, real) ?? real;
    const id = this.put({ ...file, isFolder: false }, content, sha);
    return this.entry(id).file;
  }

  async updateContent(id: FileId, content: Blob): Promise<StoredFile> {
    const e = this.entry(id);
    e.content = content;
    e.file = { ...e.file, size: content.size, sha256: await sha256Hex(content), revision: String(Number(e.file.revision) + 1) };
    return e.file;
  }

  async updateProperties(id: FileId, properties: Readonly<Record<string, string | null>>): Promise<StoredFile> {
    const e = this.entry(id);
    const next: Record<string, string> = { ...e.file.properties };
    for (const [k, v] of Object.entries(properties)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    e.file = { ...e.file, properties: next };
    return e.file;
  }

  async move(id: FileId, newParentId: FileId): Promise<StoredFile> {
    const e = this.entry(id);
    e.file = { ...e.file, parentId: newParentId };
    return e.file;
  }

  async getFile(id: FileId): Promise<StoredFile | null> {
    return this.files.get(id)?.file ?? null;
  }

  async readContent(id: FileId): Promise<Blob> {
    return this.entry(id).content;
  }

  async listChildren(parentId: FileId): Promise<StoredFile[]> {
    return [...this.files.values()].map((e) => e.file).filter((f) => f.parentId === parentId && !f.trashed);
  }

  async findByProperty(key: string, value: string): Promise<StoredFile[]> {
    return [...this.files.values()].map((e) => e.file).filter((f) => !f.trashed && f.properties[key] === value);
  }

  async trash(id: FileId): Promise<void> {
    const e = this.entry(id);
    e.file = { ...e.file, trashed: true };
  }

  async untrash(id: FileId): Promise<void> {
    const e = this.entry(id);
    e.file = { ...e.file, trashed: false };
  }

  async deletePermanently(id: FileId): Promise<void> {
    this.files.delete(id);
  }

  async getChangeCursor(): Promise<string> {
    return '0';
  }

  async listChanges(cursor: string): Promise<ChangePage> {
    return { changes: [], cursor, hasMore: false };
  }

  async getQuota(): Promise<StorageQuota> {
    return { usedBytes: 0, limitBytes: null };
  }
}
