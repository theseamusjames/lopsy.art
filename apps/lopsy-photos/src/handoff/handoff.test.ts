import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '@lopsy/photos-core/storage/memory-adapter';
import { MemoryLocalStore } from '@lopsy/photos-core/library/local-store';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { recipeHash } from '@lopsy/photos-core/library/recipe';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import type { PreviewRenderer } from '@lopsy/photos-core/import/types';
import { acceptHandoff, saveToPhotos, type AcceptedHandoff } from '@lopsy/handoff/lopsy';
import type { ReceivedSave } from '@lopsy/handoff/photos';
import { FakeWindow } from '@lopsy/handoff/fake-window.test-helper';
import { editInLopsy, lopsyUrlFor } from './send-to-lopsy';
import { documentStem, freeStem, pngSize, storeLopsySave } from './store-lopsy-save';
import { hrefWithoutReceive, startHandoffReceiver } from './receiver';

const PHOTOS = 'https://photos.example/';
const LOPSY = 'https://lopsy.example/';

/** A PNG signature and IHDR (16-bit RGBA, `w` x `h`): enough for the size and the protocol checks. */
function png16(w: number, h: number, marker = 0): ArrayBuffer {
  const bytes = new Uint8Array(34);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  bytes[24] = 16;
  bytes[25] = 6;
  bytes[33] = marker;
  return bytes.buffer;
}

function lopsyFile(marker: number): ArrayBuffer {
  return new Uint8Array([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00, 3, 0, marker, 0, 0, 0]).buffer;
}

const previewRenderer: PreviewRenderer = {
  render: async (_source, maxSize) => ({
    blob: new Blob([`preview ${maxSize}`], { type: 'image/jpeg' }),
    width: maxSize,
    height: Math.round(maxSize * 0.75),
  }),
};

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

let session: LibrarySession;
let adapter: MemoryAdapter;

async function addOriginal(): Promise<{ assetId: string; versionId: string }> {
  const file = await adapter.createFile(
    { parentId: session.layout.originalsId, name: 'DSCF1234.RAF', mimeType: 'image/x-fujifilm-raf' },
    new Blob(['raw']),
  );
  return session.addAsset({
    kind: 'original',
    fileId: file.id,
    sha256: 'abc',
    fileName: 'DSCF1234.RAF',
    byteSize: 3,
    format: 'raf',
    mimeType: 'image/x-fujifilm-raf',
    capturedAt: '2026-11-14T16:02:11',
    importedAt: '2026-11-15T00:00:00.000Z',
    importId: 'imp-1',
    width: 6240,
    height: 4160,
    orientation: 1,
    camera: { make: 'FUJIFILM', model: 'X-T5' },
    lens: 'XF23mm',
    exposure: { iso: 400, shutter: '1/250', aperture: 2.8, focalLength: null },
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
  });
}

/** Photos sends the asset with editInLopsy; a fake Lopsy window accepts it. */
async function openInLopsy(assetId: string, onSaved?: (save: ReceivedSave) => void) {
  const photos = new FakeWindow(`${PHOTOS}library`);
  const renderPng16 = vi.fn(async () => png16(6240, 4160));
  const handoff = editInLopsy({
    session,
    assetId,
    renderPng16,
    lopsyUrl: LOPSY,
    previewRenderer,
    window: photos,
    ...(onSaved ? { onSaved: (_stored, save) => onSaved(save) } : {}),
  });
  const lopsy = photos.opened[0]!.window;
  const accepted = acceptHandoff({ photosUrl: PHOTOS, id: handoff.id, window: lopsy });
  await flush(10);
  await handoff.delivered;
  return { photos, lopsy, handoff, accepted: await accepted, renderPng16 };
}

function save(lopsy: FakeWindow, accepted: AcceptedHandoff, marker: number) {
  return saveToPhotos({
    photosUrl: PHOTOS,
    connection: accepted.connection,
    payload: { name: 'DSCF1234', lopsy: lopsyFile(marker), render: png16(6240, 4160, marker) },
    window: lopsy,
  });
}

async function readBytes(fileId: string): Promise<number[]> {
  return Array.from(new Uint8Array(await (await adapter.readContent(fileId)).arrayBuffer()));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  adapter = new MemoryAdapter();
  session = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
});

afterEach(async () => {
  await session.close();
  vi.useRealTimers();
});

describe('Edit in Lopsy, an original', () => {
  it('sends the developed 16-bit PNG with the version’s source block', async () => {
    const { assetId, versionId } = await addOriginal();
    const { accepted, renderPng16 } = await openInLopsy(assetId);
    expect(renderPng16).toHaveBeenCalledOnce();
    expect(accepted.document.kind).toBe('png16');
    expect(accepted.document.name).toBe('DSCF1234');
    expect(pngSize(accepted.document.bytes)).toEqual({ width: 6240, height: 4160 });
    const version = session.getView().versions.get(versionId)!;
    expect(accepted.document.camera).toEqual({
      make: 'FUJIFILM',
      model: 'X-T5',
      lens: 'XF23mm',
      iso: 400,
      shutter: '1/250',
      aperture: 2.8,
      capturedAt: '2026-11-14T16:02:11',
    });
    expect(accepted.connection.source).toEqual({
      libraryId: session.libraryId,
      assetId,
      versionId,
      recipeHash: recipeHash(version.recipe),
    });
  });

  it('stores the first save as a new document in the photo’s stack, with previews and tags', async () => {
    const { assetId, versionId } = await addOriginal();
    const { accepted, lopsy } = await openInLopsy(assetId);
    const outcome = save(lopsy, accepted, 1);
    await flush(10);
    const result = await outcome;
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const documents = [...session.getView().assets.values()].filter((a) => a.kind === 'document');
    expect(documents).toHaveLength(1);
    const doc = documents[0]!;
    expect(result.documentId).toBe(doc.id);
    expect(doc).toMatchObject({
      format: 'lopsy',
      mimeType: 'application/x-lopsy',
      fileName: 'DSCF1234.lopsy',
      width: 6240,
      height: 4160,
      capturedAt: '2026-11-14T16:02:11',
      camera: { make: 'FUJIFILM', model: 'X-T5' },
      lens: 'XF23mm',
      source: { assetId, versionId, recipeHash: recipeHash(session.getView().versions.get(versionId)!.recipe) },
      title: 'DSCF1234',
    });
    const lopsyStored = await adapter.getFile(doc.fileId);
    const renderStored = await adapter.getFile(doc.renderFileId!);
    expect(lopsyStored).toMatchObject({ parentId: session.layout.documentsId, name: 'DSCF1234.lopsy' });
    expect(lopsyStored!.properties).toMatchObject({ 'lp.lib': session.libraryId, 'lp.role': 'document', 'lp.asset': doc.id });
    expect(renderStored).toMatchObject({ parentId: session.layout.documentsId, name: 'DSCF1234.png' });
    expect(renderStored!.properties).toMatchObject({ 'lp.role': 'render', 'lp.asset': doc.id });
    expect(result.revision).toBe(lopsyStored!.revision);

    const version = session.getView().versions.get(doc.primaryVersionId)!;
    expect(version.thumb).toMatchObject({ width: 512, height: 384 });
    expect(version.screen).toMatchObject({ width: 2048, height: 1536 });
    const thumbFile = await adapter.getFile(version.thumb!.fileId);
    expect(thumbFile).toMatchObject({ parentId: session.layout.previewsId });
    // Lopsy now knows the document, so its next save can update it.
    expect(accepted.connection.source?.documentId).toBe(doc.id);
  });

  it('updates the document in place on the next save and bumps its revision', async () => {
    const { assetId } = await addOriginal();
    const { accepted, lopsy } = await openInLopsy(assetId);
    const first = save(lopsy, accepted, 1);
    await flush(10);
    const r1 = await first;
    const second = save(lopsy, accepted, 2);
    await flush(2000);
    const r2 = await second;
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r2.documentId).toBe(r1.documentId);
    expect(r2.revision).not.toBe(r1.revision);
    const docs = [...session.getView().assets.values()].filter((a) => a.kind === 'document');
    expect(docs).toHaveLength(1);
    expect((await readBytes(docs[0]!.fileId))[8]).toBe(2);
    expect((await readBytes(docs[0]!.renderFileId!))[33]).toBe(2);
    const names = (await adapter.listChildren(session.layout.documentsId)).filter((f) => !f.trashed).map((f) => f.name);
    expect(names.sort()).toEqual(['DSCF1234.lopsy', 'DSCF1234.png']);
  });

  it('saves a copy when the document changed since Lopsy opened it', async () => {
    const { assetId } = await addOriginal();
    const { accepted, lopsy } = await openInLopsy(assetId);
    const first = save(lopsy, accepted, 1);
    await flush(10);
    const r1 = await first;
    if (!r1.ok) throw new Error('first save failed');
    // Another device saved the document meanwhile.
    const doc = session.getView().assets.get(r1.documentId!)!;
    await adapter.updateContent(doc.fileId, new Blob([lopsyFile(9)]));

    const second = save(lopsy, accepted, 2);
    await flush(2000);
    const r2 = await second;
    if (!r2.ok) throw new Error('second save failed');
    expect(r2.documentId).not.toBe(r1.documentId);
    const copy = session.getView().assets.get(r2.documentId!)!;
    expect(copy.fileName).toBe('DSCF1234 2.lopsy');
    // The other device's edit is untouched.
    expect((await readBytes(doc.fileId))[8]).toBe(9);
    expect((await readBytes(copy.fileId))[8]).toBe(2);
    // Later saves follow the copy.
    expect(accepted.connection.source?.documentId).toBe(copy.id);
  });
});

describe('Edit in Lopsy, a document', () => {
  it('sends the .lopsy with its current revision and asset id', async () => {
    const { assetId } = await addOriginal();
    const first = await openInLopsy(assetId);
    const saved = save(first.lopsy, first.accepted, 1);
    await flush(10);
    const r1 = await saved;
    if (!r1.ok) throw new Error('save failed');
    first.handoff.close();

    const { accepted, renderPng16 } = await openInLopsy(r1.documentId!);
    expect(renderPng16).not.toHaveBeenCalled();
    expect(accepted.document.kind).toBe('lopsy');
    expect(accepted.document.baseRevision).toBe(r1.revision);
    expect(accepted.connection.source).toMatchObject({ assetId, documentId: r1.documentId });
    // The document carries its photo's camera summary too.
    expect(accepted.document.camera).toMatchObject({ make: 'FUJIFILM', model: 'X-T5', iso: 400 });
    expect(new Uint8Array(accepted.document.bytes)[8]).toBe(1);
  });

  it('refuses an unknown asset before opening Lopsy', () => {
    const photos = new FakeWindow(PHOTOS);
    expect(() =>
      editInLopsy({ session, assetId: 'nope', renderPng16: async () => png16(1, 1), lopsyUrl: LOPSY, previewRenderer, window: photos }),
    ).toThrow();
    expect(photos.opened).toHaveLength(0);
  });
});

describe('storeLopsySave for a named document', () => {
  it('saves a copy when the save names a document but no base revision', async () => {
    const first = await storeLopsySave(session, { id: 'h1', name: 'Poster', lopsy: lopsyFile(1), render: png16(80, 60) }, { previewRenderer });
    const doc = session.getView().assets.get(first.documentId)!;
    const second = await storeLopsySave(
      session,
      {
        id: 'h1',
        name: 'Poster',
        lopsy: lopsyFile(2),
        render: png16(80, 60),
        source: { libraryId: session.libraryId, assetId: '', versionId: '', recipeHash: '', documentId: doc.id },
      },
      { previewRenderer },
    );
    expect(second.outcome).toBe('copied');
    expect(second.documentId).not.toBe(doc.id);
    expect(second.fileName).toBe('Poster 2.lopsy');
    expect((await readBytes(doc.fileId))[8]).toBe(1);
  });

  it('updates in place when the base revision matches', async () => {
    const first = await storeLopsySave(session, { id: 'h1', name: 'Poster', lopsy: lopsyFile(1), render: png16(80, 60) }, { previewRenderer });
    const doc = session.getView().assets.get(first.documentId)!;
    const second = await storeLopsySave(
      session,
      {
        id: 'h1',
        name: 'Poster',
        lopsy: lopsyFile(2),
        render: png16(80, 60),
        source: { libraryId: session.libraryId, assetId: '', versionId: '', recipeHash: '', documentId: doc.id },
        baseRevision: first.revision,
      },
      { previewRenderer },
    );
    expect(second).toMatchObject({ outcome: 'updated', documentId: doc.id });
    expect((await readBytes(doc.fileId))[8]).toBe(2);
  });
});

describe('storeLopsySave without a source', () => {
  it('files Add to Lopsy Photos as a new document with no source, next to existing names', async () => {
    await adapter.createFile({ parentId: session.layout.documentsId, name: 'Poster.lopsy', mimeType: 'application/x-lopsy' }, new Blob(['x']));
    const stored = await storeLopsySave(
      session,
      { id: 'h1', name: 'Poster', lopsy: lopsyFile(1), render: png16(800, 600) },
      { previewRenderer },
    );
    expect(stored.outcome).toBe('created');
    expect(stored.fileName).toBe('Poster 2.lopsy');
    const doc = session.getView().assets.get(stored.documentId)!;
    expect(doc).toMatchObject({ kind: 'document', source: null, camera: null, width: 800, height: 600 });
  });

  it('ignores a source block from another library', async () => {
    const stored = await storeLopsySave(
      session,
      {
        id: 'h1',
        name: 'Elsewhere',
        lopsy: lopsyFile(1),
        render: png16(10, 10),
        source: { libraryId: 'other', assetId: 'a', versionId: 'v', recipeHash: 'h', documentId: 'doc-1' },
      },
      { previewRenderer },
    );
    expect(stored.outcome).toBe('created');
    expect(session.getView().assets.get(stored.documentId)!.source).toBeNull();
  });
});

describe('the ?receive= page', () => {
  it('strips the parameter, says ready to Lopsy and stores its save', async () => {
    const lopsy = new FakeWindow(LOPSY);
    const page = new FakeWindow(`${PHOTOS}?receive=h-123&view=grid#top`);
    page.opener = lopsy.peerFor(page);
    const replaceState = vi.fn();
    const receiver = startHandoffReceiver({
      session,
      lopsyUrl: LOPSY,
      previewRenderer,
      location: page.location,
      history: { replaceState },
      window: page,
    })!;
    expect(receiver).not.toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?view=grid#top');
    expect(receiver.getState()).toEqual({ kind: 'waiting' });
    const states: string[] = [];
    const settled = new Promise<void>((resolve) => {
      receiver.subscribe(() => {
        states.push(receiver.getState().kind);
        if (receiver.getState().kind !== 'saving') resolve();
      });
    });

    // Lopsy's side: it opened this page and sends once it says ready.
    const message = {
      protocol: 1,
      type: 'lopsy:save',
      id: 'h-123',
      saveId: 's-1',
      name: 'Collage',
      lopsy: lopsyFile(4),
      render: png16(300, 200),
    };
    await flush();
    const ready = lopsy.posts.find((p) => (p.data as { type: string }).type === 'photos:ready');
    expect(ready?.targetOrigin).toBe('https://lopsy.example');
    page.peerFor(lopsy).postMessage(message, page.origin);
    await flush(10);
    await settled;
    await flush();
    expect(states).toEqual(['saving', 'saved']);
    const state = receiver.getState();
    expect(state.kind).toBe('saved');
    if (state.kind !== 'saved') return;
    expect(session.getView().assets.get(state.stored.documentId)).toMatchObject({ kind: 'document', width: 300, height: 200 });
    const answer = lopsy.posts.find((p) => (p.data as { type: string }).type === 'photos:saved');
    expect(answer?.data).toMatchObject({ ok: true, documentId: state.stored.documentId });
  });

  it('does nothing on a page without the parameter', () => {
    expect(
      startHandoffReceiver({ session, lopsyUrl: LOPSY, previewRenderer, location: { href: `${PHOTOS}?view=grid` } }),
    ).toBeNull();
  });

  it('reports a timeout when Lopsy never sends', async () => {
    const lopsy = new FakeWindow(LOPSY);
    const page = new FakeWindow(`${PHOTOS}?receive=h-9`);
    page.opener = lopsy.peerFor(page);
    const receiver = startHandoffReceiver({ session, lopsyUrl: LOPSY, previewRenderer, location: page.location, timeoutMs: 1000, window: page })!;
    await flush(1001);
    expect(receiver.getState()).toMatchObject({ kind: 'failed' });
  });
});

describe('helpers', () => {
  it('names and URLs', () => {
    expect(documentStem('a/b:c.lopsy')).toBe('a b c');
    expect(documentStem('   ')).toBe('Untitled');
    expect(freeStem(['X.lopsy', 'X 2.png'], 'X')).toBe('X 3');
    expect(hrefWithoutReceive('https://p.example/photos/?receive=1&a=b')).toBe('/photos/?a=b');
    expect(lopsyUrlFor(undefined, true)).toBe('http://localhost:5173/');
    expect(lopsyUrlFor(undefined, false)).toBe('/');
    expect(lopsyUrlFor('https://lopsy.art/', true)).toBe('https://lopsy.art/');
    expect(pngSize(new ArrayBuffer(10))).toBeNull();
  });
});
