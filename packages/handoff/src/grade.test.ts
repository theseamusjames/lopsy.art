import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gradeInPhotos, readGradeId, receiveGrade, type GradeResult } from './grade.ts';
import { parseLopsyGrade, parsePhotosGraded } from './messages.ts';
import { FakeWindow } from './fake-window.test-helper.ts';

const PHOTOS = 'https://photos.example/';
const LOPSY = 'https://lopsy.example/';

/** A 16-bit layer blob whose header states `w` x `h`. */
function blob16(w = 4, h = 2): ArrayBuffer {
  const bytes = new Uint8Array(40).fill(7);
  const view = new DataView(bytes.buffer);
  [0, 0, w, h, w, h].forEach((v, i) => view.setInt32(i * 4, v, true));
  return bytes.buffer;
}

/** A PNG signature and IHDR stating `w` x `h`. */
function png(w = 4, h = 2): ArrayBuffer {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  bytes[24] = 16;
  bytes[25] = 6;
  return bytes.buffer;
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
    expect(opened.target).toMatch(/^photonamous-grade-/);
    expect(opened.url).toMatch(/^https:\/\/photos\.example\/\?grade=/);
    expect(layer).toMatchObject({ name: 'Sky', width: 4, height: 2 });
    expect(new Uint8Array(layer.pixels)[39]).toBe(7);
    expect(pixels.byteLength).toBe(0);
    const post = lopsy.posts.find((p) => (p.data as { type: string }).type === 'lopsy:grade')!;
    expect(post.transfer).toHaveLength(1);
    expect(post.targetOrigin).toBe('https://photos.example');
  });

  it('Done returns the graded PNG and recipe', async () => {
    const { session, pending } = await startGrade();
    expect(session.done(png(), { tone: { exposure: 0.5 } })).toBe(true);
    await flush();
    const result = await pending;
    expect(result.kind).toBe('graded');
    if (result.kind !== 'graded') return;
    expect(new Uint8Array(result.png).slice(0, 4)).toEqual(new Uint8Array(png().slice(0, 4)));
    expect(result.recipe).toEqual({ tone: { exposure: 0.5 } });
  });

  it('Cancel and a closed tab both come back as cancelled; an answer is sent once', async () => {
    const first = await startGrade();
    first.session.cancel();
    first.session.done(png(), {});
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
      { protocol: 1, type: 'lopsy:grade', id: 'g1', layer: { name: 'x', width: 1, height: 1, pixels: blob16(1, 1) } },
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
      gradeInPhotos({ photosUrl: PHOTOS, layer: { name: 'x', width: 1, height: 1, pixels: blob16(1, 1) }, window: lopsy }),
    ).rejects.toMatchObject({ code: 'popup-blocked' });
  });
});

describe('grade safety', () => {
  it('each grade opens its own tab, so a second never navigates the first away', async () => {
    const lopsy = new FakeWindow(LOPSY);
    const layer = { name: 'x', width: 4, height: 2, pixels: blob16() };
    void gradeInPhotos({ photosUrl: PHOTOS, layer, window: lopsy }).catch(() => {});
    void gradeInPhotos({ photosUrl: PHOTOS, layer: { ...layer, pixels: blob16() }, window: lopsy }).catch(() => {});
    expect(lopsy.opened).toHaveLength(2);
    expect(lopsy.opened[0]!.target).not.toBe(lopsy.opened[1]!.target);
  });

  it('Photos reports a PNG of the wrong size as a failure instead of sending it', async () => {
    const { session, pending, lopsy } = await startGrade();
    expect(session.done(png(5000, 5000), {})).toBe(false);
    const result = expect(pending).rejects.toThrow(/5000 \u00d7 5000, not 4 \u00d7 2/);
    await flush();
    await result;
    expect(lopsy.posts.some((p) => (p.data as { ok?: boolean }).ok === true)).toBe(false);
  });

  it('an answer Lopsy refuses, then a closed tab, is a failure, not a cancel', async () => {
    const { opened, pending, lopsy } = await startGrade();
    const id = new URL(opened.url).searchParams.get('grade');
    // A PNG whose IHDR claims a side larger than allowed fails the checks.
    lopsy.peerFor(opened.window).postMessage(
      { protocol: 1, type: 'photos:graded', id, ok: true, png: png(100_000, 2), recipe: {} },
      lopsy.origin,
    );
    opened.window.closed = true;
    const result = expect(pending).rejects.toThrow(/could not accept/);
    await flush(1500);
    await result;
  });
});

describe('grade validators', () => {
  it('check the layer and the answer', () => {
    const layer = { name: 'Sky', width: 4, height: 2, pixels: blob16() };
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer })).not.toBeNull();
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer: { ...layer, width: 0 } })).toBeNull();
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer: { ...layer, pixels: new ArrayBuffer(8) } })).toBeNull();
    const ok = { protocol: 1, type: 'photos:graded', id: 'g', ok: true, png: png(), recipe: { a: 1 } };
    expect(parsePhotosGraded(ok)).not.toBeNull();
    expect(parsePhotosGraded({ ...ok, png: blob16() })).toBeNull();
    expect(parsePhotosGraded({ ...ok, png: png(20000 * 4, 2) })).toBeNull();
    // A layer whose blob header disagrees with the message, or that is over budget, is refused.
    expect(parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer: { ...layer, pixels: blob16(16384, 16384) } })).toBeNull();
    expect(
      parseLopsyGrade({ protocol: 1, type: 'lopsy:grade', id: 'g', layer: { name: 'big', width: 16384, height: 16384, pixels: blob16(16384, 16384) } }),
    ).toBeNull();
    expect(parsePhotosGraded({ ...ok, recipe: 'x' })).toBeNull();
    expect(parsePhotosGraded({ ...ok, recipe: { big: 'x'.repeat(70_000) } })).toBeNull();
    expect(parsePhotosGraded({ protocol: 1, type: 'photos:graded', id: 'g', ok: false, cancelled: true })).not.toBeNull();
    expect(parsePhotosGraded({ protocol: 1, type: 'photos:graded', id: 'g', ok: false })).toBeNull();
  });
});
