import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptHandoff, focusPhotos, readHandoffId, saveToPhotos, searchWithoutHandoffParam } from './lopsy.ts';
import { readReceiveId, receiveFromLopsy, sendToLopsy, type ReceivedSave } from './photos.ts';
import { HandoffError } from './channel.ts';
import { PING_TIMEOUT_MS } from './messages.ts';
import { FakeWindow, LOPSY_BYTES, PNG_BYTES, bytes } from './fake-window.test-helper.ts';

const PHOTOS = 'https://photos.example/';
const LOPSY = 'https://lopsy.example/';
const source = { libraryId: 'lib', assetId: 'a1', versionId: 'v1', recipeHash: 'h1' };

function flush(ms = 0): Promise<void> {
  return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
}

function savePayload(name = 'Edited') {
  return { name, lopsy: bytes(LOPSY_BYTES), render: bytes(PNG_BYTES) };
}

/** Photos opens Lopsy with a document; returns both windows once the document is accepted. */
async function startHandoff(onSave: (save: ReceivedSave) => Promise<void | { revision?: string }> = async () => {}) {
  const photos = new FakeWindow(`${PHOTOS}library`);
  const docBytes = bytes(PNG_BYTES);
  const handoff = sendToLopsy({
    lopsyUrl: LOPSY,
    document: { name: 'DSCF1234', kind: 'png16', bytes: docBytes, source, baseRevision: 'r1' },
    onSave,
    window: photos,
  });
  const lopsy = photos.opened[0]!.window;
  const accepted = acceptHandoff({ photosUrl: PHOTOS, id: readHandoffId(new URL(lopsy.location.href).search)!, window: lopsy });
  await flush();
  return { photos, lopsy, handoff, accepted: await accepted, docBytes };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('send flow', () => {
  it('opens Lopsy under the named target with the handoff id', async () => {
    const { photos, handoff } = await startHandoff();
    expect(photos.opened).toHaveLength(1);
    expect(photos.opened[0]!.target).toBe('lopsy-editor');
    expect(photos.opened[0]!.url).toBe(`${LOPSY}?photos-handoff=${handoff.id}`);
  });

  it('runs the ready handshake, transfers the document and resolves delivered', async () => {
    const { photos, handoff, accepted, docBytes } = await startHandoff();
    await expect(handoff.delivered).resolves.toBeUndefined();
    expect(accepted.document.name).toBe('DSCF1234');
    expect(accepted.document.kind).toBe('png16');
    expect(new Uint8Array(accepted.document.bytes)).toEqual(new Uint8Array(PNG_BYTES));
    expect(accepted.connection.source).toEqual(source);
    expect(accepted.connection.baseRevision).toBe('r1');
    // Transferred, not copied: the sender's buffer is detached.
    expect(docBytes.byteLength).toBe(0);
    const documentPost = photos.posts.find((p) => (p.data as { type: string }).type === 'photos:document')!;
    expect(documentPost.transfer).toHaveLength(1);
    // Every post names its target origin.
    for (const post of photos.posts) expect(post.targetOrigin).toBe(post.to.origin);
  });

  it('round-trips a save: Lopsy posts both files, Photos answers once onSave settles', async () => {
    const saves: ReceivedSave[] = [];
    let finishSave: (r: { revision: string }) => void = () => {};
    const { photos, accepted, lopsy } = await startHandoff((save) => {
      saves.push(save);
      return new Promise((resolve) => {
        finishSave = resolve;
      });
    });
    const payload = savePayload();
    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload, window: lopsy });
    let isSettled = false;
    void outcome.then(() => {
      isSettled = true;
    });
    await flush();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.source).toEqual(source);
    expect(saves[0]!.baseRevision).toBe('r1');
    expect(new Uint8Array(saves[0]!.lopsy).slice(0, 6)).toEqual(new Uint8Array(LOPSY_BYTES.slice(0, 6)));
    expect(payload.lopsy.byteLength).toBe(0);
    expect(payload.render.byteLength).toBe(0);
    const savePost = photos.posts.find((p) => (p.data as { type: string }).type === 'lopsy:save')!;
    expect(savePost.transfer).toHaveLength(2);
    expect(isSettled).toBe(false);

    finishSave({ revision: 'r2' });
    await flush();
    await expect(outcome).resolves.toEqual({ ok: true, revision: 'r2' });
    expect(accepted.connection.baseRevision).toBe('r2');
    expect(photos.opened).toHaveLength(1);
  });

  it('reports a failed onSave to Lopsy as an error outcome', async () => {
    const { accepted, lopsy } = await startHandoff(async () => {
      throw new Error('Drive quota exceeded');
    });
    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload(), window: lopsy });
    await flush();
    await expect(outcome).resolves.toEqual({ ok: false, error: 'Drive quota exceeded' });
  });

  it('rejects delivered when the popup is blocked', async () => {
    const photos = new FakeWindow(PHOTOS);
    photos.canOpen = false;
    const handoff = sendToLopsy({
      lopsyUrl: LOPSY,
      document: { name: 'p', kind: 'png16', bytes: bytes(PNG_BYTES) },
      onSave: async () => {},
      window: photos,
    });
    await expect(handoff.delivered).rejects.toMatchObject({ code: 'popup-blocked' });
  });

  it('times out when Lopsy never says ready', async () => {
    const photos = new FakeWindow(PHOTOS);
    const handoff = sendToLopsy({
      lopsyUrl: LOPSY,
      document: { name: 'p', kind: 'png16', bytes: bytes(PNG_BYTES) },
      onSave: async () => {},
      window: photos,
      timeouts: { readyMs: 5000 },
    });
    const result = expect(handoff.delivered).rejects.toMatchObject({ code: 'timeout' });
    await flush(5001);
    await result;
  });

  it('times out on the Lopsy side when the document never comes', async () => {
    const photos = new FakeWindow(PHOTOS);
    const lopsy = new FakeWindow(`${LOPSY}?photos-handoff=abc`);
    lopsy.opener = photos.peerFor(lopsy);
    const accepted = acceptHandoff({ photosUrl: PHOTOS, id: 'abc', window: lopsy, timeoutMs: 3000 });
    const result = expect(accepted).rejects.toBeInstanceOf(HandoffError);
    await flush(3001);
    await result;
    // It said ready more than once while it waited.
    expect(photos.posts.filter((p) => (p.data as { type: string }).type === 'lopsy:ready').length).toBeGreaterThan(1);
    expect(lopsy.listenerCount).toBe(0);
  });

  it('refuses to accept without an opener', async () => {
    const lopsy = new FakeWindow(`${LOPSY}?photos-handoff=abc`);
    await expect(acceptHandoff({ photosUrl: PHOTOS, id: 'abc', window: lopsy })).rejects.toMatchObject({ code: 'no-opener' });
  });
});

describe('untrusted messages', () => {
  it('Lopsy ignores a document from another origin, then accepts the real one', async () => {
    const photos = new FakeWindow(PHOTOS);
    const evil = new FakeWindow('https://evil.example/');
    const lopsy = new FakeWindow(`${LOPSY}?photos-handoff=abc`);
    lopsy.opener = photos.peerFor(lopsy);
    let accepted: Awaited<ReturnType<typeof acceptHandoff>> | null = null;
    void acceptHandoff({ photosUrl: PHOTOS, id: 'abc', window: lopsy }).then((a) => {
      accepted = a;
    });
    const message = { protocol: 1, type: 'photos:document', id: 'abc', document: { name: 'evil', kind: 'png16', bytes: bytes(PNG_BYTES) } };
    lopsy.peerFor(evil).postMessage(message, lopsy.origin);
    await flush();
    expect(accepted).toBeNull();

    // Same origin but not the opener window.
    const otherPhotosTab = new FakeWindow(PHOTOS);
    lopsy.peerFor(otherPhotosTab).postMessage(message, lopsy.origin);
    await flush();
    expect(accepted).toBeNull();

    lopsy.peerFor(photos).postMessage({ ...message, document: { ...message.document, name: 'real', bytes: bytes(PNG_BYTES) } }, lopsy.origin);
    await flush();
    expect(accepted!.document.name).toBe('real');
  });

  it('Lopsy ignores malformed messages and keeps waiting', async () => {
    const photos = new FakeWindow(PHOTOS);
    const lopsy = new FakeWindow(`${LOPSY}?photos-handoff=abc`);
    lopsy.opener = photos.peerFor(lopsy);
    let accepted: Awaited<ReturnType<typeof acceptHandoff>> | null = null;
    void acceptHandoff({ photosUrl: PHOTOS, id: 'abc', window: lopsy }).then((a) => {
      accepted = a;
    });
    const fromPhotos = lopsy.peerFor(photos);
    const good = { protocol: 1, type: 'photos:document', id: 'abc', document: { name: 'p', kind: 'png16', bytes: bytes(PNG_BYTES) } };
    fromPhotos.postMessage('hello', lopsy.origin);
    fromPhotos.postMessage({ ...good, protocol: 2 }, lopsy.origin);
    fromPhotos.postMessage({ ...good, id: 'other' }, lopsy.origin);
    fromPhotos.postMessage({ ...good, document: { ...good.document, bytes: bytes(LOPSY_BYTES) } }, lopsy.origin);
    await flush();
    expect(accepted).toBeNull();
    fromPhotos.postMessage(good, lopsy.origin);
    await flush();
    expect(accepted).not.toBeNull();
  });

  it('Photos ignores a save from another origin', async () => {
    const onSave = vi.fn(async () => {});
    const { photos, handoff } = await startHandoff(onSave);
    const evil = new FakeWindow('https://evil.example/');
    photos.peerFor(evil).postMessage(
      { protocol: 1, type: 'lopsy:save', id: handoff.id, saveId: 's', name: 'x', lopsy: bytes(LOPSY_BYTES), render: bytes(PNG_BYTES) },
      photos.origin,
    );
    await flush();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a message aimed at the wrong origin never arrives', async () => {
    const { photos, accepted, lopsy } = await startHandoff();
    // Lopsy configured with the wrong Photos URL posts to an origin the tab is not on:
    // the ping goes unanswered, and the reopened tab (on the wrong origin) never says ready.
    const outcome = saveToPhotos({
      photosUrl: 'https://not-photos.example/',
      connection: accepted.connection,
      payload: savePayload(),
      window: lopsy,
      timeouts: { readyMs: 2000 },
    });
    const result = expect(outcome).rejects.toMatchObject({ code: 'timeout' });
    await flush(PING_TIMEOUT_MS + 2001);
    await result;
    expect(photos.posts.some((p) => p.targetOrigin === 'https://not-photos.example')).toBe(true);
  });

  it('close stops answering saves and pings', async () => {
    const onSave = vi.fn(async () => {});
    const { handoff, accepted, lopsy } = await startHandoff(onSave);
    handoff.close();
    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload(), window: lopsy, timeouts: { readyMs: 1000 } });
    const result = expect(outcome).rejects.toMatchObject({ code: 'timeout' });
    await flush(PING_TIMEOUT_MS + 1001);
    await result;
    expect(onSave).not.toHaveBeenCalled();
    expect(lopsy.opened).toHaveLength(1);
  });
});

describe('ping', () => {
  it('a listening Photos tab answers the ping and gets the save without a reopen', async () => {
    const { photos, accepted, lopsy } = await startHandoff();
    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload(), window: lopsy });
    await flush();
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(lopsy.opened).toHaveLength(0);
    const types = photos.posts.map((p) => (p.data as { type: string }).type);
    expect(types).toContain('lopsy:ping');
    expect(types).toContain('photos:pong');
  });

  it('a Photos tab that reloaded (no listener) is detected within the ping timeout and Photos is reopened', async () => {
    const saves: ReceivedSave[] = [];
    const { handoff, accepted, lopsy } = await startHandoff();
    // The page reloaded: the tab is open, but nothing in it listens for this handoff.
    handoff.close();
    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload(), window: lopsy });
    await flush(PING_TIMEOUT_MS - 100);
    expect(lopsy.opened).toHaveLength(0);
    await flush(200);
    expect(lopsy.opened).toHaveLength(1);
    const reopened = lopsy.opened[0]!;
    receiveFromLopsy({
      lopsyUrl: LOPSY,
      id: readReceiveId(new URL(reopened.url).search)!,
      onSave: async (save) => {
        saves.push(save);
      },
      window: reopened.window,
    });
    await flush();
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(saves).toHaveLength(1);
  });
});

describe('document ids and deferred documents', () => {
  it('the documentId Photos returns joins the source block of later saves', async () => {
    const saves: ReceivedSave[] = [];
    const { accepted, lopsy } = await startHandoff(async (save) => {
      saves.push(save);
      return { revision: `r${saves.length + 1}`, documentId: 'doc-123' };
    });
    const first = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload(), window: lopsy });
    await flush();
    await expect(first).resolves.toEqual({ ok: true, revision: 'r2', documentId: 'doc-123' });
    const second = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload(), window: lopsy });
    await flush();
    await second;
    expect(saves[0]!.source?.documentId).toBeUndefined();
    expect(saves[1]!.source).toEqual({ ...source, documentId: 'doc-123' });
    expect(saves[1]!.baseRevision).toBe('r2');
  });

  it('sendToLopsy opens Lopsy at once and sends a document that arrives later', async () => {
    const photos = new FakeWindow(PHOTOS);
    let resolveDocument: (d: { name: string; kind: 'png16'; bytes: ArrayBuffer }) => void = () => {};
    const handoff = sendToLopsy({
      lopsyUrl: LOPSY,
      document: new Promise((resolve) => {
        resolveDocument = resolve;
      }),
      onSave: async () => {},
      window: photos,
    });
    expect(photos.opened).toHaveLength(1);
    const lopsy = photos.opened[0]!.window;
    let accepted: Awaited<ReturnType<typeof acceptHandoff>> | null = null;
    void acceptHandoff({ photosUrl: PHOTOS, id: handoff.id, window: lopsy }).then((a) => {
      accepted = a;
    });
    await flush(3000);
    expect(accepted).toBeNull();
    resolveDocument({ name: 'Late', kind: 'png16', bytes: bytes(PNG_BYTES) });
    await flush(1000);
    await expect(handoff.delivered).resolves.toBeUndefined();
    expect(accepted!.document.name).toBe('Late');
  });
});

describe('reopen flow', () => {
  it('reopens Photos with ?receive= when its tab was closed, and later saves use the new tab', async () => {
    const { photos, accepted, lopsy } = await startHandoff();
    photos.closed = true;

    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: Promise.resolve(savePayload()), window: lopsy });
    expect(lopsy.opened).toHaveLength(1);
    const reopened = lopsy.opened[0]!;
    expect(reopened.target).toBe('lopsy-photos');
    expect(reopened.url).toBe(`${PHOTOS}?receive=${accepted.connection.id}`);

    const saves: ReceivedSave[] = [];
    const receiver = receiveFromLopsy({
      lopsyUrl: LOPSY,
      id: readReceiveId(new URL(reopened.url).search)!,
      onSave: async (save) => {
        saves.push(save);
        return { revision: 'r9' };
      },
      window: reopened.window,
    });
    await flush();
    await expect(outcome).resolves.toEqual({ ok: true, revision: 'r9' });
    await expect(receiver.firstSave).resolves.toMatchObject({ name: 'Edited', source, baseRevision: 'r1' });

    const second = saveToPhotos({ photosUrl: PHOTOS, connection: accepted.connection, payload: savePayload('Again'), window: lopsy });
    await flush();
    await expect(second).resolves.toEqual({ ok: true, revision: 'r9' });
    expect(lopsy.opened).toHaveLength(1);
    expect(saves.map((s) => s.name)).toEqual(['Edited', 'Again']);
    expect(saves[1]!.baseRevision).toBe('r9');
  });

  it('Add to Lopsy Photos opens Photos and sends no source block', async () => {
    const lopsy = new FakeWindow(LOPSY);
    let payloadReady: (p: ReturnType<typeof savePayload>) => void = () => {};
    const outcome = saveToPhotos({
      photosUrl: PHOTOS,
      connection: null,
      payload: new Promise((resolve) => {
        payloadReady = resolve;
      }),
      window: lopsy,
    });
    // The tab opens before the payload is ready, while the click still allows popups.
    expect(lopsy.opened).toHaveLength(1);
    const reopened = lopsy.opened[0]!;
    const id = readReceiveId(new URL(reopened.url).search)!;
    const saves: ReceivedSave[] = [];
    receiveFromLopsy({
      lopsyUrl: LOPSY,
      id,
      onSave: async (save) => {
        saves.push(save);
      },
      window: reopened.window,
    });
    await flush();
    expect(saves).toHaveLength(0);
    payloadReady(savePayload('New doc'));
    await flush();
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(saves).toHaveLength(1);
    expect(saves[0]!.source).toBeUndefined();
    expect(saves[0]!.baseRevision).toBeUndefined();
  });

  it('rejects when the reopened Photos never says ready', async () => {
    const lopsy = new FakeWindow(LOPSY);
    const outcome = saveToPhotos({ photosUrl: PHOTOS, connection: null, payload: savePayload(), window: lopsy, timeouts: { readyMs: 4000 } });
    const result = expect(outcome).rejects.toMatchObject({ code: 'timeout' });
    await flush(4001);
    await result;
  });

  it('rejects when the popup is blocked', async () => {
    const lopsy = new FakeWindow(LOPSY);
    lopsy.canOpen = false;
    await expect(saveToPhotos({ photosUrl: PHOTOS, connection: null, payload: savePayload(), window: lopsy })).rejects.toMatchObject({
      code: 'popup-blocked',
    });
  });

  it('a receive page with no opener fails its first save', async () => {
    const page = new FakeWindow(`${PHOTOS}?receive=abc`);
    const receiver = receiveFromLopsy({ lopsyUrl: LOPSY, id: 'abc', onSave: async () => {}, window: page });
    await expect(receiver.firstSave).rejects.toMatchObject({ code: 'no-opener' });
  });

  it('a receive page times out when no save arrives', async () => {
    const lopsy = new FakeWindow(LOPSY);
    const page = new FakeWindow(`${PHOTOS}?receive=abc`);
    page.opener = lopsy.peerFor(page);
    const receiver = receiveFromLopsy({ lopsyUrl: LOPSY, id: 'abc', onSave: async () => {}, window: page, timeoutMs: 1000 });
    const result = expect(receiver.firstSave).rejects.toMatchObject({ code: 'timeout' });
    await flush(1001);
    await result;
    // It said ready to Lopsy's origin only.
    const ready = lopsy.posts.find((p) => (p.data as { type: string }).type === 'photos:ready')!;
    expect(ready.targetOrigin).toBe('https://lopsy.example');
  });
});

describe('Back to Photos and URL helpers', () => {
  it('focuses the Photos tab when it is open, otherwise opens Photos', async () => {
    const { photos, accepted, lopsy } = await startHandoff();
    focusPhotos({ photosUrl: PHOTOS, connection: accepted.connection, window: lopsy });
    expect(photos.focused).toBe(1);
    expect(lopsy.opened).toHaveLength(0);
    photos.closed = true;
    focusPhotos({ photosUrl: PHOTOS, connection: accepted.connection, window: lopsy });
    expect(lopsy.opened[0]!.url).toBe(PHOTOS);
  });

  it('resolves a relative Photos URL against the page', async () => {
    const lopsy = new FakeWindow('https://lopsy.art/');
    void saveToPhotos({ photosUrl: '/photos/', connection: null, payload: savePayload(), window: lopsy }).catch(() => {});
    expect(lopsy.opened[0]!.url).toMatch(/^https:\/\/lopsy\.art\/photos\/\?receive=/);
  });

  it('reads and strips the handoff parameter', () => {
    expect(readHandoffId('?photos-handoff=abc-123&renderer=webgl')).toBe('abc-123');
    expect(readHandoffId('?photos-handoff=<x>')).toBeNull();
    expect(readHandoffId('')).toBeNull();
    expect(searchWithoutHandoffParam('?photos-handoff=abc&renderer=webgl')).toBe('?renderer=webgl');
    expect(searchWithoutHandoffParam('?photos-handoff=abc')).toBe('');
  });
});
