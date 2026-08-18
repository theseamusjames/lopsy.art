import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The runtime uses global fetch, document.fonts, and the FontFace constructor.
// We install just enough of each to see what loadPreviewFace does with the
// bytes it carves out of the blob.

interface FakeFontFace {
  family: string;
  bytes: Uint8Array;
  load: () => Promise<void>;
}

interface Installed {
  restore: () => void;
  fetches: string[];
  faces: FakeFontFace[];
  addedFaces: FakeFontFace[];
  setBlobBytes: (bytes: Uint8Array) => void;
  setFetchOk: (ok: boolean) => void;
}

function install(): Installed {
  const fetches: string[] = [];
  const faces: FakeFontFace[] = [];
  const addedFaces: FakeFontFace[] = [];
  let blobBytes: Uint8Array = new Uint8Array(0);
  let fetchOk = true;

  const originalFetch = globalThis.fetch;
  const originalFontFace = (globalThis as { FontFace?: unknown }).FontFace;
  const originalDocument = (globalThis as { document?: unknown }).document;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetches.push(url);
    if (!fetchOk) return new Response(null, { status: 404 });
    // Copy into a fresh ArrayBuffer-backed view so Response accepts it under
    // the newer, stricter Uint8Array<ArrayBuffer> vs. Uint8Array<ArrayBufferLike>
    // typing.
    const copy = new Uint8Array(blobBytes.byteLength);
    copy.set(blobBytes);
    return new Response(copy, { status: 200 });
  }) as typeof fetch;

  (globalThis as { FontFace?: unknown }).FontFace = class {
    family: string;
    bytes: Uint8Array;
    constructor(family: string, bytes: BufferSource) {
      this.family = family;
      this.bytes = new Uint8Array(bytes as ArrayBuffer);
      faces.push(this as unknown as FakeFontFace);
    }
    load() { return Promise.resolve(); }
  };

  (globalThis as { document?: unknown }).document = {
    fonts: {
      add: (f: FakeFontFace) => { addedFaces.push(f); },
      ready: Promise.resolve(),
    },
  };

  return {
    fetches,
    faces,
    addedFaces,
    setBlobBytes: (bytes) => { blobBytes = bytes; },
    setFetchOk: (ok) => { fetchOk = ok; },
    restore: () => {
      globalThis.fetch = originalFetch;
      if (originalFontFace === undefined) delete (globalThis as { FontFace?: unknown }).FontFace;
      else (globalThis as { FontFace?: unknown }).FontFace = originalFontFace;
      if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = originalDocument;
    },
  };
}

describe('loadPreviewFace', () => {
  let env: Installed;

  beforeEach(() => {
    env = install();
    // Mock the generated index so tests are stable against catalog updates.
    // Two entries laid out back-to-back inside a 20-byte blob.
    vi.doMock('./font-previews-index', () => ({
      FONT_PREVIEWS_INDEX: {
        Roboto: { offset: 0, length: 8 },
        Inter: { offset: 8, length: 12 },
      },
      FONT_PREVIEWS_TOTAL_BYTES: 20,
    }));
    // Bytes 0..7 = 0xAA, bytes 8..19 = 0xBB, so we can tell them apart.
    const bytes = new Uint8Array(20);
    bytes.fill(0xaa, 0, 8);
    bytes.fill(0xbb, 8, 20);
    env.setBlobBytes(bytes);
  });

  afterEach(() => {
    env.restore();
    vi.resetModules();
    vi.doUnmock('./font-previews-index');
  });

  it('fetches the blob once and slices per-family bytes into a FontFace', async () => {
    const mod = await import('./font-previews');
    mod.resetFontPreviewsForTests();

    const face = await mod.loadPreviewFace('Roboto');
    expect(face).not.toBeNull();
    expect(env.fetches).toEqual(['/font-previews.bin']);
    expect(env.addedFaces.length).toBe(1);
    // The slice must be exactly Roboto's baked bytes (all 0xAA), not the whole blob.
    expect(env.addedFaces[0]!.family).toBe('Roboto');
    expect(env.addedFaces[0]!.bytes.length).toBe(8);
    expect([...env.addedFaces[0]!.bytes]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
  });

  it('reuses the same blob fetch across concurrent family loads', async () => {
    const mod = await import('./font-previews');
    mod.resetFontPreviewsForTests();

    const [rob, inter] = await Promise.all([
      mod.loadPreviewFace('Roboto'),
      mod.loadPreviewFace('Inter'),
    ]);
    expect(rob).not.toBeNull();
    expect(inter).not.toBeNull();
    // Two families, one network request.
    expect(env.fetches).toEqual(['/font-previews.bin']);
    expect(env.addedFaces.map((f) => f.family).sort()).toEqual(['Inter', 'Roboto']);
    // Inter's slice is at offset 8 and must be all 0xBB, not overlap with Roboto's 0xAA.
    const interFace = env.addedFaces.find((f) => f.family === 'Inter')!;
    expect(interFace.bytes.length).toBe(12);
    expect(interFace.bytes.every((b) => b === 0xbb)).toBe(true);
  });

  it('dedupes repeat calls for the same family (no second FontFace registration)', async () => {
    const mod = await import('./font-previews');
    mod.resetFontPreviewsForTests();

    await mod.loadPreviewFace('Roboto');
    await mod.loadPreviewFace('Roboto');
    expect(env.addedFaces.length).toBe(1);
    expect(env.fetches.length).toBe(1);
  });

  it('resolves null for families that are not in the baked index', async () => {
    const mod = await import('./font-previews');
    mod.resetFontPreviewsForTests();

    const face = await mod.loadPreviewFace('Not A Real Font');
    expect(face).toBeNull();
    // Missing families must NOT hit the network — they signal the caller to
    // fall back to the css2 API instead.
    expect(env.fetches.length).toBe(0);
  });

  it('resolves null when the blob fetch fails so callers can fall back', async () => {
    env.setFetchOk(false);
    const mod = await import('./font-previews');
    mod.resetFontPreviewsForTests();

    const face = await mod.loadPreviewFace('Roboto');
    expect(face).toBeNull();
    expect(env.addedFaces.length).toBe(0);
  });
});
