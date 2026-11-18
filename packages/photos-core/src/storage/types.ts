/**
 * The storage contract for a Lopsy Photos library.
 *
 * Google Drive is one implementation. A local folder (the browser's private
 * file system, or a folder the user picked) and an in-memory store are the
 * others. Everything above this interface (the library database, import,
 * export, previews) is written against it alone, so the whole app runs on
 * any of them: Drive in production, a local folder when running without a
 * Google account, memory in unit tests. See docs/lopsy-photos-spec.md, 6.5.
 *
 * The shape follows Drive's model because Drive is the most constrained
 * backend: files and folders have opaque IDs, a file can be found by its
 * app properties, content is replaced whole (no append), there is no
 * conditional write, and changes are read from a cursor-based feed.
 */

/** Opaque, stable for the life of the file. Never derived from a name. */
export type FileId = string;

/**
 * App-private properties on a file (Drive `appProperties`). At most 30 per
 * file; each key plus value must fit in 124 UTF-8 bytes.
 */
export type FileProperties = Readonly<Record<string, string>>;

export type StorageKind = 'google-drive' | 'local-folder' | 'browser' | 'memory';

export interface StoredFile {
  readonly id: FileId;
  readonly name: string;
  /** The folder holding this file; null only for the storage root. */
  readonly parentId: FileId | null;
  readonly isFolder: boolean;
  /** Content length in bytes; 0 for folders. */
  readonly size: number;
  readonly mimeType: string;
  /** ISO 8601. */
  readonly modifiedTime: string;
  /**
   * Lower-case hex SHA-256 of the content when the backend computes one
   * (Drive does for binary files, local adapters always do); null otherwise.
   */
  readonly sha256: string | null;
  /** Opaque; changes whenever the content changes. Drive's headRevisionId. */
  readonly revision: string;
  readonly properties: FileProperties;
  readonly trashed: boolean;
}

export interface NewFile {
  readonly parentId: FileId;
  readonly name: string;
  readonly mimeType: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export interface WriteOptions {
  /** Called as content is sent. Totals are in bytes. */
  readonly onProgress?: (sentBytes: number, totalBytes: number) => void;
  readonly signal?: AbortSignal;
  /**
   * Names this upload so an adapter that can resume uploads (Drive, with an
   * upload session store) continues it after a reload: a later call with
   * the same key and the same content size picks up where this one stopped.
   * Use a key that is unique to the content, e.g. `${assetId}:original`.
   * Adapters that cannot resume ignore it.
   */
  readonly resumeKey?: string;
}

export interface ReadOptions {
  readonly signal?: AbortSignal;
  /** Byte range, `end` exclusive. Reads the whole file when absent. */
  readonly range?: { readonly start: number; readonly end: number };
  /**
   * Called as content arrives. Totals are in bytes and cover the requested
   * range; `totalBytes` is null when the backend does not say. Ends with
   * `receivedBytes` equal to the content's size.
   */
  readonly onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

export interface StorageChange {
  readonly fileId: FileId;
  /** The file's current state, or null when it was deleted permanently. */
  readonly file: StoredFile | null;
}

export interface ChangePage {
  readonly changes: readonly StorageChange[];
  /** Pass to the next `listChanges` call. */
  readonly cursor: string;
  /** True when more changes are waiting; call again with `cursor` at once. */
  readonly hasMore: boolean;
}

export interface StorageQuota {
  readonly usedBytes: number;
  /** null when unlimited or unknown. */
  readonly limitBytes: number | null;
}

/**
 * One backend. Every method may throw `StorageError` (errors.ts); callers
 * retry only when `error.retryable` is true. Adapters retry transient
 * failures (rate limits, 5xx, dropped connections) internally first.
 *
 * Trashed files are excluded from `listChildren` and `findByProperty` but
 * still returned by `getFile` (with `trashed: true`).
 */
export interface StorageAdapter {
  readonly kind: StorageKind;
  /** For the UI: the account email or the folder's name. */
  readonly label: string;

  /** The top folder this adapter can create things in (My Drive's root, the picked folder). */
  getRoot(): Promise<StoredFile>;

  createFolder(
    parentId: FileId,
    name: string,
    properties?: Readonly<Record<string, string>>,
  ): Promise<StoredFile>;

  /** Creates a file. Large content is sent in resumable chunks where the backend supports it. */
  createFile(file: NewFile, content: Blob, options?: WriteOptions): Promise<StoredFile>;

  /** Replaces a file's content whole. Its ID stays; its revision changes. */
  updateContent(id: FileId, content: Blob, options?: WriteOptions): Promise<StoredFile>;

  /** Sets properties; a null value removes that key. Other keys are kept. */
  updateProperties(
    id: FileId,
    properties: Readonly<Record<string, string | null>>,
  ): Promise<StoredFile>;

  /** Moves a file into another folder (used to adopt files picked from Drive). */
  move(id: FileId, newParentId: FileId): Promise<StoredFile>;

  /** null when the file does not exist (or this adapter may not see it). */
  getFile(id: FileId): Promise<StoredFile | null>;

  readContent(id: FileId, options?: ReadOptions): Promise<Blob>;

  /** The folder's non-trashed children, in no particular order. */
  listChildren(parentId: FileId): Promise<StoredFile[]>;

  /** Every non-trashed file or folder anywhere whose property `key` equals `value`. */
  findByProperty(key: string, value: string): Promise<StoredFile[]>;

  trash(id: FileId): Promise<void>;
  untrash(id: FileId): Promise<void>;

  /**
   * Deletes for good. Only for files the app owns and replaces (journal
   * roll-ups, old snapshots, stale previews). Never called on originals.
   */
  deletePermanently(id: FileId): Promise<void>;

  /** A cursor for "now": `listChanges` from it returns later changes only. */
  getChangeCursor(): Promise<string>;

  /** Changes to files this adapter can see since `cursor`. */
  listChanges(cursor: string): Promise<ChangePage>;

  getQuota(): Promise<StorageQuota>;
}
