/**
 * A StorageAdapter over a File System Access directory: the browser's
 * private file system (kind 'browser') or a folder the user picked
 * (kind 'local-folder'). Files are real files in a folder tree that
 * mirrors the logical one, so a picked folder looks like the Drive library
 * on disk. What a file system cannot hold (IDs, properties, revisions,
 * checksums, trashed state, the change feed) lives in a hidden index file
 * at the root. Trashed entries move into a hidden trash folder.
 *
 * One instance owns the folder: every operation runs under one mutex, so
 * concurrent calls from this tab cannot corrupt the index. Two tabs (or
 * two instances) on one folder are not coordinated.
 */

import { sha256Hex } from './content-hash';
import { isStorageError, StorageError } from './errors';
import { FileIndex, FOLDER_MIME_TYPE, type IndexEntry } from './file-index';
import { Mutex } from './mutex';
import { applyPropertyPatch, validateProperties } from './properties';
import { throwIfAborted } from './signals';
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

/** The parts of FileSystemWritableFileStream this adapter uses. */
export interface WritableHandle {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

/** The parts of FileSystemFileHandle this adapter uses. */
export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableHandle>;
}

/** The parts of FileSystemDirectoryHandle this adapter uses; the browser's handle satisfies it. */
export interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export const INDEX_FILE_NAME = '.lopsy-storage.json';
export const TRASH_FOLDER_NAME = '.lopsy-trash';
const RESERVED_ROOT_NAMES = new Set([INDEX_FILE_NAME, TRASH_FOLDER_NAME].map((name) => name.toLowerCase()));

export interface LocalFolderAdapterOptions {
  readonly kind: 'browser' | 'local-folder';
  readonly label: string;
  /** Reports the origin's storage use and limit (navigator.storage.estimate); without it the limit is unknown. */
  readonly estimate?: () => Promise<{ usage?: number; quota?: number }>;
  readonly changePageSize?: number;
  readonly now?: () => Date;
}

export class LocalFolderAdapter implements StorageAdapter {
  readonly kind: 'browser' | 'local-folder';
  readonly label: string;

  private readonly mutex = new Mutex();
  private readonly changePageSize: number;
  private readonly estimate: LocalFolderAdapterOptions['estimate'];

  private constructor(
    private readonly rootHandle: DirectoryHandle,
    private readonly index: FileIndex,
    options: LocalFolderAdapterOptions,
  ) {
    this.kind = options.kind;
    this.label = options.label;
    this.changePageSize = options.changePageSize ?? 1000;
    this.estimate = options.estimate;
  }

  /** Opens the folder, reading its index or starting a new one. */
  static async open(handle: DirectoryHandle, options: LocalFolderAdapterOptions): Promise<LocalFolderAdapter> {
    return withFsErrors(async () => {
      const now = options.now ?? (() => new Date());
      const existing = await readIndex(handle);
      const index =
        existing === null
          ? FileIndex.create(handle.name, now)
          : FileIndex.load(existing, {
              now,
              disk: { nameOf: diskNameOf, isSafe: isSafeDiskName, reservedAtRoot: RESERVED_ROOT_NAMES },
            });
      if (index.repairs.length > 0) console.warn('The storage index was damaged and has been repaired', index.repairs);
      const adapter = new LocalFolderAdapter(handle, index, options);
      if (existing === null || index.repairs.length > 0) await adapter.saveIndex();
      return adapter;
    });
  }

  getRoot(): Promise<StoredFile> {
    return this.locked(async () => this.index.toStored(this.index.require(this.index.rootId)));
  }

  createFolder(parentId: FileId, name: string, properties: Readonly<Record<string, string>> = {}): Promise<StoredFile> {
    return this.locked(async () => {
      validateProperties(properties);
      const parent = this.index.requireFolder(parentId);
      const dir = await this.dirOf(parent, true);
      const diskName = await this.uniqueDiskName(parent, name, null, dir);
      await dir.getDirectoryHandle(diskName, { create: true });
      const entry = this.index.add({
        name,
        parentId,
        isFolder: true,
        size: 0,
        mimeType: FOLDER_MIME_TYPE,
        sha256: null,
        properties: { ...properties },
        diskName,
      });
      await this.saveIndex();
      return this.index.toStored(entry);
    });
  }

  createFile(file: NewFile, content: Blob, options: WriteOptions = {}): Promise<StoredFile> {
    return this.locked(async () => {
      throwIfAborted(options.signal);
      const properties = { ...(file.properties ?? {}) };
      validateProperties(properties);
      const parent = this.index.requireFolder(file.parentId);
      await this.checkQuota(content.size);
      const sha256 = await sha256Hex(content);
      throwIfAborted(options.signal);
      const dir = await this.dirOf(parent, true);
      const diskName = await this.uniqueDiskName(parent, file.name, null, dir);
      options.onProgress?.(0, content.size);
      await writeFile(dir, diskName, content, options.signal);
      const entry = this.index.add({
        name: file.name,
        parentId: file.parentId,
        isFolder: false,
        size: content.size,
        mimeType: file.mimeType,
        sha256,
        properties,
        diskName,
      });
      try {
        await this.saveIndex();
      } catch (error) {
        // The saved index never named the file: drop it rather than leave bytes nothing points at.
        this.index.forget(entry.id);
        await ignoreNotFound(dir.removeEntry(diskName)).catch(() => undefined);
        throw error;
      }
      options.onProgress?.(content.size, content.size);
      return this.index.toStored(entry);
    });
  }

  updateContent(id: FileId, content: Blob, options: WriteOptions = {}): Promise<StoredFile> {
    return this.locked(async () => {
      throwIfAborted(options.signal);
      const entry = this.index.requireFile(id);
      await this.checkQuota(content.size - entry.size);
      const sha256 = await sha256Hex(content);
      throwIfAborted(options.signal);
      options.onProgress?.(0, content.size);
      const path = this.pathOf(entry);
      await writeFile(await this.dirAt(path.slice(0, -1), true), path[path.length - 1] ?? diskNameOf(entry), content, options.signal);
      entry.size = content.size;
      entry.sha256 = sha256;
      this.index.touch(entry, true);
      await this.saveIndex();
      options.onProgress?.(content.size, content.size);
      return this.index.toStored(entry);
    });
  }

  updateProperties(id: FileId, properties: Readonly<Record<string, string | null>>): Promise<StoredFile> {
    return this.locked(async () => {
      const entry = this.index.require(id);
      entry.properties = applyPropertyPatch(entry.properties, properties);
      this.index.touch(entry, false);
      await this.saveIndex();
      return this.index.toStored(entry);
    });
  }

  move(id: FileId, newParentId: FileId): Promise<StoredFile> {
    return this.locked(async () => {
      const entry = this.index.require(id);
      const parent = this.index.requireFolder(newParentId);
      if (entry.id === this.index.rootId) throw new StorageError('invalid', 'The root cannot be moved');
      if (this.index.subtree(id).some((item) => item.id === newParentId)) {
        throw new StorageError('invalid', 'A folder cannot be moved into itself');
      }
      if (entry.parentId === newParentId) return this.index.toStored(entry);
      await this.relocate(
        entry,
        async () => {
          entry.parentId = newParentId;
          if (!entry.explicitlyTrashed) {
            entry.diskName = await this.uniqueDiskName(parent, entry.name, entry, await this.dirOf(parent, true));
          }
        },
        () => this.index.touch(entry, false),
      );
      return this.index.toStored(entry);
    });
  }

  getFile(id: FileId): Promise<StoredFile | null> {
    return this.locked(async () => {
      const entry = this.index.get(id);
      return entry ? this.index.toStored(entry) : null;
    });
  }

  readContent(id: FileId, options: ReadOptions = {}): Promise<Blob> {
    return this.locked(async () => {
      throwIfAborted(options.signal);
      const entry = this.index.requireFile(id);
      const path = this.pathOf(entry);
      const dir = await this.dirAt(path.slice(0, -1), false);
      const file = await (await dir.getFileHandle(path[path.length - 1] ?? diskNameOf(entry))).getFile();
      const blob = file.slice(0, file.size, entry.mimeType);
      const result = options.range
        ? blob.slice(options.range.start, Math.max(options.range.start, options.range.end), entry.mimeType)
        : blob;
      options.onProgress?.(result.size, result.size);
      return result;
    });
  }

  listChildren(parentId: FileId): Promise<StoredFile[]> {
    return this.locked(async () => {
      this.index.requireFolder(parentId);
      return this.index
        .children(parentId)
        .filter((entry) => !this.index.isTrashed(entry))
        .map((entry) => this.index.toStored(entry));
    });
  }

  findByProperty(key: string, value: string): Promise<StoredFile[]> {
    return this.locked(async () => this.index.findByProperty(key, value).map((entry) => this.index.toStored(entry)));
  }

  trash(id: FileId): Promise<void> {
    return this.locked(() => this.setTrashed(id, true));
  }

  untrash(id: FileId): Promise<void> {
    return this.locked(() => this.setTrashed(id, false));
  }

  deletePermanently(id: FileId): Promise<void> {
    return this.locked(async () => {
      const entry = this.index.require(id);
      if (entry.id === this.index.rootId) throw new StorageError('invalid', 'The root cannot be deleted');
      // Where its bytes are, read before the index forgets the subtree.
      const files = this.index.subtree(id).filter((item) => !item.isFolder).map((item) => this.pathOf(item));
      const folders = this.index
        .subtree(id)
        .filter((item) => item.isFolder)
        .map((item) => this.pathOf(item))
        .sort((a, b) => b.length - a.length);
      this.index.remove(id);
      // The index first: a failure after this leaves stray bytes, never an entry whose bytes are gone.
      await this.saveIndex();
      for (const path of files) {
        await this.removeAt(path).catch((error: unknown) => console.warn('Could not remove', path.join('/'), error));
      }
      for (const path of folders) {
        await this.dirAt(path.slice(0, -1), false)
          .then((dir) => removeIfEmpty(dir, path[path.length - 1] ?? ''))
          .catch(() => undefined);
      }
    });
  }

  getChangeCursor(): Promise<string> {
    return this.locked(async () => String(this.index.cursor));
  }

  listChanges(cursor: string): Promise<ChangePage> {
    return this.locked(async () => this.index.changesSince(cursor, this.changePageSize));
  }

  getQuota(): Promise<StorageQuota> {
    return this.locked(async () => {
      const usedBytes = this.index.usedBytes();
      if (!this.estimate) return { usedBytes, limitBytes: null };
      const estimate = await this.estimate();
      return { usedBytes, limitBytes: estimate.quota ?? null };
    });
  }

  private locked<T>(task: () => Promise<T>): Promise<T> {
    return this.mutex.run(() => withFsErrors(task));
  }

  private async saveIndex(): Promise<void> {
    const json = JSON.stringify(this.index.toJSON());
    await writeFile(this.rootHandle, INDEX_FILE_NAME, new Blob([json], { type: 'application/json' }), undefined);
  }

  private async checkQuota(addedBytes: number): Promise<void> {
    if (!this.estimate || addedBytes <= 0) return;
    const { usage, quota } = await this.estimate();
    if (usage !== undefined && quota !== undefined && usage + addedBytes > quota) {
      throw new StorageError('quota-exceeded', 'The browser storage is full');
    }
  }

  /**
   * Disk path segments from the root to the entry. An entry that is, or is
   * inside, an explicitly trashed one lives under the trash folder, keyed by
   * the trashed entry's ID so names never collide there.
   */
  private pathOf(entry: IndexEntry): string[] {
    const segments: string[] = [];
    for (const current of this.index.ancestry(entry)) {
      if (current.id === this.index.rootId) break;
      if (current.explicitlyTrashed) {
        segments.unshift(TRASH_FOLDER_NAME, current.id);
        return segments;
      }
      segments.unshift(diskNameOf(current));
    }
    return segments;
  }

  private async dirOf(folder: IndexEntry, create: boolean): Promise<DirectoryHandle> {
    return this.dirAt(this.pathOf(folder), create);
  }

  private async dirAt(segments: readonly string[], create: boolean): Promise<DirectoryHandle> {
    let dir = this.rootHandle;
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create });
    return dir;
  }

  /**
   * A name for `name` in `parent` that no other present child uses, ignoring
   * case, and that nothing in the folder on disk (`dir`) has either: a
   * picked folder can hold files the index does not know (a lost index, a
   * restored backup), and those are never overwritten.
   */
  private async uniqueDiskName(parent: IndexEntry, name: string, self: IndexEntry | null, dir: DirectoryHandle): Promise<string> {
    const taken = new Set(
      this.index
        .children(parent.id)
        .filter((child) => child !== self && !child.explicitlyTrashed)
        .map((child) => diskNameOf(child).toLowerCase()),
    );
    if (parent.id === this.index.rootId) for (const reserved of RESERVED_ROOT_NAMES) taken.add(reserved);
    const safe = safeFileName(name);
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : '';
    let candidate = safe;
    for (let n = 2; taken.has(candidate.toLowerCase()) || (await existsOnDisk(dir, candidate)); n++) {
      candidate = `${stem} (${n})${extension}`;
    }
    return candidate;
  }

  private async setTrashed(id: FileId, trashed: boolean): Promise<void> {
    const entry = this.index.require(id);
    if (entry.id === this.index.rootId) throw new StorageError('invalid', 'The root cannot be trashed');
    if (entry.explicitlyTrashed === trashed) return;
    await this.relocate(
      entry,
      async () => {
        entry.explicitlyTrashed = trashed;
        if (!trashed && entry.parentId !== null) {
          const parent = this.index.require(entry.parentId);
          entry.diskName = await this.uniqueDiskName(parent, entry.name, entry, await this.dirOf(parent, true));
        }
      },
      () => {
        this.index.touch(entry, false);
        for (const descendant of this.index.subtree(entry.id)) {
          if (descendant !== entry) this.index.mark(descendant);
        }
      },
    );
  }

  /**
   * Applies `change` to an entry's place (parent, disk name, trashed),
   * moves its bytes there and saves the index, in the one order that never
   * leaves the index pointing where the bytes are not: copy to the new
   * place (FileSystemHandle.move is not available everywhere), save the
   * index, then remove the old copy. If the copy or the index save fails
   * (a full disk: copying needs the space twice), the new copy is removed
   * and the entry is put back as it was, so the saved index still points
   * at the old copy, which is untouched. Only entries the index knows are
   * copied and removed, so files the user added by hand are never deleted.
   * `record` notes the change in the index (seq, modifiedTime) before the save.
   */
  private async relocate(entry: IndexEntry, change: () => Promise<void>, record: () => void): Promise<void> {
    const before = { parentId: entry.parentId, diskName: entry.diskName, explicitlyTrashed: entry.explicitlyTrashed };
    const restore = (): void => {
      entry.parentId = before.parentId;
      entry.explicitlyTrashed = before.explicitlyTrashed;
      if (before.diskName === undefined) delete entry.diskName;
      else entry.diskName = before.diskName;
    };
    const from = this.pathOf(entry);
    try {
      await change();
    } catch (error) {
      restore();
      throw error;
    }
    const to = this.pathOf(entry);
    const moves = from.join('/') !== to.join('/');
    const fromName = from[from.length - 1] ?? '';
    const toName = to[to.length - 1] ?? '';
    let fromDir: DirectoryHandle | null = null;
    let toDir: DirectoryHandle | null = null;
    try {
      if (moves) {
        fromDir = await this.dirAt(from.slice(0, -1), false);
        toDir = await this.dirAt(to.slice(0, -1), true);
        await this.copyKnown(fromDir, fromName, toDir, toName, entry);
      }
      record();
      await this.saveIndex();
    } catch (error) {
      if (toDir) await this.removeKnownAt(toDir, toName, entry).catch(() => undefined);
      restore();
      throw error;
    }
    if (!fromDir) return;
    try {
      await this.removeKnownAt(fromDir, fromName, entry);
    } catch (error) {
      // The bytes are safe at their new place, which the saved index names; a leftover copy only takes a name, which new files avoid.
      console.warn('Could not remove the old copy after moving', fromName, error);
    }
  }

  private async copyKnown(
    fromDir: DirectoryHandle,
    fromName: string,
    toDir: DirectoryHandle,
    toName: string,
    entry: IndexEntry,
  ): Promise<void> {
    if (!entry.isFolder) {
      const file = await (await fromDir.getFileHandle(fromName)).getFile();
      await writeFile(toDir, toName, file, undefined);
      return;
    }
    const source = await fromDir.getDirectoryHandle(fromName);
    const target = await toDir.getDirectoryHandle(toName, { create: true });
    for (const child of this.index.children(entry.id)) {
      if (child.explicitlyTrashed) continue;
      await this.copyKnown(source, diskNameOf(child), target, diskNameOf(child), child);
    }
  }

  private async removeAt(path: readonly string[]): Promise<void> {
    const dir = await this.dirAt(path.slice(0, -1), false);
    await ignoreNotFound(dir.removeEntry(path[path.length - 1] ?? ''));
  }

  private async removeKnownAt(dir: DirectoryHandle, name: string, entry: IndexEntry): Promise<void> {
    if (!entry.isFolder) {
      await ignoreNotFound(dir.removeEntry(name));
      return;
    }
    let folder: DirectoryHandle;
    try {
      folder = await dir.getDirectoryHandle(name);
    } catch (error) {
      if (isDomError(error, 'NotFoundError')) return;
      throw error;
    }
    for (const child of this.index.children(entry.id)) {
      if (child.explicitlyTrashed) continue;
      await this.removeKnownAt(folder, diskNameOf(child), child);
    }
    await removeIfEmpty(dir, name);
  }
}

/** The library in the browser's private file system (OPFS), in its own subfolder. */
export async function openBrowserStorage(): Promise<LocalFolderAdapter> {
  const opfs = await navigator.storage.getDirectory();
  const folder = await opfs.getDirectoryHandle('lopsy-photos', { create: true });
  return LocalFolderAdapter.open(folder, {
    kind: 'browser',
    label: 'This browser',
    estimate: () => navigator.storage.estimate(),
  });
}

/** A folder the user picked with showDirectoryPicker (readwrite permission already granted). */
export async function openPickedFolder(handle: FileSystemDirectoryHandle): Promise<LocalFolderAdapter> {
  return LocalFolderAdapter.open(handle, { kind: 'local-folder', label: handle.name });
}

function diskNameOf(entry: IndexEntry): string {
  return entry.diskName ?? safeFileName(entry.name);
}

/** File systems refuse separators and a few names; Drive allows anything. */
/** A name this adapter would itself have written: unchanged by safeFileName. */
function isSafeDiskName(name: string): boolean {
  return safeFileName(name) === name;
}

function safeFileName(name: string): string {
  const cleaned = Array.from(name, (char) => (char.charCodeAt(0) < 0x20 || '/\\:*?"<>|'.includes(char) ? '_' : char))
    .join('')
    .replace(/[. ]+$/, '');
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

async function writeFile(dir: DirectoryHandle, name: string, content: Blob, signal: AbortSignal | undefined): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try {
    throwIfAborted(signal);
    await writable.write(content);
    throwIfAborted(signal);
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  await writable.close();
}

async function readIndex(handle: DirectoryHandle): Promise<unknown> {
  let file: File;
  try {
    file = await (await handle.getFileHandle(INDEX_FILE_NAME)).getFile();
  } catch (error) {
    if (isDomError(error, 'NotFoundError')) return null;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return parsed;
  } catch (error) {
    throw new StorageError('unknown', 'The storage index is damaged', { cause: error });
  }
}

/** Whether the folder has a file or folder of this name. */
async function existsOnDisk(dir: DirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    if (isDomError(error, 'TypeMismatchError')) return true;
    if (isDomError(error, 'NotFoundError')) return false;
    throw error;
  }
}

async function removeIfEmpty(dir: DirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (error) {
    if (isDomError(error, 'NotFoundError') || isDomError(error, 'InvalidModificationError')) return;
    throw error;
  }
}

async function ignoreNotFound(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isDomError(error, 'NotFoundError')) throw error;
  }
}

function isDomError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name;
}

async function withFsErrors<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (isStorageError(error)) throw error;
    if (isDomError(error, 'NotFoundError')) throw new StorageError('not-found', 'A file is missing from the folder', { cause: error });
    if (isDomError(error, 'QuotaExceededError')) throw new StorageError('quota-exceeded', 'The storage is full', { cause: error });
    if (isDomError(error, 'NotAllowedError') || isDomError(error, 'SecurityError')) {
      throw new StorageError('auth', 'Permission to use the folder was refused', { cause: error });
    }
    if (isDomError(error, 'AbortError')) throw new StorageError('aborted', 'The request was cancelled', { cause: error });
    throw new StorageError('unknown', error instanceof Error ? error.message : 'File system error', { cause: error });
  }
}
