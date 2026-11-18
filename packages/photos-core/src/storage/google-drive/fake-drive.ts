/**
 * An in-process fake of the Drive v3 endpoints GoogleDriveAdapter uses,
 * as a fetch-compatible function. Vitest runs the real adapter against it,
 * and e2e tests can serve it from Playwright's page.route by handing each
 * routed request to `handle`.
 *
 * It models what the adapter depends on: files and folders with parents,
 * appProperties, trashed state (inherited from trashed folders), revisions,
 * SHA-256 checksums, multipart and resumable uploads (status queries and
 * partial chunks included), alt=media with Range, the `q` subset the
 * adapter writes, the changes feed, about.get and the userinfo endpoint.
 * It checks the bearer token and that every API request names `fields`,
 * and it can inject the failures Drive produces in practice.
 */

const API = '/drive/v3';
const UPLOAD = '/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_PROPERTIES = 30;
const MAX_PROPERTY_BYTES = 124;

export type FakeFailure =
  /** The next matching request gets this HTTP error, with a Drive error body. */
  | {
      readonly type: 'status';
      readonly status: number;
      readonly reason?: string;
      readonly retryAfterSeconds?: number;
      readonly match?: (request: Request) => boolean;
    }
  /** The next matching request fails as if the connection dropped before any reply. */
  | { readonly type: 'network'; readonly match?: (request: Request) => boolean }
  /** The next resumable chunk keeps its first `afterBytes` bytes, then the connection drops. */
  | { readonly type: 'drop-chunk'; readonly afterBytes: number };

export interface FakeDriveRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
}

export interface FakeDriveOptions {
  /** Bearer tokens the fake accepts. Default ['test-token']. */
  readonly tokens?: readonly string[];
  /** Bytes the account may store; past it uploads get 403 storageQuotaExceeded. Unlimited when absent. */
  readonly storageLimit?: number;
  /** Largest page the changes feed and file lists return, whatever pageSize asks for. */
  readonly maxPageSize?: number;
  readonly now?: () => Date;
  readonly account?: { readonly sub: string; readonly email: string; readonly name: string };
  /**
   * Answers CORS preflights and adds CORS headers, for serving the fake to a
   * page through Playwright's page.route (the page's origin differs from
   * googleapis.com there).
   */
  readonly cors?: boolean;
}

export interface FakeDrive {
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  handle(request: Request): Promise<Response>;
  readonly rootId: string;
  /** Every request received, in order. */
  readonly requests: FakeDriveRequest[];
  failNext(failure: FakeFailure): void;
  addToken(token: string): void;
  revokeToken(token: string): void;
  setStorageLimit(bytes: number | null): void;
  /** A file's bytes, or null when it does not exist. */
  contentOf(id: string): Uint8Array | null;
  /** Adds a file as if another app or the user made it (for Picker adoption tests). */
  seedFile(file: { name: string; parentId?: string; mimeType?: string; content?: Uint8Array; appProperties?: Record<string, string> }): string;
}

interface FakeFile {
  readonly id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  trashed: boolean;
  content: Uint8Array;
  sha256: string | null;
  version: number;
  headRevision: number;
  modifiedTime: string;
  readonly order: number;
}

interface UploadSession {
  readonly metadata: Record<string, unknown>;
  readonly targetId: string | null;
  total: number | null;
  readonly chunks: Uint8Array[];
  received: number;
  fileId: string | null;
}

type ChangeEntry = { readonly fileId: string; readonly removed: boolean };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();

export function createFakeDrive(options: FakeDriveOptions = {}): FakeDrive {
  const tokens = new Set(options.tokens ?? ['test-token']);
  const now = options.now ?? (() => new Date());
  const maxPageSize = options.maxPageSize ?? 1000;
  const account = options.account ?? { sub: '1234567890', email: 'test@example.com', name: 'Test User' };
  let storageLimit: number | null = options.storageLimit ?? null;
  let nextId = 1;
  let order = 0;
  const files = new Map<string, FakeFile>();
  const sessions = new Map<string, UploadSession>();
  const changes: ChangeEntry[] = [];
  const failures: FakeFailure[] = [];
  const requests: FakeDriveRequest[] = [];

  function newId(prefix: string): string {
    const id = `${prefix}${String(nextId++).padStart(6, '0')}${Math.random().toString(36).slice(2, 8)}`;
    return id;
  }

  const rootId = newId('root');
  files.set(rootId, {
    id: rootId,
    name: 'My Drive',
    mimeType: FOLDER,
    parents: [],
    appProperties: {},
    trashed: false,
    content: new Uint8Array(0),
    sha256: null,
    version: 1,
    headRevision: 0,
    modifiedTime: now().toISOString(),
    order: order++,
  });

  function record(fileId: string, removed = false): void {
    changes.push({ fileId, removed });
  }

  function resolveId(id: string): string {
    return id === 'root' ? rootId : id;
  }

  function requireFile(id: string): FakeFile {
    const file = files.get(resolveId(id));
    if (!file) throw new HttpError(404, 'notFound', `File not found: ${id}.`);
    return file;
  }

  function isTrashed(file: FakeFile): boolean {
    let current: FakeFile | undefined = file;
    for (let depth = 0; current && depth < 1000; depth++) {
      if (current.trashed) return true;
      const parent: string | undefined = current.parents[0];
      current = parent === undefined ? undefined : files.get(parent);
    }
    return false;
  }

  function descendants(id: string): FakeFile[] {
    const result: FakeFile[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const file of files.values()) {
        if (current !== undefined && file.parents.includes(current)) {
          result.push(file);
          stack.push(file.id);
        }
      }
    }
    return result;
  }

  function usage(): number {
    let total = 0;
    for (const file of files.values()) total += file.content.length;
    return total;
  }

  function checkStorage(addedBytes: number): void {
    if (storageLimit !== null && usage() + addedBytes > storageLimit) {
      throw new HttpError(403, 'storageQuotaExceeded', 'The user has exceeded their Drive storage quota');
    }
  }

  function checkProperties(properties: Record<string, string>): void {
    const keys = Object.keys(properties);
    if (keys.length > MAX_PROPERTIES) throw new HttpError(400, 'invalid', 'Too many appProperties');
    for (const key of keys) {
      if (encoder.encode(key).length + encoder.encode(properties[key] ?? '').length > MAX_PROPERTY_BYTES) {
        throw new HttpError(400, 'invalid', `appProperty ${key} is too long`);
      }
    }
  }

  function resource(file: FakeFile): Record<string, unknown> {
    const isFolder = file.mimeType === FOLDER;
    return {
      kind: 'drive#file',
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      ...(file.parents.length > 0 ? { parents: [...file.parents] } : {}),
      ...(isFolder ? {} : { size: String(file.content.length), sha256Checksum: file.sha256, headRevisionId: `rev${file.headRevision}` }),
      modifiedTime: file.modifiedTime,
      version: String(file.version),
      appProperties: { ...file.appProperties },
      trashed: isTrashed(file),
    };
  }

  async function createFile(metadata: Record<string, unknown>, content: Uint8Array): Promise<FakeFile> {
    const parents = Array.isArray(metadata.parents) ? metadata.parents.filter((p): p is string => typeof p === 'string') : [rootId];
    const resolvedParents = (parents.length > 0 ? parents : [rootId]).map(resolveId);
    for (const parent of resolvedParents) {
      if (requireFile(parent).mimeType !== FOLDER) throw new HttpError(400, 'invalid', 'A parent is not a folder');
    }
    const appProperties = stringRecord(metadata.appProperties);
    checkProperties(appProperties);
    const mimeType = typeof metadata.mimeType === 'string' ? metadata.mimeType : 'application/octet-stream';
    checkStorage(content.length);
    const file: FakeFile = {
      id: newId('f'),
      name: typeof metadata.name === 'string' ? metadata.name : 'Untitled',
      mimeType,
      parents: resolvedParents,
      appProperties,
      trashed: false,
      content,
      sha256: mimeType === FOLDER ? null : await sha256(content),
      version: 1,
      headRevision: 1,
      modifiedTime: now().toISOString(),
      order: order++,
    };
    files.set(file.id, file);
    record(file.id);
    return file;
  }

  async function replaceContent(file: FakeFile, content: Uint8Array): Promise<void> {
    if (file.mimeType === FOLDER) throw new HttpError(400, 'invalid', 'Folders have no content');
    checkStorage(content.length - file.content.length);
    file.content = content;
    file.sha256 = await sha256(content);
    file.headRevision += 1;
    touch(file);
  }

  function touch(file: FakeFile): void {
    file.version += 1;
    file.modifiedTime = now().toISOString();
    record(file.id);
  }

  function applyMetadata(file: FakeFile, metadata: Record<string, unknown>, url: URL): void {
    if (typeof metadata.name === 'string') file.name = metadata.name;
    if (typeof metadata.mimeType === 'string' && file.mimeType !== FOLDER) file.mimeType = metadata.mimeType;
    if (isRecord(metadata.appProperties)) {
      const next = { ...file.appProperties };
      for (const [key, value] of Object.entries(metadata.appProperties)) {
        if (value === null) delete next[key];
        else if (typeof value === 'string') next[key] = value;
      }
      checkProperties(next);
      file.appProperties = next;
    }
    const add = url.searchParams.get('addParents');
    const remove = url.searchParams.get('removeParents');
    if (remove) file.parents = file.parents.filter((parent) => !remove.split(',').map(resolveId).includes(parent));
    if (add) {
      for (const parent of add.split(',').map(resolveId)) {
        if (requireFile(parent).mimeType !== FOLDER) throw new HttpError(400, 'invalid', 'A parent is not a folder');
        if (parent === file.id || descendants(file.id).some((d) => d.id === parent)) {
          throw new HttpError(400, 'invalid', 'A folder cannot be moved into itself');
        }
        if (!file.parents.includes(parent)) file.parents.push(parent);
      }
    }
    const trashChanged = typeof metadata.trashed === 'boolean' && metadata.trashed !== file.trashed;
    if (typeof metadata.trashed === 'boolean') file.trashed = metadata.trashed;
    touch(file);
    if (trashChanged) for (const child of descendants(file.id)) record(child.id);
  }

  function listFiles(url: URL): Response {
    const q = url.searchParams.get('q') ?? '';
    const predicate = parseQuery(q, { isTrashed });
    const matching = [...files.values()].filter((file) => file.id !== rootId && predicate(file)).sort((a, b) => a.order - b.order);
    const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? '100'), maxPageSize);
    const offset = Number(url.searchParams.get('pageToken') ?? '0');
    const page = matching.slice(offset, offset + pageSize);
    const next = offset + page.length < matching.length ? String(offset + page.length) : undefined;
    return json(200, { files: page.map(resource), ...(next === undefined ? {} : { nextPageToken: next }) });
  }

  function listChanges(url: URL): Response {
    const token = Number(url.searchParams.get('pageToken'));
    if (!Number.isInteger(token) || token < 1 || token > changes.length + 1) throw new HttpError(400, 'invalid', 'Invalid pageToken');
    const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? '100'), maxPageSize);
    const start = token - 1;
    const page = changes.slice(start, start + pageSize);
    const end = start + page.length;
    return json(200, {
      kind: 'drive#changeList',
      changes: page.map((change) => {
        const file = files.get(change.fileId);
        return {
          kind: 'drive#change',
          changeType: 'file',
          fileId: change.fileId,
          removed: change.removed || !file,
          ...(file && !change.removed ? { file: resource(file) } : {}),
        };
      }),
      ...(end < changes.length ? { nextPageToken: String(end + 1) } : { newStartPageToken: String(changes.length + 1) }),
    });
  }

  function media(file: FakeFile, request: Request): Response {
    const range = request.headers.get('Range');
    const content = file.content;
    if (!range) return new Response(blobOf(content), { status: 200, headers: { 'Content-Type': file.mimeType } });
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) throw new HttpError(400, 'invalid', 'Bad Range');
    const start = Number(match[1]);
    const end = match[2] === '' || match[2] === undefined ? content.length - 1 : Math.min(Number(match[2]), content.length - 1);
    if (start >= content.length) throw new HttpError(416, 'requestedRangeNotSatisfiable', 'Range not satisfiable');
    return new Response(blobOf(content.slice(start, end + 1)), {
      status: 206,
      headers: { 'Content-Type': file.mimeType, 'Content-Range': `bytes ${start}-${end}/${content.length}` },
    });
  }

  async function startSession(request: Request, url: URL, targetId: string | null): Promise<Response> {
    const text = await request.text();
    const metadata = text === '' ? {} : parseJsonObject(text);
    if (targetId !== null) requireFile(targetId);
    const lengthHeader = request.headers.get('X-Upload-Content-Length');
    const total = lengthHeader === null ? null : Number(lengthHeader);
    if (total !== null) {
      const existing = targetId === null ? 0 : requireFile(targetId).content.length;
      checkStorage(total - existing);
    }
    const id = newId('upload');
    sessions.set(id, { metadata, targetId, total, chunks: [], received: 0, fileId: null });
    const location = new URL(url.toString());
    location.search = '';
    location.searchParams.set('uploadType', 'resumable');
    location.searchParams.set('upload_id', id);
    return new Response(null, { status: 200, headers: { Location: location.toString() } });
  }

  async function sessionPut(request: Request, url: URL, drop: { afterBytes: number } | null): Promise<Response> {
    const session = sessions.get(url.searchParams.get('upload_id') ?? '');
    if (!session) throw new HttpError(404, 'notFound', 'Upload session not found');
    const header = request.headers.get('Content-Range') ?? '';
    const query = /^bytes \*\/(\d+|\*)$/.exec(header);
    const chunk = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header);
    if (session.fileId !== null) return json(200, resource(requireFile(session.fileId)));
    if (query) {
      if (query[1] !== '*') session.total = Number(query[1]);
      if (session.total !== null && session.received === session.total) return finish(session);
      return incomplete(session);
    }
    if (!chunk) throw new HttpError(400, 'invalid', 'Bad Content-Range');
    const start = Number(chunk[1]);
    const body = new Uint8Array(await request.arrayBuffer());
    if (chunk[3] !== '*') session.total = Number(chunk[3]);
    if (start > session.received) throw new HttpError(400, 'invalid', 'Chunk starts past the received bytes');
    const kept = drop ? body.slice(0, Math.min(drop.afterBytes, body.length)) : body;
    const fresh = kept.slice(session.received - start);
    if (fresh.length > 0) {
      session.chunks.push(fresh);
      session.received += fresh.length;
    }
    if (drop) throw new TypeError('Failed to fetch');
    if (session.total !== null && session.received >= session.total) return finish(session);
    return incomplete(session);
  }

  function incomplete(session: UploadSession): Response {
    const headers: Record<string, string> = {};
    if (session.received > 0) headers.Range = `bytes=0-${session.received - 1}`;
    return new Response(null, { status: 308, headers });
  }

  async function finish(session: UploadSession): Promise<Response> {
    const content = concat(session.chunks);
    let file: FakeFile;
    if (session.targetId === null) {
      file = await createFile(session.metadata, content);
    } else {
      file = requireFile(session.targetId);
      await replaceContent(file, content);
    }
    session.fileId = file.id;
    return json(200, resource(file));
  }

  function takeFailure(request: Request, url: URL): FakeFailure | null {
    const isChunk = request.method === 'PUT' && url.searchParams.has('upload_id') && !/\*\//.test(request.headers.get('Content-Range') ?? '');
    const index = failures.findIndex((failure) => {
      if (failure.type === 'drop-chunk') return isChunk;
      return failure.match ? failure.match(request) : true;
    });
    if (index < 0) return null;
    const [failure] = failures.splice(index, 1);
    return failure ?? null;
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    requests.push({ method, url, headers: new Headers(request.headers) });

    const failure = takeFailure(request, url);
    if (failure?.type === 'network') throw new TypeError('Failed to fetch');
    if (failure?.type === 'status') {
      throw new HttpError(failure.status, failure.reason ?? defaultReason(failure.status), 'Injected failure', failure.retryAfterSeconds);
    }

    const auth = request.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokens.has(token)) throw new HttpError(401, 'authError', 'Invalid Credentials');

    if (path === '/oauth2/v3/userinfo') {
      return json(200, { sub: account.sub, email: account.email, name: account.name, picture: 'https://example.com/me.png' });
    }

    const isSessionPut = method === 'PUT' && url.searchParams.has('upload_id');
    if (!isSessionPut && !url.searchParams.has('fields')) {
      throw new HttpError(400, 'invalid', 'The fake requires every request to name its fields');
    }
    if (isSessionPut) return sessionPut(request, url, failure?.type === 'drop-chunk' ? failure : null);

    if (path === `${API}/about` && method === 'GET') {
      return json(200, { storageQuota: { usage: String(usage()), ...(storageLimit === null ? {} : { limit: String(storageLimit) }) } });
    }
    if (path === `${API}/changes/startPageToken` && method === 'GET') {
      return json(200, { startPageToken: String(changes.length + 1) });
    }
    if (path === `${API}/changes` && method === 'GET') return listChanges(url);
    if (path === `${API}/files` && method === 'GET') return listFiles(url);
    if (path === `${API}/files` && method === 'POST') {
      return json(200, resource(await createFile(parseJsonObject(await request.text()), new Uint8Array(0))));
    }

    const fileMatch = new RegExp(`^${API}/files/([^/]+)$`).exec(path);
    if (fileMatch?.[1] !== undefined) {
      const id = decodeURIComponent(fileMatch[1]);
      const file = requireFile(id);
      if (method === 'GET') return url.searchParams.get('alt') === 'media' ? media(file, request) : json(200, resource(file));
      if (method === 'PATCH') {
        const text = await request.text();
        applyMetadata(file, text === '' ? {} : parseJsonObject(text), url);
        return json(200, resource(file));
      }
      if (method === 'DELETE') {
        if (file.id === rootId) throw new HttpError(403, 'cannotDeleteRoot', 'The root cannot be deleted');
        for (const removed of [file, ...descendants(file.id)]) {
          files.delete(removed.id);
          record(removed.id, true);
        }
        return new Response(null, { status: 204 });
      }
    }

    const uploadType = url.searchParams.get('uploadType');
    if (path === `${UPLOAD}/files` && method === 'POST') {
      if (uploadType === 'resumable') return startSession(request, url, null);
      if (uploadType === 'multipart') {
        const { metadata, content } = await parseMultipart(request);
        return json(200, resource(await createFile(metadata, content)));
      }
      if (uploadType === 'media') {
        return json(200, resource(await createFile({ mimeType: request.headers.get('Content-Type') ?? undefined }, new Uint8Array(await request.arrayBuffer()))));
      }
    }
    const uploadMatch = new RegExp(`^${UPLOAD}/files/([^/]+)$`).exec(path);
    if (uploadMatch?.[1] !== undefined && method === 'PATCH') {
      const file = requireFile(decodeURIComponent(uploadMatch[1]));
      if (uploadType === 'resumable') return startSession(request, url, file.id);
      if (uploadType === 'media') {
        await replaceContent(file, new Uint8Array(await request.arrayBuffer()));
        return json(200, resource(file));
      }
      if (uploadType === 'multipart') {
        const { metadata, content } = await parseMultipart(request);
        await replaceContent(file, content);
        if (Object.keys(metadata).length > 0) applyMetadata(file, metadata, url);
        return json(200, resource(file));
      }
    }
    throw new HttpError(404, 'notFound', `No fake route for ${method} ${path}`);
  }

  async function handle(request: Request): Promise<Response> {
    if (!options.cors) return handleDrive(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const response = await handleDrive(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }

  async function handleDrive(request: Request): Promise<Response> {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof HttpError) {
        const headers: Record<string, string> = {};
        if (error.retryAfterSeconds !== undefined) headers['Retry-After'] = String(error.retryAfterSeconds);
        return json(
          error.status,
          { error: { code: error.status, message: error.message, errors: [{ domain: 'global', reason: error.reason, message: error.message }] } },
          headers,
        );
      }
      throw error;
    }
  }

  return {
    fetch: (input, init) => handle(new Request(input, init)),
    handle,
    rootId,
    requests,
    failNext: (failure) => {
      failures.push(failure);
    },
    addToken: (token) => {
      tokens.add(token);
    },
    revokeToken: (token) => {
      tokens.delete(token);
    },
    setStorageLimit: (bytes) => {
      storageLimit = bytes;
    },
    contentOf: (id) => {
      const file = files.get(id);
      return file ? file.content.slice() : null;
    },
    seedFile: (input) => {
      const content = input.content ?? new Uint8Array(0);
      const file: FakeFile = {
        id: newId('f'),
        name: input.name,
        mimeType: input.mimeType ?? 'application/octet-stream',
        parents: [input.parentId ?? rootId],
        appProperties: { ...(input.appProperties ?? {}) },
        trashed: false,
        content,
        sha256: null,
        version: 1,
        headRevision: 1,
        modifiedTime: now().toISOString(),
        order: order++,
      };
      files.set(file.id, file);
      record(file.id);
      void sha256(content).then((hash) => {
        file.sha256 = hash;
      });
      return file.id;
    },
  };
}

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Range, Range, X-Upload-Content-Type, X-Upload-Content-Length',
  'Access-Control-Expose-Headers': 'Location, Range, Content-Range, Retry-After',
};

function defaultReason(status: number): string {
  if (status === 401) return 'authError';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimitExceeded';
  return status >= 500 ? 'backendError' : 'invalid';
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') result[key] = item;
  return result;
}

function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'parseError', 'Body is not JSON');
  }
  if (!isRecord(parsed)) throw new HttpError(400, 'parseError', 'Body is not a JSON object');
  return parsed;
}

async function sha256(content: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', content.slice());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function blobOf(content: Uint8Array): Blob {
  return new Blob([content.slice()]);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

async function parseMultipart(request: Request): Promise<{ metadata: Record<string, unknown>; content: Uint8Array }> {
  const type = request.headers.get('Content-Type') ?? '';
  const boundary = /boundary="?([^";]+)"?/.exec(type)?.[1];
  if (!type.startsWith('multipart/related') || !boundary) throw new HttpError(400, 'badContent', 'Not multipart/related');
  const body = new Uint8Array(await request.arrayBuffer());
  const delimiter = encoder.encode(`--${boundary}`);
  const parts: Uint8Array[] = [];
  let position = indexOfBytes(body, delimiter, 0);
  while (position >= 0) {
    const start = position + delimiter.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    const next = indexOfBytes(body, delimiter, start);
    if (next < 0) break;
    parts.push(body.slice(start + 2, next - 2));
    position = next;
  }
  const [metaPart, contentPart] = parts.map((part) => {
    const split = indexOfBytes(part, encoder.encode('\r\n\r\n'), 0);
    return split < 0 ? new Uint8Array(0) : part.slice(split + 4);
  });
  if (!metaPart || !contentPart) throw new HttpError(400, 'badContent', 'Expected two parts');
  return { metadata: parseJsonObject(new TextDecoder().decode(metaPart)), content: contentPart };
}

/** The `q` subset the adapter writes: `'id' in parents`, `trashed=…`, `appProperties has {…}`, `name = '…'`, joined by `and`. */
function parseQuery(q: string, context: { isTrashed: (file: FakeFile) => boolean }): (file: FakeFile) => boolean {
  const tokens = tokenize(q);
  let position = 0;
  const peek = (): string | undefined => tokens[position];
  const next = (): string => {
    const token = tokens[position++];
    if (token === undefined) throw new HttpError(400, 'invalid', `Unexpected end of query: ${q}`);
    return token;
  };
  const expect = (value: string): void => {
    const token = next();
    if (token !== value) throw new HttpError(400, 'invalid', `Expected ${value} in query, got ${token}`);
  };
  const literal = (): string => {
    const token = next();
    if (!token.startsWith("'")) throw new HttpError(400, 'invalid', `Expected a string in query, got ${token}`);
    return token.slice(1);
  };

  const term = (): ((file: FakeFile) => boolean) => {
    const token = peek();
    if (token?.startsWith("'")) {
      const id = literal();
      expect('in');
      expect('parents');
      return (file) => file.parents.includes(id);
    }
    const word = next();
    if (word === 'trashed') {
      expect('=');
      const value = next();
      if (value !== 'true' && value !== 'false') throw new HttpError(400, 'invalid', 'trashed takes true or false');
      return (file) => context.isTrashed(file) === (value === 'true');
    }
    if (word === 'name' || word === 'mimeType') {
      expect('=');
      const value = literal();
      return (file) => (word === 'name' ? file.name : file.mimeType) === value;
    }
    if (word === 'appProperties') {
      expect('has');
      expect('{');
      expect('key');
      expect('=');
      const key = literal();
      expect('and');
      expect('value');
      expect('=');
      const value = literal();
      expect('}');
      return (file) => file.appProperties[key] === value;
    }
    throw new HttpError(400, 'invalid', `Unsupported query term ${word}`);
  };

  const terms = [term()];
  while (position < tokens.length) {
    expect('and');
    terms.push(term());
  }
  return (file) => terms.every((predicate) => predicate(file));
}

/** Tokens; a string literal comes back as `'` followed by its unescaped value. */
function tokenize(q: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < q.length) {
    const char = q[i] ?? '';
    if (/\s/.test(char)) {
      i++;
    } else if (char === "'") {
      let value = '';
      i++;
      for (;;) {
        const c = q[i];
        if (c === undefined) throw new HttpError(400, 'invalid', 'Unterminated string in query');
        if (c === '\\') {
          const escaped = q[i + 1];
          if (escaped === undefined) throw new HttpError(400, 'invalid', 'Bad escape in query');
          value += escaped;
          i += 2;
        } else if (c === "'") {
          i++;
          break;
        } else {
          value += c;
          i++;
        }
      }
      tokens.push(`'${value}`);
    } else if (char === '{' || char === '}' || char === '=') {
      tokens.push(char);
      i++;
    } else {
      const match = /^[A-Za-z]+/.exec(q.slice(i));
      if (!match) throw new HttpError(400, 'invalid', `Unexpected character ${char} in query`);
      tokens.push(match[0]);
      i += match[0].length;
    }
  }
  return tokens;
}
