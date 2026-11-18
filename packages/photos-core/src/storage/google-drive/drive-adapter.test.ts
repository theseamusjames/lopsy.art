import { describe, expect, it } from 'vitest';
import { StaticTokenSource } from '../../auth/static-token-source';
import { runAdapterContract } from '../adapter-contract';
import { sha256Hex } from '../content-hash';
import { escapeQueryString, GoogleDriveAdapter, type GoogleDriveAdapterOptions } from './drive-adapter';
import { createFakeDrive, type FakeDrive, type FakeDriveOptions } from './fake-drive';
import { MemoryUploadSessionStore } from './upload-sessions';

const KIB = 1024;

function setup(
  driveOptions: FakeDriveOptions = {},
  adapterOptions: Partial<GoogleDriveAdapterOptions> = {},
): { drive: FakeDrive; adapter: GoogleDriveAdapter; sleeps: number[]; tokens: StaticTokenSource } {
  const drive = createFakeDrive(driveOptions);
  const sleeps: number[] = [];
  const tokens = adapterOptions.tokenSource instanceof StaticTokenSource ? adapterOptions.tokenSource : new StaticTokenSource();
  const adapter = new GoogleDriveAdapter({
    tokenSource: tokens,
    label: 'test@example.com',
    fetch: drive.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...adapterOptions,
  });
  return { drive, adapter, sleeps, tokens };
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 2654435761) >>> 24;
  return bytes;
}

/** Faster than toEqual on megabyte arrays. */
function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isChunkPut(request: Request): boolean {
  return request.method === 'PUT' && !/\*\//.test(request.headers.get('Content-Range') ?? '');
}

runAdapterContract('GoogleDriveAdapter (fake Drive)', async () => setup().adapter);
runAdapterContract('GoogleDriveAdapter (fake Drive, small pages, resumable uploads)', async () =>
  setup({ maxPageSize: 2 }, { resumableThreshold: 1, chunkSize: 256 * KIB }).adapter,
);

describe('GoogleDriveAdapter', () => {
  it('maps the Drive root and files', async () => {
    const { adapter, drive } = setup();
    const root = await adapter.getRoot();
    expect(adapter.kind).toBe('google-drive');
    expect(root).toMatchObject({ id: drive.rootId, parentId: null, isFolder: true, name: 'My Drive' });
    const folder = await adapter.createFolder(root.id, 'Lopsy Photos', { 'lp.role': 'library' });
    expect(folder.revision).not.toBe('');
    expect(folder.sha256).toBeNull();
  });

  it('names fields on every request', async () => {
    const { adapter, drive } = setup();
    const root = await adapter.getRoot();
    const file = await adapter.createFile({ parentId: root.id, name: 'a', mimeType: 'text/plain' }, new Blob(['a']));
    await adapter.readContent(file.id);
    await adapter.move(file.id, (await adapter.createFolder(root.id, 'b')).id);
    await adapter.deletePermanently(file.id);
    await adapter.getQuota();
    await adapter.listChanges(await adapter.getChangeCursor());
    for (const request of drive.requests) expect(request.url.searchParams.has('fields'), request.url.toString()).toBe(true);
  });

  it('uploads large content resumably and resumes after a dropped chunk', async () => {
    const { adapter, drive } = setup({}, { resumableThreshold: 256 * KIB, chunkSize: 256 * KIB });
    const root = await adapter.getRoot();
    const bytes = randomBytes(512 * KIB + 100);
    drive.failNext({ type: 'drop-chunk', afterBytes: 1000 });
    const progress: number[] = [];
    const file = await adapter.createFile({ parentId: root.id, name: 'big.raf', mimeType: 'image/x-fuji-raf' }, new Blob([bytes.slice()]), {
      onProgress: (sent, total) => {
        expect(total).toBe(bytes.length);
        progress.push(sent);
      },
    });
    expect(sameBytes(drive.contentOf(file.id), bytes)).toBe(true);
    expect(file.sha256).toBe(await sha256Hex(new Blob([bytes.slice()])));
    expect(progress[progress.length - 1]).toBe(bytes.length);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);

    const puts = drive.requests.filter((request) => request.method === 'PUT').map((request) => request.headers.get('Content-Range'));
    expect(puts[0]).toBe(`bytes 0-${256 * KIB - 1}/${bytes.length}`);
    expect(puts[1]).toBe(`bytes */${bytes.length}`);
    expect(puts[2]).toBe(`bytes 1000-${1000 + 256 * KIB - 1}/${bytes.length}`);
    const initiation = drive.requests.find((request) => request.url.searchParams.get('uploadType') === 'resumable');
    expect(initiation?.headers.get('X-Upload-Content-Length')).toBe(String(bytes.length));
  }, 20_000);

  it('resumes after a 5xx in the middle of a resumable upload', async () => {
    const { adapter, drive } = setup({}, { resumableThreshold: 256 * KIB, chunkSize: 256 * KIB });
    const root = await adapter.getRoot();
    const file = await adapter.createFile({ parentId: root.id, name: 'f', mimeType: 'application/octet-stream' }, new Blob([new Uint8Array(10)]));
    const bytes = randomBytes(512 * KIB + 10);
    let chunks = 0;
    drive.failNext({ type: 'status', status: 503, match: (request) => isChunkPut(request) && ++chunks === 2 });
    const updated = await adapter.updateContent(file.id, new Blob([bytes.slice()]));
    expect(updated.id).toBe(file.id);
    expect(updated.revision).not.toBe(file.revision);
    expect(sameBytes(drive.contentOf(file.id), bytes)).toBe(true);
    expect(drive.requests.some((request) => request.headers.get('Content-Range') === `bytes */${bytes.length}`)).toBe(true);
  }, 20_000);

  it('refreshes the token once on a 401', async () => {
    const tokens = new StaticTokenSource(['old', 'new']);
    const { adapter, drive } = setup({ tokens: ['old', 'new'] }, { tokenSource: tokens });
    await adapter.getRoot();
    drive.revokeToken('old');
    await adapter.getRoot();
    expect(tokens.invalidations).toBe(1);
    expect(drive.requests[drive.requests.length - 1]?.headers.get('Authorization')).toBe('Bearer new');
  });

  it('reports auth when the refreshed token is refused too', async () => {
    const { adapter, tokens } = setup({ tokens: ['someone-else'] });
    await expect(adapter.getRoot()).rejects.toMatchObject({ code: 'auth', retryable: false, status: 401 });
    expect(tokens.invalidations).toBe(2);
  });

  it('backs off on 429, honouring Retry-After', async () => {
    const { adapter, drive, sleeps } = setup();
    drive.failNext({ type: 'status', status: 429, retryAfterSeconds: 7 });
    drive.failNext({ type: 'status', status: 429 });
    await adapter.getRoot();
    expect(sleeps).toEqual([7000, 2500]);
  });

  it('retries 403 rate limits, 500s and dropped connections', async () => {
    const { adapter, drive, sleeps } = setup();
    drive.failNext({ type: 'status', status: 403, reason: 'userRateLimitExceeded' });
    drive.failNext({ type: 'status', status: 403, reason: 'rateLimitExceeded' });
    drive.failNext({ type: 'status', status: 500 });
    drive.failNext({ type: 'network' });
    const root = await adapter.getRoot();
    expect(root.isFolder).toBe(true);
    expect(sleeps).toEqual([1500, 2500, 4500, 8500]);
  });

  it('gives up after five attempts', async () => {
    const { adapter, drive } = setup();
    for (let i = 0; i < 6; i++) drive.failNext({ type: 'status', status: 429 });
    await expect(adapter.getRoot()).rejects.toMatchObject({ code: 'rate-limited', retryable: true });
    expect(drive.requests).toHaveLength(5);
  });

  it('does not retry other 403s', async () => {
    const { adapter, drive } = setup();
    drive.failNext({ type: 'status', status: 403, reason: 'forbidden' });
    await expect(adapter.getRoot()).rejects.toMatchObject({ code: 'invalid', retryable: false, status: 403 });
    expect(drive.requests).toHaveLength(1);
  });

  it('maps storageQuotaExceeded to quota-exceeded', async () => {
    const { adapter } = setup({ storageLimit: 10 });
    const root = await adapter.getRoot();
    await expect(
      adapter.createFile({ parentId: root.id, name: 'big', mimeType: 'text/plain' }, new Blob(['01234567890123456789'])),
    ).rejects.toMatchObject({ code: 'quota-exceeded', retryable: false });
    expect(await adapter.getQuota()).toEqual({ usedBytes: 0, limitBytes: 10 });
  });

  it('maps a resumable upload past the quota to quota-exceeded', async () => {
    const { adapter } = setup({ storageLimit: 100 * KIB }, { resumableThreshold: 1, chunkSize: 256 * KIB });
    const root = await adapter.getRoot();
    await expect(
      adapter.createFile({ parentId: root.id, name: 'big', mimeType: 'text/plain' }, new Blob([new Uint8Array(200 * KIB)])),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('escapes quotes and backslashes in q strings', async () => {
    expect(escapeQueryString("it's a \\ test")).toBe("it\\'s a \\\\ test");
    const { adapter, drive } = setup();
    await adapter.findByProperty("k'", "v\\'");
    const q = drive.requests[drive.requests.length - 1]?.url.searchParams.get('q');
    expect(q).toBe("appProperties has { key='k\\'' and value='v\\\\\\'' } and trashed=false");
  });

  it('pages file lists', async () => {
    const { adapter } = setup({ maxPageSize: 3 });
    const root = await adapter.getRoot();
    for (let i = 0; i < 7; i++) await adapter.createFolder(root.id, `f${i}`, { tag: 'x' });
    expect(await adapter.listChildren(root.id)).toHaveLength(7);
    expect(await adapter.findByProperty('tag', 'x')).toHaveLength(7);
  });

  it('cancels while waiting to retry', async () => {
    const drive = createFakeDrive();
    const controller = new AbortController();
    const adapter = new GoogleDriveAdapter({
      tokenSource: new StaticTokenSource(),
      label: 'x',
      fetch: drive.fetch,
      sleep: () => new Promise(() => undefined),
    });
    const root = await adapter.getRoot();
    drive.failNext({ type: 'status', status: 500 });
    const pending = adapter.createFile({ parentId: root.id, name: 'a', mimeType: 'text/plain' }, new Blob(['a']), { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('paces requests with a token bucket', async () => {
    let clock = 0;
    const { adapter, sleeps } = setup({}, { now: () => clock, requestsPerSecond: 10 });
    for (let i = 0; i < 12; i++) await adapter.getQuota();
    expect(sleeps).toEqual([100, 200]);
    clock = 10_000;
    await adapter.getQuota();
    expect(sleeps).toHaveLength(2);
  });

  it('adopts a file it did not create by moving it', async () => {
    const { adapter, drive } = setup();
    const root = await adapter.getRoot();
    const library = await adapter.createFolder(root.id, 'Lopsy Photos');
    const picked = drive.seedFile({ name: 'IMG_1.JPG', mimeType: 'image/jpeg', content: new Uint8Array([1, 2, 3]) });
    const moved = await adapter.move(picked, library.id);
    expect(moved.parentId).toBe(library.id);
    expect(drive.requests[drive.requests.length - 1]?.url.searchParams.get('removeParents')).toBe(drive.rootId);
    expect(new Uint8Array(await (await adapter.readContent(picked)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('serves CORS headers when asked, for page.route', async () => {
    const drive = createFakeDrive({ cors: true });
    const preflight = await drive.fetch('https://www.googleapis.com/drive/v3/files', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    const response = await drive.fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Location');
    expect(response.status).toBe(200);
  });

  it('does not duplicate a create whose reply was lost', async () => {
    const { adapter, drive } = setup();
    const root = await adapter.getRoot();
    drive.failNext({ type: 'drop-response', match: (request) => request.method === 'POST' });
    const file = await adapter.createFile({ parentId: root.id, name: 'once.txt', mimeType: 'text/plain' }, new Blob(['once']));
    expect(file.name).toBe('once.txt');
    expect(await adapter.listChildren(root.id)).toHaveLength(1);
    drive.failNext({ type: 'drop-response', match: (request) => request.method === 'POST' });
    const folder = await adapter.createFolder(root.id, 'once');
    expect(folder.isFolder).toBe(true);
    expect(await adapter.listChildren(root.id)).toHaveLength(2);
  });

  it('fetches IDs in batches', async () => {
    const { adapter, drive } = setup();
    const root = await adapter.getRoot();
    await Promise.all(Array.from({ length: 5 }, (_, i) => adapter.createFolder(root.id, `f${i}`)));
    expect(drive.requests.filter((request) => request.url.pathname.endsWith('/generateIds'))).toHaveLength(1);
  });

  it('keeps the mimeType when a typeless blob replaces small content', async () => {
    const { adapter, drive } = setup();
    const root = await adapter.getRoot();
    const file = await adapter.createFile({ parentId: root.id, name: 'library.json', mimeType: 'application/json' }, new Blob(['{}']));
    const updated = await adapter.updateContent(file.id, new Blob(['{"a":1}']));
    expect(updated.mimeType).toBe('application/json');
    const upload = drive.requests.filter((request) => request.method === 'PATCH').pop();
    expect(upload?.headers.get('Content-Type')).toBe('application/json');
  });

  it('resumes an upload after a reload through the session store', async () => {
    const drive = createFakeDrive();
    const store = new MemoryUploadSessionStore();
    const make = (): GoogleDriveAdapter =>
      new GoogleDriveAdapter({
        tokenSource: new StaticTokenSource(),
        label: 'x',
        fetch: drive.fetch,
        sleep: async () => undefined,
        uploadSessions: store,
        resumableThreshold: 512 * KIB,
        chunkSize: 256 * KIB,
      });
    const first = make();
    const root = await first.getRoot();
    const bytes = randomBytes(768 * KIB);
    const controller = new AbortController();
    const newFile = { parentId: root.id, name: 'big.raf', mimeType: 'image/x-fuji-raf' };
    await expect(
      first.createFile(newFile, new Blob([bytes.slice()]), {
        resumeKey: 'asset-1:original',
        signal: controller.signal,
        onProgress: (sent) => {
          if (sent >= 512 * KIB) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect((await store.get('asset-1:original'))?.offset).toBe(512 * KIB);

    const before = drive.requests.length;
    const second = make();
    const progress: number[] = [];
    const file = await second.createFile(newFile, new Blob([bytes.slice()]), {
      resumeKey: 'asset-1:original',
      onProgress: (sent) => progress.push(sent),
    });
    expect(sameBytes(drive.contentOf(file.id), bytes)).toBe(true);
    expect(progress[0]).toBe(512 * KIB);
    const later = drive.requests.slice(before);
    expect(later.some((request) => request.method === 'POST')).toBe(false);
    expect(later[0]?.headers.get('Content-Range')).toBe(`bytes */${bytes.length}`);
    expect(later[1]?.headers.get('Content-Range')).toBe(`bytes ${512 * KIB}-${768 * KIB - 1}/${bytes.length}`);
    expect(await store.get('asset-1:original')).toBeNull();
    expect(await second.listChildren(root.id)).toHaveLength(1);
  }, 20_000);

  it('starts over when the saved session does not match the content', async () => {
    const drive = createFakeDrive();
    const store = new MemoryUploadSessionStore();
    await store.set('k', { sessionUri: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=gone', totalBytes: 600 * KIB, offset: 0, target: 'create', updatedAt: 0 });
    const adapter = new GoogleDriveAdapter({
      tokenSource: new StaticTokenSource(),
      label: 'x',
      fetch: drive.fetch,
      sleep: async () => undefined,
      uploadSessions: store,
      resumableThreshold: 512 * KIB,
      chunkSize: 256 * KIB,
    });
    const root = await adapter.getRoot();
    const bytes = randomBytes(600 * KIB);
    const file = await adapter.createFile({ parentId: root.id, name: 'a', mimeType: 'image/jpeg' }, new Blob([bytes.slice()]), { resumeKey: 'k' });
    expect(sameBytes(drive.contentOf(file.id), bytes)).toBe(true);
    expect(store.size).toBe(0);
  }, 20_000);

  it('rejects a chunk size that is not a multiple of 256 KiB', () => {
    expect(
      () => new GoogleDriveAdapter({ tokenSource: new StaticTokenSource(), label: 'x', chunkSize: 1000 }),
    ).toThrow(RangeError);
  });
});
