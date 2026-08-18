import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The font-loader module reads from window / document / fetch. We install
// minimal stubs before importing it and clean up after.

// ---------------------------------------------------------------------------
// loadGoogleFontPreview — minimal DOM stub so we can capture the requested
// link href without needing a full jsdom environment.
// ---------------------------------------------------------------------------

interface FakeLink {
  rel: string;
  href: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

interface InstalledDocumentStub {
  restore: () => void;
  links: FakeLink[];
}

function installDocumentStub(): InstalledDocumentStub {
  const links: FakeLink[] = [];
  const previousDocument = (globalThis as { document?: unknown }).document;
  const doc = {
    createElement: (_tag: string): FakeLink => ({
      rel: '',
      href: '',
      onload: null,
      onerror: null,
    }),
    head: {
      appendChild: (node: FakeLink) => {
        links.push(node);
        // Fire onload asynchronously so the loader's promise resolves.
        queueMicrotask(() => node.onload?.());
        return node;
      },
    },
    fonts: {
      ready: Promise.resolve(),
    },
  };
  (globalThis as { document?: unknown }).document = doc;
  return {
    restore: () => {
      if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previousDocument;
    },
    links,
  };
}

describe('loadGoogleFontPreview', () => {
  let stub: InstalledDocumentStub;

  beforeEach(() => {
    stub = installDocumentStub();
    vi.doMock('../engine-wasm/engine-state', () => ({ getEngine: () => null }));
    vi.doMock('../engine-wasm/wasm-bridge', () => ({ loadFontData: vi.fn() }));
  });

  afterEach(() => {
    stub.restore();
    vi.resetModules();
    vi.doUnmock('../engine-wasm/engine-state');
    vi.doUnmock('../engine-wasm/wasm-bridge');
  });

  // Regression for #729: the picker used to fetch pre-rendered PNGs from a
  // third-party CDN that has since been deleted. loadGoogleFontPreview replaces
  // that path by asking Google Fonts for a text-restricted subset via the
  // css2 API, which still exists.
  it('adds a stylesheet link pointing at the css2 text= subset endpoint', async () => {
    const mod = await import('./font-loader');
    await mod.loadGoogleFontPreview('Inter', 'Inter');

    expect(stub.links.length).toBe(1);
    expect(stub.links[0]!.rel).toBe('stylesheet');
    expect(stub.links[0]!.href).toBe(
      'https://fonts.googleapis.com/css2?family=Inter&text=Inter&display=swap',
    );
    // The deleted CDN must not be reachable from the loader anymore.
    expect(stub.links[0]!.href).not.toContain('getstencil');
  });

  it('dedupes repeat loads of the same family:text pair (one <link> only)', async () => {
    const mod = await import('./font-loader');
    await Promise.all([
      mod.loadGoogleFontPreview('Roboto', 'Roboto'),
      mod.loadGoogleFontPreview('Roboto', 'Roboto'),
    ]);
    expect(stub.links.length).toBe(1);
  });
});

const CYRILLIC_FIRST_CSS = `/* cyrillic-ext */
@font-face {
  font-family: 'Google Sans';
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/googlesans/cyr-ext.woff2) format('woff2');
  unicode-range: U+0460-052F;
}
/* latin */
@font-face {
  font-family: 'Google Sans';
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/googlesans/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

describe('loadFontBinaryToEngine fetch behavior', () => {
  const originalFetch = globalThis.fetch;
  const fetches: string[] = [];
  let respondOk: (url: string) => boolean;

  beforeEach(() => {
    fetches.length = 0;
    respondOk = () => true;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetches.push(url);
      if (!respondOk(url)) return new Response(null, { status: 404 });
      if (url.includes('fonts.googleapis.com')) {
        return new Response(CYRILLIC_FIRST_CSS, { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    }) as typeof fetch;
    // Neutralize the engine bridge — the loader guards for a null engine.
    vi.doMock('../engine-wasm/engine-state', () => ({
      getEngine: () => null,
    }));
    vi.doMock('../engine-wasm/wasm-bridge', () => ({
      loadFontData: vi.fn(),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
    vi.doUnmock('../engine-wasm/engine-state');
    vi.doUnmock('../engine-wasm/wasm-bridge');
  });

  async function loadOnce(family: string, weight = 400) {
    // Fresh import per test so the module-level cache doesn't cross-pollute.
    const mod = await import('./font-loader');
    mod.loadFontBinaryToEngine(family, weight);
    // Let the loader's async IIFE and its css2 fallback fire.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('fetches exactly the baked TTF path for a variable font', async () => {
    await loadOnce('Roboto');
    expect(fetches).toEqual([
      'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/roboto/Roboto[wdth,wght].ttf',
    ]);
  });

  it('fetches the per-weight static file, not a guessed pattern', async () => {
    await loadOnce('PT Sans', 700);
    expect(fetches).toEqual([
      'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ptsans/PT_Sans-Web-Bold.ttf',
    ]);
  });

  it('goes straight to the css2 API when no TTF path is baked', async () => {
    await loadOnce('Google Sans');
    expect(fetches[0]).toBe(
      'https://fonts.googleapis.com/css2?family=Google%20Sans:wght@400&display=swap',
    );
  });

  it('downloads the latin-subset URL from the css2 fallback, not the first url()', async () => {
    await loadOnce('Google Sans');
    expect(fetches).toContain('https://fonts.gstatic.com/s/googlesans/latin.woff2');
    expect(fetches).not.toContain('https://fonts.gstatic.com/s/googlesans/cyr-ext.woff2');
  });

  it('falls back to the css2 API when the baked TTF path 404s', async () => {
    respondOk = (url) => !url.includes('cdn.jsdelivr.net');
    await loadOnce('Roboto');
    expect(fetches.some((u) => u.includes('fonts.googleapis.com/css2'))).toBe(true);
    // The mock serves CYRILLIC_FIRST_CSS for every css2 request; assert the
    // latin url() was chosen over the cyrillic-ext one listed first.
    expect(fetches.some((u) => u.endsWith('latin.woff2'))).toBe(true);
    expect(fetches.every((u) => !u.includes('cyr-ext'))).toBe(true);
  });
});
