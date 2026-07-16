import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The font-loader module reads from window / document / fetch. We install
// minimal stubs before importing it and clean up after.

describe('#665 font-loader tries multiple filename patterns', () => {
  const originalFetch = globalThis.fetch;
  const fetches: string[] = [];
  const successfulHostFor = new Map<string, string>();

  beforeEach(() => {
    fetches.length = 0;
    successfulHostFor.clear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetches.push(url);
      // Only URLs listed in successfulHostFor return ok.
      for (const [needle] of successfulHostFor) {
        if (url.endsWith(needle)) {
          return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
        }
      }
      return new Response(null, { status: 404 });
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

  async function loadOnce(family: string) {
    // Fresh import per test so the module-level cache doesn't cross-pollute.
    const mod = await import('./font-loader');
    mod.loadFontBinaryToEngine(family, 400);
    // Let the loader's async IIFE fire.
    await new Promise((r) => setTimeout(r, 0));
    // The CSS-API fallback runs after the TTF probes fail — give it another tick.
    await new Promise((r) => setTimeout(r, 0));
  }

  it('probes -Italic filename so italic-only fonts (Molle) still load', async () => {
    await loadOnce('Molle');
    const probed = fetches.filter((u) => u.includes('/molle/'));
    expect(probed.some((u) => u.endsWith('Molle-Italic.ttf'))).toBe(true);
  });

  it('probes VariableFont_wght filename so variable fonts (Playwrite HR) load', async () => {
    await loadOnce('Playwrite HR');
    const probed = fetches.filter((u) => u.includes('/playwritehr/'));
    expect(probed.some((u) => u.endsWith('PlaywriteHR-VariableFont_wght.ttf'))).toBe(true);
    expect(probed.some((u) => u.endsWith('PlaywriteHR[wght].ttf'))).toBe(true);
  });

  it('still probes the plain -Regular filename for classic static fonts', async () => {
    await loadOnce('Inter');
    const probed = fetches.filter((u) => u.includes('/inter/'));
    expect(probed.some((u) => u.endsWith('Inter-Regular.ttf'))).toBe(true);
  });
});
