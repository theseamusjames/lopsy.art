/**
 * The metadata model shared by the memory and local-folder adapters: IDs,
 * the folder tree, properties, revisions, trashed state and the change
 * feed. Plain data, so the local-folder adapter can persist it as JSON.
 *
 * The change feed stores no log: every entry and tombstone carries the
 * sequence number of its last change, and a cursor is a sequence number.
 * A page lists everything changed after the cursor, oldest first.
 */

import { StorageError } from './errors';
import type { ChangePage, FileId, StoredFile } from './types';

export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface IndexEntry {
  readonly id: FileId;
  name: string;
  parentId: FileId | null;
  readonly isFolder: boolean;
  size: number;
  mimeType: string;
  modifiedTime: string;
  sha256: string | null;
  revision: number;
  properties: Record<string, string>;
  /** Trashed itself; a file is also trashed when any ancestor is. */
  explicitlyTrashed: boolean;
  /** Sequence number of its last change. */
  seq: number;
  /** The entry's name on disk, unique in its folder (local-folder adapter only). */
  diskName?: string;
}

export interface IndexData {
  readonly version: 1;
  readonly rootId: FileId;
  readonly seq: number;
  readonly entries: readonly IndexEntry[];
  readonly tombstones: readonly { readonly id: FileId; readonly seq: number }[];
}

export interface NewIndexEntry {
  readonly name: string;
  readonly parentId: FileId;
  readonly isFolder: boolean;
  readonly size: number;
  readonly mimeType: string;
  readonly sha256: string | null;
  readonly properties: Record<string, string>;
  readonly diskName?: string;
}

export class FileIndex {
  private readonly entries = new Map<FileId, IndexEntry>();
  private readonly tombstones = new Map<FileId, number>();
  private seq: number;
  readonly rootId: FileId;
  private readonly now: () => Date;

  private constructor(data: IndexData, now: () => Date) {
    this.rootId = data.rootId;
    this.seq = data.seq;
    this.now = now;
    for (const entry of data.entries) this.entries.set(entry.id, { ...entry, properties: { ...entry.properties } });
    for (const tombstone of data.tombstones) this.tombstones.set(tombstone.id, tombstone.seq);
  }

  static create(rootName: string, now: () => Date = () => new Date()): FileIndex {
    const rootId = crypto.randomUUID();
    const root: IndexEntry = {
      id: rootId,
      name: rootName,
      parentId: null,
      isFolder: true,
      size: 0,
      mimeType: FOLDER_MIME_TYPE,
      modifiedTime: now().toISOString(),
      sha256: null,
      revision: 1,
      properties: {},
      explicitlyTrashed: false,
      seq: 0,
    };
    return new FileIndex({ version: 1, rootId, seq: 0, entries: [root], tombstones: [] }, now);
  }

  /** Throws StorageError('unknown') when `data` is not an index this code wrote. */
  static load(data: unknown, now: () => Date = () => new Date()): FileIndex {
    if (!isIndexData(data)) throw new StorageError('unknown', 'The storage index is damaged');
    return new FileIndex(data, now);
  }

  toJSON(): IndexData {
    return {
      version: 1,
      rootId: this.rootId,
      seq: this.seq,
      entries: [...this.entries.values()],
      tombstones: [...this.tombstones].map(([id, seq]) => ({ id, seq })),
    };
  }

  get cursor(): number {
    return this.seq;
  }

  get(id: FileId): IndexEntry | undefined {
    return this.entries.get(id);
  }

  require(id: FileId): IndexEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new StorageError('not-found', `No file with ID ${id}`);
    return entry;
  }

  requireFolder(id: FileId): IndexEntry {
    const entry = this.require(id);
    if (!entry.isFolder) throw new StorageError('invalid', `${id} is not a folder`);
    return entry;
  }

  requireFile(id: FileId): IndexEntry {
    const entry = this.require(id);
    if (entry.isFolder) throw new StorageError('invalid', `${id} is a folder`);
    return entry;
  }

  isTrashed(entry: IndexEntry): boolean {
    let current: IndexEntry | undefined = entry;
    while (current) {
      if (current.explicitlyTrashed) return true;
      current = current.parentId === null ? undefined : this.entries.get(current.parentId);
    }
    return false;
  }

  /** The nearest entry, itself included, that was trashed explicitly. */
  trashedAncestor(entry: IndexEntry): IndexEntry | null {
    let current: IndexEntry | undefined = entry;
    while (current) {
      if (current.explicitlyTrashed) return current;
      current = current.parentId === null ? undefined : this.entries.get(current.parentId);
    }
    return null;
  }

  toStored(entry: IndexEntry): StoredFile {
    return {
      id: entry.id,
      name: entry.name,
      parentId: entry.parentId,
      isFolder: entry.isFolder,
      size: entry.size,
      mimeType: entry.mimeType,
      modifiedTime: entry.modifiedTime,
      sha256: entry.sha256,
      revision: String(entry.revision),
      properties: { ...entry.properties },
      trashed: this.isTrashed(entry),
    };
  }

  /** Every child, trashed ones included. */
  children(parentId: FileId): IndexEntry[] {
    return [...this.entries.values()].filter((entry) => entry.parentId === parentId);
  }

  /** The entry and everything below it. */
  subtree(id: FileId): IndexEntry[] {
    const result: IndexEntry[] = [];
    const stack = [this.require(id)];
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) break;
      result.push(entry);
      if (entry.isFolder) stack.push(...this.children(entry.id));
    }
    return result;
  }

  findByProperty(key: string, value: string): IndexEntry[] {
    return [...this.entries.values()].filter(
      (entry) => entry.properties[key] === value && !this.isTrashed(entry),
    );
  }

  add(input: NewIndexEntry): IndexEntry {
    this.requireFolder(input.parentId);
    const entry: IndexEntry = {
      id: crypto.randomUUID(),
      name: input.name,
      parentId: input.parentId,
      isFolder: input.isFolder,
      size: input.size,
      mimeType: input.mimeType,
      modifiedTime: this.now().toISOString(),
      sha256: input.sha256,
      revision: 1,
      properties: { ...input.properties },
      explicitlyTrashed: false,
      seq: ++this.seq,
      ...(input.diskName === undefined ? {} : { diskName: input.diskName }),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /** Records a change to the entry; `contentChanged` also bumps its revision. */
  touch(entry: IndexEntry, contentChanged: boolean): void {
    entry.seq = ++this.seq;
    entry.modifiedTime = this.now().toISOString();
    if (contentChanged) entry.revision += 1;
  }

  /** Records a change without touching modifiedTime (a parent's trash state changed). */
  mark(entry: IndexEntry): void {
    entry.seq = ++this.seq;
  }

  /** Removes the entry and everything below it, leaving tombstones for the change feed. */
  remove(id: FileId): IndexEntry[] {
    const removed = this.subtree(id);
    for (const entry of removed) {
      this.entries.delete(entry.id);
      this.tombstones.set(entry.id, ++this.seq);
    }
    return removed;
  }

  changesSince(cursor: string, pageSize: number): ChangePage {
    const from = parseCursor(cursor);
    const pending: { id: FileId; seq: number; entry: IndexEntry | null }[] = [];
    for (const entry of this.entries.values()) {
      if (entry.seq > from) pending.push({ id: entry.id, seq: entry.seq, entry });
    }
    for (const [id, seq] of this.tombstones) {
      if (seq > from) pending.push({ id, seq, entry: null });
    }
    pending.sort((a, b) => a.seq - b.seq);
    const page = pending.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      changes: page.map(({ id, entry }) => ({ fileId: id, file: entry ? this.toStored(entry) : null })),
      cursor: String(page.length < pending.length && last ? last.seq : this.seq),
      hasMore: page.length < pending.length,
    };
  }

  usedBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.size;
    return total;
  }
}

function parseCursor(cursor: string): number {
  const value = Number(cursor);
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(value)) {
    throw new StorageError('invalid', `Not a change cursor: ${cursor}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isIndexEntry(value: unknown): value is IndexEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.parentId === null || typeof value.parentId === 'string') &&
    typeof value.isFolder === 'boolean' &&
    typeof value.size === 'number' &&
    typeof value.mimeType === 'string' &&
    typeof value.modifiedTime === 'string' &&
    (value.sha256 === null || typeof value.sha256 === 'string') &&
    typeof value.revision === 'number' &&
    isStringRecord(value.properties) &&
    typeof value.explicitlyTrashed === 'boolean' &&
    typeof value.seq === 'number' &&
    (value.diskName === undefined || typeof value.diskName === 'string')
  );
}

function isIndexData(value: unknown): value is IndexData {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.rootId === 'string' &&
    typeof value.seq === 'number' &&
    Array.isArray(value.entries) &&
    value.entries.every(isIndexEntry) &&
    Array.isArray(value.tombstones) &&
    value.tombstones.every((item: unknown) => isRecord(item) && typeof item.id === 'string' && typeof item.seq === 'number')
  );
}
