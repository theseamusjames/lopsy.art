import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gradeInPhotos, readGradeId, receiveGrade, type GradeResult } from './grade.ts';
import { parseLopsyGrade, parsePhotosGraded } from './messages.ts';
import { FakeWindow, PNG_BYTES, bytes } from './fake-window.test-helper.ts';

const PHOTOS = 'https://photos.example/';
const LOPSY = 'https://lopsy.example/';

function blob16(): ArrayBuffer {
  return new Uint8Array(40).fill(7).buffer;
}

function flush(ms = 0): Promise<void> {
  return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Lopsy asks Photos to grade a layer; returns both ends once Photos has the layer. */
async function startGrade(layerPixels = blob16()) {
  const lopsy = new FakeWindow(`${LOPSY}`);
  let result: GradeResult | Error | null = null;
  const pending = gradeInPhotos({
    photosUrl: PHOTOS,
    layer: Promise.resolve({ name: 'Sky', width: 4, height: 2, pixels: layerPixels }),
    window: lopsy,
  });
  pending.then(
    (r) => {
      result = r;
    },
    (e: Error) => {
      result = e;
    },
  );
  const opened = lopsy.opened[0]!;
  const id = readGradeId(new URL(opened.url).search)!;
  const session = receiveGrade({ lopsyUrl: LOPSY, id, window: opened.window });
  await flush();
  const layer = await session.layer;
  return { lopsy, opened, session, layer, result: () => result, pending };
}

describe('grade a layer', () => {
  it('opens Photos at ?grade= in its own tab and hands over the layer, transferred', async () => {
    const pixels = blob16();
    const { opened, layer, lopsy } = await startGrade(pixels);
    expect(opened.target).toBe('lopsy-photos-grade');
    expect(opened.url).toMatch(/^https:\/\/photos\.example\/\?grade=/);
    expect(layer).toMatchObject({ name: 'Sky', width: 4, height: 2 });
    expect(new Uint8Array(layer.pixels)[0]).toBe(7);
    expect(pixels.byteLength).toBe(0);
    const post = lopsy.posts.find((p) => (p.data as { type: string }).type === 'lopsy:grade')!;
    expect(post.transfer).toHaveLength(1);
    expect(post.targetOrigin).toBe('https://photos.example');
  });

  it('Done returns the graded PNG and recipe', async () => {
    const { session, pending } = await startGrade();
    session.done(bytes(PNG_BYTES), { tone: { exposure: 0.5 } });
    await flush();
    const result = await pending;
    expect(result.kind).toBe('graded');
    if (result.kind !== 'graded') return;
    expect(new Uint8Array(result.png).slice(0, 4)).toEqual(new Uint8Array(PNG_BYTES.slice(0, 4)));
    expect(result.recipe).toEqual({ tone: { exposure: 0.5 } });
  });

  it('Cancel and a closed tab both come back as cancelled; an answer is sent once', async () => {
    const first = await startGrade();
    first.session.cancel();
    first.session.done(bytes(PNG_BYTES), {});
    await flush();
    await expect(first.pending).resolves.toEqual({ kind: 'cancelled' });

    const second = await startGrade();
    second.opened.window.closed = true;
    await flush(1500);
    await expect(second.pending).resolves.toEqual({ kind: 'cancelled' });
  });

  it('a failure in Photos rejects with its message', async () => {
    const { session, pending } = await startGrade();
    session.fail('render failed');
    const result = expect(pending).rejects.toThrow('render failed');
    await flush();
    await result;
  });

  it('ignores answers from another origin', async () => {
    const { lopsy, layer, result } = await startGrade();
    expect(layer.name).toBe('Sky');
    const evil = new FakeWindow('https://evil.example/');
    const id = new URL(lopsy.opened[0]!.url).searchParams.get('grade');
    lopsy.peerFor(evil).postMessage({ protocol: 1, type: 'photos:graded', id, ok: false, cancelled: true }, lopsy.origin);
    await flush();
    expect(result()).toBeNull();
  });

  it('Photos ignores a layer from another origin and times out', async () => {
    const lopsy = new FakeWindow(LOPSY);
    const evil = new FakeWindow('https://evil.example/');
    const page = new FakeWindow(`${PHOTOS}?grade=g1`);
    page.opener = lopsy.peerFor(page);
    const session = receiveGrade({ lopsyUrl: LOPSY, id: 'g1', window: page, timeoutMs: 1000 });
    page.peerFor(evil).postMessage(
      { protocol: 1, type: 'lopsy:grade', id: 'g1', layer: { name: 'x', width: 1, height: 1, pixels: blob16() } },
      page.origin,
    );
    const outcome = expect(session.layer).rejects.toMatchObject({ code: 'timeout' });
    await flush(1001);
    await outcome;
  });

  it('rejects when the popup is blocked', async () => {
    const lopsy = new FakeWindow(LOPSY);
    lopsy.canOpen = false;
    await expect(
      gradeInPhotos({ photosUrl: PHOTOS, layer: { name: 'x', width: 1, height: 1, pixels: blob16() }, window: lopsy }),
    ).rejects.toMatchObject({ code: 'popup-blocked' });
  });
});

describe('grade validators', () => {
  it('check the layer and the answer', () => {
    const layer = { name: 'Sky', width: 4, height: 2, pixels: blob16() };
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer })).not.toBeNull();
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer: { ...layer, width: 0 } })).toBeNull();
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer: { ...layer, pixels: new ArrayBuffer(8) } })).toBeNull();
    const ok = { protocol: 1, type: 'photos:graded', id: 'g', ok: true, png: bytes(PNG_BYTES), recipe: { a: 1 } };
    expect(parsePhotosGraded(ok)).not.toBeNull();
    expect(parsePhotosGraded({ ...ok, png: blob16() })).toBeNull();
    expect(parsePhotosGraded({ ...ok, recipe: 'x' })).toBeNull();
    expect(parsePhotosGraded({ ...ok, recipe: { big: 'x'.repeat(70_000) } })).toBeNull();
    expect(parsePhotosGraded({ protocol: 1, type: 'photos:graded', id: 'g', ok: false, cancelled: true })).not.toBeNull();
    expect(parsePhotosGraded({ protocol: 1, type: 'photos:graded', id: 'g', ok: false })).toBeNull();
  });
});
