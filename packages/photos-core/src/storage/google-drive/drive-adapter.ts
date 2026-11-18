/**
 * StorageAdapter over the Google Drive v3 REST API (spec 6.5). The
 * transport is an injected `fetch`, so tests run this class unchanged
 * against fake-drive.ts.
 *
 * Every request names its `fields`, goes through a token bucket, retries
 * rate limits, 5xx and dropped connections with exponential backoff plus
 * jitter (honouring Retry-After), and refreshes the token once on a 401.
 * Content of 5 MiB or more goes up in resumable chunks that survive a
 * dropped connection by asking Drive how many bytes it holds.
 */

import { isStorageError, StorageError, type StorageErrorCode } from '../errors';
import { abortableDelay, abortedError, raceAbort, realSleep, throwIfAborted } from '../signals';
import type {
  ChangePage,
  FileId,
  NewFile,
  ReadOptions,
  StorageAdapter,
  StorageChange,
  StorageQuota,
  StoredFile,
  WriteOptions,
} from '../types';
import type { TokenSource } from '../../auth/types';
import type { UploadSessionRecord, UploadSessionStore } from './upload-sessions';

export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,parents,mimeType,size,modifiedTime,sha256Checksum,headRevisionId,version,appProperties,trashed';
const KIB = 1024;
const MIB = 1024 * KIB;
/** Drive requires resumable chunks in multiples of 256 KiB (except the last). */
const CHUNK_GRANULARITY = 256 * KIB;
/** IDs fetched per files.generateIds call. */
const ID_BATCH = 100;
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GoogleDriveAdapterOptions {
  readonly tokenSource: TokenSource;
  /** Shown in the UI: the account's email. */
  readonly label: string;
  readonly fetch?: FetchFunction;
  readonly sleep?: (ms: number) => Promise<void>;
  /** In [0, 1); for backoff jitter. */
  readonly random?: () => number;
  /** Milliseconds; for the token bucket and Retry-After dates. */
  readonly now?: () => number;
  /** Tries per request, the first included. Default 5. */
  readonly maxAttempts?: number;
  /** Token bucket refill rate and burst size. Default 10. */
  readonly requestsPerSecond?: number;
  /** Resumable chunk size; a multiple of 256 KiB. Default 8 MiB. */
  readonly chunkSize?: number;
  /** Content this size or larger is uploaded resumably. Default 5 MiB. */
  readonly resumableThreshold?: number;
  readonly origin?: string;
  /** Keeps resumable sessions across reloads for writes that pass WriteOptions.resumeKey. */
  readonly uploadSessions?: UploadSessionStore;
}

/** A StorageError that also carries the server's Retry-After, when it sent one. */
class DriveError extends StorageError {
  constructor(
    code: StorageErrorCode,
    message: string,
    readonly retryAfterMs: number | null,
    options?: { status?: number; cause?: unknown },
  ) {
    super(code, message, options);
  }
}

interface Call {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: BodyInit;
  readonly signal?: AbortSignal;
  /** Statuses that are not errors for this call (308 during resumable uploads). */
  readonly accept?: readonly number[];
}

export class GoogleDriveAdapter implements StorageAdapter {
  readonly kind = 'google-drive' as const;
  readonly label: string;

  private readonly tokens: TokenSource;
  private readonly fetchFn: FetchFunction;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly chunkSize: number;
  private readonly resumableThreshold: number;
  private readonly api: string;
  private readonly upload: string;
  private readonly bucket: TokenBucket;
  private readonly sessions: UploadSessionStore | null;
  private readonly idPool: string[] = [];
  private idRefill: Promise<void> | null = null;

  constructor(options: GoogleDriveAdapterOptions) {
    this.label = options.label;
    this.tokens = options.tokenSource;
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = options.sleep ?? realSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.chunkSize = options.chunkSize ?? 8 * MIB;
    if (this.chunkSize <= 0 || this.chunkSize % CHUNK_GRANULARITY !== 0) {
      throw new RangeError('chunkSize must be a positive multiple of 256 KiB');
    }
    this.resumableThreshold = options.resumableThreshold ?? 5 * MIB;
    const origin = options.origin ?? 'https://www.googleapis.com';
    this.api = `${origin}/drive/v3`;
    this.upload = `${origin}/upload/drive/v3`;
    this.sessions = options.uploadSessions ?? null;
    this.bucket = new TokenBucket(options.requestsPerSecond ?? 10, this.now, this.sleep);
  }

  async getRoot(): Promise<StoredFile> {
    return toStoredFile(await this.json({ method: 'GET', url: this.url('/files/root', { fields: FILE_FIELDS }) }));
  }

  async createFolder(parentId: FileId, name: string, properties: Readonly<Record<string, string>> = {}): Promise<StoredFile> {
    const id = await this.takeId(undefined);
    const metadata = { id, name, mimeType: DRIVE_FOLDER_MIME_TYPE, parents: [parentId], appProperties: properties };
    return this.idempotentCreate(id, undefined, async () =>
      toStoredFile(
        await this.json({
          method: 'POST',
          url: this.url('/files', { fields: FILE_FIELDS }),
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify(metadata),
        }),
      ),
    );
  }

  async createFile(file: NewFile, content: Blob, options: WriteOptions = {}): Promise<StoredFile> {
    throwIfAborted(options.signal);
    const resumed = await this.resumeSaved('create', content, options);
    if (resumed) return resumed;
    const id = await this.takeId(options.signal);
    const metadata = { id, name: file.name, mimeType: file.mimeType, parents: [file.parentId], appProperties: file.properties ?? {} };
    if (content.size >= this.resumableThreshold) {
      return this.resumable('POST', `${this.upload}/files`, 'create', metadata, file.mimeType, content, options);
    }
    const boundary = `lopsy-${Math.floor(this.random() * 1e12).toString(36)}-${this.now().toString(36)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ]);
    options.onProgress?.(0, content.size);
    const result = await this.idempotentCreate(id, options.signal, async () =>
      toStoredFile(
        await this.json({
          method: 'POST',
          url: `${this.upload}/files?${query({ uploadType: 'multipart', fields: FILE_FIELDS })}`,
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      ),
    );
    options.onProgress?.(content.size, content.size);
    return result;
  }

  async updateContent(id: FileId, content: Blob, options: WriteOptions = {}): Promise<StoredFile> {
    throwIfAborted(options.signal);
    const resumed = await this.resumeSaved(id, content, options);
    if (resumed) return resumed;
    // Drive takes an upload's Content-Type as the file's new mimeType, so send the current one.
    const current = await this.json({
      method: 'GET',
      url: this.url(`/files/${encodeURIComponent(id)}`, { fields: 'mimeType' }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const mimeType = isRecord(current) && isString(current.mimeType) ? current.mimeType : 'application/octet-stream';
    const path = `${this.upload}/files/${encodeURIComponent(id)}`;
    if (content.size >= this.resumableThreshold) {
      return this.resumable('PATCH', path, id, {}, mimeType, content, options);
    }
    options.onProgress?.(0, content.size);
    const result = toStoredFile(
      await this.json({
        method: 'PATCH',
        url: `${path}?${query({ uploadType: 'media', fields: FILE_FIELDS })}`,
        headers: { 'Content-Type': mimeType },
        body: content.slice(0, content.size, mimeType),
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    );
    options.onProgress?.(content.size, content.size);
    return result;
  }

  async updateProperties(id: FileId, properties: Readonly<Record<string, string | null>>): Promise<StoredFile> {
    return this.patchMetadata(id, { appProperties: properties });
  }

  async move(id: FileId, newParentId: FileId): Promise<StoredFile> {
    const current = await this.json({ method: 'GET', url: this.url(`/files/${encodeURIComponent(id)}`, { fields: 'parents' }) });
    const parents = isRecord(current) && Array.isArray(current.parents) ? current.parents.filter(isString) : [];
    return toStoredFile(
      await this.json({
        method: 'PATCH',
        url: this.url(`/files/${encodeURIComponent(id)}`, {
          addParents: newParentId,
          removeParents: parents.filter((parent) => parent !== newParentId).join(','),
          fields: FILE_FIELDS,
        }),
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: '{}',
      }),
    );
  }

  async getFile(id: FileId): Promise<StoredFile | null> {
    try {
      return toStoredFile(await this.json({ method: 'GET', url: this.url(`/files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS }) }));
    } catch (error) {
      if (isStorageError(error) && error.code === 'not-found') return null;
      throw error;
    }
  }

  async readContent(id: FileId, options: ReadOptions = {}): Promise<Blob> {
    const range = options.range;
    throwIfAborted(options.signal);
    if (range && range.end <= range.start) {
      if ((await this.getFile(id)) === null) throw new StorageError('not-found', `No file with ID ${id}`);
      options.onProgress?.(0, 0);
      return new Blob([]);
    }
    const headers: Record<string, string> = {};
    if (range) headers.Range = `bytes=${range.start}-${range.end - 1}`;
    return this.withRetry(options.signal, async () => {
      const response = await this.attempt({
        method: 'GET',
        url: this.url(`/files/${encodeURIComponent(id)}`, { alt: 'media', fields: 'id' }),
        headers,
        accept: [416],
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (response.status === 416) {
        options.onProgress?.(0, 0);
        return new Blob([]);
      }
      const onProgress = options.onProgress;
      if (!onProgress) return this.readBody(response, options.signal, (r) => r.blob());
      return this.readBody(response, options.signal, (r) => readWithProgress(r, onProgress));
    });
  }

  async listChildren(parentId: FileId): Promise<StoredFile[]> {
    return this.listAll(`'${escapeQueryString(parentId)}' in parents and trashed=false`);
  }

  async findByProperty(key: string, value: string): Promise<StoredFile[]> {
    return this.listAll(
      `appProperties has { key='${escapeQueryString(key)}' and value='${escapeQueryString(value)}' } and trashed=false`,
    );
  }

  async trash(id: FileId): Promise<void> {
    await this.patchMetadata(id, { trashed: true });
  }

  async untrash(id: FileId): Promise<void> {
    await this.patchMetadata(id, { trashed: false });
  }

  async deletePermanently(id: FileId): Promise<void> {
    await this.withRetry(undefined, async () => {
      await this.attempt({ method: 'DELETE', url: this.url(`/files/${encodeURIComponent(id)}`, { fields: 'id' }) });
    });
  }

  async getChangeCursor(): Promise<string> {
    const body = await this.json({ method: 'GET', url: this.url('/changes/startPageToken', { fields: 'startPageToken' }) });
    if (!isRecord(body) || !isString(body.startPageToken)) throw unexpected('changes.getStartPageToken');
    return body.startPageToken;
  }

  async listChanges(cursor: string): Promise<ChangePage> {
    const body = await this.json({
      method: 'GET',
      url: this.url('/changes', {
        pageToken: cursor,
        pageSize: '1000',
        includeRemoved: 'true',
        spaces: 'drive',
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      }),
    });
    if (!isRecord(body) || !Array.isArray(body.changes)) throw unexpected('changes.list');
    const changes: StorageChange[] = [];
    for (const raw of body.changes) {
      if (!isRecord(raw) || !isString(raw.fileId)) continue;
      if (raw.removed === true || !isRecord(raw.file)) changes.push({ fileId: raw.fileId, file: null });
      else changes.push({ fileId: raw.fileId, file: toStoredFile(raw.file) });
    }
    const next = isString(body.nextPageToken) ? body.nextPageToken : null;
    const fresh = isString(body.newStartPageToken) ? body.newStartPageToken : null;
    const nextCursor = next ?? fresh;
    if (nextCursor === null) throw unexpected('changes.list');
    return { changes, cursor: nextCursor, hasMore: next !== null };
  }

  async getQuota(): Promise<StorageQuota> {
    const body = await this.json({ method: 'GET', url: this.url('/about', { fields: 'storageQuota(limit,usage)' }) });
    const quota = isRecord(body) && isRecord(body.storageQuota) ? body.storageQuota : {};
    const limit = quota.limit === undefined ? null : Number(quota.limit);
    return { usedBytes: Number(quota.usage ?? 0), limitBytes: limit === null || Number.isNaN(limit) ? null : limit };
  }

  private url(path: string, params: Readonly<Record<string, string>>): string {
    return `${this.api}${path}?${query(params)}`;
  }

  private patchMetadata(id: FileId, metadata: Record<string, unknown>): Promise<StoredFile> {
    return this.json({
      method: 'PATCH',
      url: this.url(`/files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS }),
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    }).then(toStoredFile);
  }

  private async listAll(q: string): Promise<StoredFile[]> {
    const files: StoredFile[] = [];
    let pageToken: string | null = null;
    do {
      const params: Record<string, string> = { q, pageSize: '1000', spaces: 'drive', fields: `nextPageToken,files(${FILE_FIELDS})` };
      if (pageToken !== null) params.pageToken = pageToken;
      const body = await this.json({ method: 'GET', url: this.url('/files', params) });
      if (!isRecord(body) || !Array.isArray(body.files)) throw unexpected('files.list');
      for (const raw of body.files) files.push(toStoredFile(raw));
      pageToken = isString(body.nextPageToken) ? body.nextPageToken : null;
    } while (pageToken !== null);
    return files;
  }

  private async resumable(
    method: 'POST' | 'PATCH',
    path: string,
    target: string,
    metadata: Record<string, unknown>,
    mimeType: string,
    content: Blob,
    options: WriteOptions,
  ): Promise<StoredFile> {
    const signal = options.signal;
    const initUrl = `${path}?${query({ uploadType: 'resumable', fields: FILE_FIELDS })}`;
    for (let restart = 0; ; restart++) {
      const session = await this.withRetry(signal, async () => {
        const response = await this.attempt({
          method,
          url: initUrl,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType,
            'X-Upload-Content-Length': String(content.size),
          },
          body: JSON.stringify(metadata),
          ...(signal ? { signal } : {}),
        });
        const location = response.headers.get('Location');
        if (!location) throw new StorageError('unknown', 'Drive did not return an upload session');
        return location;
      });
      await this.saveSession(options.resumeKey, { sessionUri: session, totalBytes: content.size, offset: 0, target });
      try {
        return await this.sendChunks(session, target, content, options, 0);
      } catch (error) {
        // A 404 from the session URI means it expired; Drive's guidance is to start over.
        if (restart === 0 && isStorageError(error) && error.code === 'not-found') continue;
        throw error;
      }
    }
  }

  /**
   * Continues an upload saved under options.resumeKey, if one matches this
   * target and size and Drive still has it. Null means start a new upload.
   */
  private async resumeSaved(target: string, content: Blob, options: WriteOptions): Promise<StoredFile | null> {
    const key = options.resumeKey;
    if (!this.sessions || key === undefined || content.size < this.resumableThreshold) return null;
    const saved = await this.sessions.get(key);
    if (!saved) return null;
    if (saved.target !== target || saved.totalBytes !== content.size) {
      await this.sessions.delete(key);
      return null;
    }
    let status: Response;
    try {
      status = await this.querySession(saved.sessionUri, content.size, options.signal);
    } catch (error) {
      if (isStorageError(error) && (error.code === 'not-found' || error.code === 'invalid')) {
        await this.sessions.delete(key);
        return null;
      }
      throw error;
    }
    if (status.status !== 308) {
      await this.sessions.delete(key);
      const file = toStoredFile(await this.readBody(status, options.signal, (r) => r.json()));
      options.onProgress?.(content.size, content.size);
      return file;
    }
    return this.sendChunks(saved.sessionUri, target, content, options, receivedBytes(status.headers.get('Range')));
  }

  private querySession(session: string, total: number, signal: AbortSignal | undefined): Promise<Response> {
    return this.withRetry(signal, () =>
      this.attempt({
        method: 'PUT',
        url: session,
        headers: { 'Content-Range': `bytes */${total}` },
        accept: [308],
        ...(signal ? { signal } : {}),
      }),
    );
  }

  private async saveSession(key: string | undefined, record: Omit<UploadSessionRecord, 'updatedAt'>): Promise<void> {
    if (!this.sessions || key === undefined) return;
    await this.sessions.set(key, { ...record, updatedAt: this.now() });
  }

  private async sendChunks(
    session: string,
    target: string,
    content: Blob,
    options: WriteOptions,
    startOffset: number,
  ): Promise<StoredFile> {
    const total = content.size;
    const signal = options.signal;
    let offset = startOffset;
    let failures = 0;
    options.onProgress?.(offset, total);
    for (;;) {
      throwIfAborted(signal);
      const end = Math.min(offset + this.chunkSize, total);
      let response: Response;
      try {
        response = await this.attempt({
          method: 'PUT',
          url: session,
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
          body: content.slice(offset, end),
          accept: [308],
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (!isStorageError(error) || !error.retryable) throw error;
        failures += 1;
        if (failures >= this.maxAttempts) throw error;
        await abortableDelay(this.sleep, this.backoff(failures - 1, error), signal);
        response = await this.querySession(session, total, signal);
      }
      if (response.status === 308) {
        const received = receivedBytes(response.headers.get('Range'));
        if (received > offset) {
          failures = 0;
          await this.saveSession(options.resumeKey, { sessionUri: session, totalBytes: total, offset: received, target });
        }
        offset = received;
        options.onProgress?.(offset, total);
        continue;
      }
      const file = toStoredFile(await this.readBody(response, signal, (r) => r.json()));
      if (this.sessions && options.resumeKey !== undefined) await this.sessions.delete(options.resumeKey);
      options.onProgress?.(total, total);
      return file;
    }
  }

  /** The next pre-generated file ID; Drive hands them out in batches. */
  private async takeId(signal: AbortSignal | undefined): Promise<string> {
    for (;;) {
      const id = this.idPool.pop();
      if (id !== undefined) return id;
      if (!this.idRefill) {
        const refill = this.json({
          method: 'GET',
          url: this.url('/files/generateIds', { count: String(ID_BATCH), space: 'drive', type: 'files', fields: 'ids' }),
        })
          .then((body) => {
            if (!isRecord(body) || !Array.isArray(body.ids)) throw unexpected('files.generateIds');
            this.idPool.push(...body.ids.filter(isString));
          })
          .finally(() => {
            this.idRefill = null;
          });
        // Callers that gave up (aborted) no longer await it; keep its failure from going unhandled.
        refill.catch(() => undefined);
        this.idRefill = refill;
      }
      await raceAbort(this.idRefill, signal);
    }
  }

  /**
   * Runs a create that carries a pre-generated ID. If a retry is told the ID
   * exists (409), the earlier attempt landed after all: return that file.
   */
  private async idempotentCreate(id: string, signal: AbortSignal | undefined, create: () => Promise<StoredFile>): Promise<StoredFile> {
    try {
      return await create();
    } catch (error) {
      if (!isStorageError(error) || error.status !== 409) throw error;
      throwIfAborted(signal);
      const existing = await this.getFile(id);
      if (!existing) throw error;
      return existing;
    }
  }

  private json(call: Call): Promise<unknown> {
    return this.withRetry(call.signal, async () => {
      const response = await this.attempt(call);
      return this.readBody(response, call.signal, (r) => r.json() as Promise<unknown>);
    });
  }

  private async readBody<T>(response: Response, signal: AbortSignal | undefined, read: (response: Response) => Promise<T>): Promise<T> {
    try {
      return await read(response);
    } catch (error) {
      throw this.transportError(error, signal);
    }
  }

  private async withRetry<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await task();
      } catch (error) {
        if (!isStorageError(error) || !error.retryable || attempt + 1 >= this.maxAttempts) throw error;
        await abortableDelay(this.sleep, this.backoff(attempt, error), signal);
      }
    }
  }

  /** Exponential backoff from 1 s, capped at 32 s, plus up to 1 s of jitter; Retry-After wins when longer. */
  private backoff(attempt: number, error: StorageError): number {
    const computed = Math.min(32_000, 1000 * 2 ** attempt) + Math.floor(this.random() * 1000);
    const retryAfter = error instanceof DriveError ? error.retryAfterMs : null;
    return retryAfter === null ? computed : Math.max(retryAfter, computed);
  }

  /** One HTTP exchange: paced, authorized, refreshed once on 401, errors mapped. */
  private async attempt(call: Call): Promise<Response> {
    throwIfAborted(call.signal);
    await this.bucket.take(call.signal);
    let token = await this.tokens.getToken();
    for (let authTry = 0; ; authTry++) {
      throwIfAborted(call.signal);
      let response: Response;
      try {
        response = await this.fetchFn(call.url, {
          method: call.method,
          headers: { ...call.headers, Authorization: `Bearer ${token}` },
          ...(call.body === undefined ? {} : { body: call.body }),
          ...(call.signal ? { signal: call.signal } : {}),
        });
      } catch (error) {
        throw this.transportError(error, call.signal);
      }
      if (response.status === 401 && authTry === 0) {
        await response.body?.cancel().catch(() => undefined);
        this.tokens.invalidate();
        token = await this.tokens.getToken();
        continue;
      }
      if (response.ok || call.accept?.includes(response.status)) return response;
      if (response.status === 401) this.tokens.invalidate();
      throw await toStorageError(response, this.now());
    }
  }

  private transportError(error: unknown, signal: AbortSignal | undefined): StorageError {
    if (isStorageError(error)) return error;
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return abortedError(error);
    if (error instanceof TypeError) return new StorageError('network', 'The connection to Google Drive failed', { cause: error });
    return new StorageError('unknown', error instanceof Error ? error.message : 'Drive request failed', { cause: error });
  }
}

/** Escapes a value for a single-quoted string in a Drive `q` query. */
export function escapeQueryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** A token bucket: `rate` requests per second, bursting to `rate`. Callers past it wait their turn. */
class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    this.tokens = rate;
    this.last = now();
  }

  async take(signal: AbortSignal | undefined): Promise<void> {
    if (!Number.isFinite(this.rate)) return;
    const now = this.now();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) * this.rate) / 1000);
    this.last = now;
    this.tokens -= 1;
    // A negative balance is a queue: each caller waits for the tokens owed before it.
    if (this.tokens < 0) await abortableDelay(this.sleep, (-this.tokens * 1000) / this.rate, signal);
  }
}

/** Reads a body chunk by chunk, reporting bytes so far against Content-Length when Drive sends it. */
async function readWithProgress(response: Response, onProgress: (received: number, total: number | null) => void): Promise<Blob> {
  const length = Number(response.headers.get('Content-Length') ?? Number.NaN);
  const total = Number.isFinite(length) ? length : null;
  const type = response.headers.get('Content-Type') ?? '';
  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }
  if (total !== received) onProgress(received, received);
  return new Blob(chunks, { type });
}

function query(params: Readonly<Record<string, string>>): string {
  return new URLSearchParams(params).toString();
}

function receivedBytes(range: string | null): number {
  const match = range === null ? null : /bytes=0-(\d+)/.exec(range);
  return match?.[1] === undefined ? 0 : Number(match[1]) + 1;
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

async function toStorageError(response: Response, now: number): Promise<DriveError> {
  const status = response.status;
  let reason = '';
  let message = `Google Drive returned ${status}`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      if (isString(body.error.message)) message = body.error.message;
      const first: unknown = Array.isArray(body.error.errors) ? body.error.errors[0] : undefined;
      if (isRecord(first) && isString(first.reason)) reason = first.reason;
    }
  } catch {
    // Not every error has a JSON body (proxies, dropped bodies); the status alone decides then.
  }
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), now);
  return new DriveError(errorCode(status, reason), message, retryAfter, { status });
}

function errorCode(status: number, reason: string): StorageErrorCode {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate-limited';
  if (status === 403) {
    if (RATE_LIMIT_REASONS.has(reason)) return 'rate-limited';
    if (reason === 'storageQuotaExceeded') return 'quota-exceeded';
    if (reason === 'appNotAuthorizedToFile') return 'not-found';
    if (reason === 'insufficientPermissions' || reason === 'authError') return 'auth';
    return 'invalid';
  }
  if (status === 404) return 'not-found';
  if (status === 408) return 'network';
  if (status >= 500) return 'unknown';
  if (status >= 400) return 'invalid';
  return 'unknown';
}

function toStoredFile(raw: unknown): StoredFile {
  if (!isRecord(raw) || !isString(raw.id) || !isString(raw.mimeType)) throw unexpected('file resource');
  const isFolder = raw.mimeType === DRIVE_FOLDER_MIME_TYPE;
  const parents = Array.isArray(raw.parents) ? raw.parents.filter(isString) : [];
  const properties: Record<string, string> = {};
  if (isRecord(raw.appProperties)) {
    for (const [key, value] of Object.entries(raw.appProperties)) if (isString(value)) properties[key] = value;
  }
  return {
    id: raw.id,
    name: isString(raw.name) ? raw.name : '',
    parentId: parents[0] ?? null,
    isFolder,
    size: isFolder ? 0 : Number(raw.size ?? 0),
    mimeType: raw.mimeType,
    modifiedTime: isString(raw.modifiedTime) ? raw.modifiedTime : new Date(0).toISOString(),
    sha256: isString(raw.sha256Checksum) ? raw.sha256Checksum.toLowerCase() : null,
    revision: isString(raw.headRevisionId) ? raw.headRevisionId : isString(raw.version) ? raw.version : '',
    properties,
    trashed: raw.trashed === true,
  };
}

function unexpected(what: string): StorageError {
  return new StorageError('unknown', `Unexpected response from Google Drive (${what})`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
