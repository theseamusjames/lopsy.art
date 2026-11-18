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

export interface LoadIndexOptions {
  readonly now?: () => Date;
  /** For indexes of real folders: how entries are named on disk, and which names are safe. */
  readonly disk?: {
    readonly nameOf: (entry: IndexEntry) => string;
    readonly isSafe: (name: string) => boolean;
    /** Names a child of the root may not take (the index file, the trash folder), any case. */
    readonly reservedAtRoot: ReadonlySet<string>;
  };
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

  /**
   * Loads a saved index, which is untrusted input (anyone can edit a file
   * in a picked folder). Refuses, with StorageError('unknown'), an index
   * that is the wrong shape, has no root or repeats an ID. Repairs the
   * rest by dropping entries (and everything below them) that do not hang
   * off the root through folders (orphans and cycles), and, with
   * `disk`, entries whose name on disk is unsafe, reserved at the root,
   * or taken by a sibling. `repairs` lists what was dropped.
   */
  static load(data: unknown, options: LoadIndexOptions = {}): FileIndex {
    if (!isIndexData(data)) throw new StorageError('unknown', 'The storage index is damaged');
    const byId = new Map<FileId, IndexEntry>();
    for (const entry of data.entries) {
      if (byId.has(entry.id)) throw new StorageError('unknown', `The storage index is damaged: ID ${entry.id} appears twice`);
      byId.set(entry.id, entry);
    }
    const root = byId.get(data.rootId);
    if (!root || root.parentId !== null || !root.isFolder) {
      throw new StorageError('unknown', 'The storage index is damaged: it has no root folder');
    }
    const children = new Map<FileId, IndexEntry[]>();
    for (const entry of data.entries) {
      if (entry.parentId === null) continue;
      const list = children.get(entry.parentId) ?? [];
      list.push(entry);
      children.set(entry.parentId, list);
    }
    const kept: IndexEntry[] = [root];
    const repairs: string[] = [];
    const disk = options.disk;
    const queue: IndexEntry[] = [root];
    for (let folder = queue.shift(); folder; folder = queue.shift()) {
      const taken = new Set<string>();
      if (disk && folder === root) for (const name of disk.reservedAtRoot) taken.add(name.toLowerCase());
      for (const child of children.get(folder.id) ?? []) {
        if (disk) {
          const name = disk.nameOf(child);
          const key = name.toLowerCase();
          const clash = !child.explicitlyTrashed && taken.has(key);
          if (!disk.isSafe(name) || !disk.isSafe(child.id) || clash) {
            repairs.push(`dropped ${child.id} ("${child.name}"): ${clash ? 'its name on disk is taken' : 'unsafe name on disk'}`);
            continue;
          }
          if (!child.explicitlyTrashed) taken.add(key);
        }
        kept.push(child);
        if (child.isFolder) queue.push(child);
      }
    }
    const keptIds = new Set(kept.map((entry) => entry.id));
    for (const entry of data.entries) {
      if (!keptIds.has(entry.id) && !repairs.some((line) => line.includes(entry.id))) {
        repairs.push(`dropped ${entry.id} ("${entry.name}"): not inside the root folder`);
      }
    }
    const seq = Math.max(data.seq, ...kept.map((entry) => entry.seq), ...data.tombstones.map((tombstone) => tombstone.seq));
    const index = new FileIndex({ ...data, seq, entries: kept }, options.now ?? (() => new Date()));
    index.repairs = repairs;
    return index;
  }

  /** What `load` dropped from a damaged index; empty for a sound one. */
  repairs: readonly string[] = [];

  /** Every parent walk stops after this many steps, so a cycle cannot hang it. */
  private walkLimit(): number {
    return this.entries.size + 1;
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

  /**
   * The entry, then its parent, and so on up to the root. Throws instead of
   * looping if the parents form a cycle (load drops cycles; this is a
   * second line of defence).
   */
  ancestry(entry: IndexEntry): IndexEntry[] {
    const chain: IndexEntry[] = [];
    const limit = this.walkLimit();
    let current: IndexEntry | undefined = entry;
    while (current) {
      if (chain.length >= limit) throw new StorageError('unknown', 'The storage index is damaged: its folders form a cycle');
      chain.push(current);
      current = current.parentId === null ? undefined : this.entries.get(current.parentId);
    }
    return chain;
  }

  isTrashed(entry: IndexEntry): boolean {
    return this.trashedAncestor(entry) !== null;
  }

  /** The nearest entry, itself included, that was trashed explicitly. */
  trashedAncestor(entry: IndexEntry): IndexEntry | null {
    return this.ancestry(entry).find((item) => item.explicitlyTrashed) ?? null;
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
    const seen = new Set<FileId>();
    const stack = [this.require(id)];
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) break;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
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
