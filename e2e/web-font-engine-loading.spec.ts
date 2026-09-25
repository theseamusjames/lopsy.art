/**
 * Web fonts reaching the text engine and the path-text renderer (#841, #842,
 * #827, #823).
 *
 * Every font request is served from local fixtures via page.route so the
 * tests are deterministic and work offline: jsDelivr answers 404 (as it does
 * for families with no baked repo path, or files over its size limit), which
 * sends the loader down the Google Fonts css2 → WOFF2 path, and the css2 /
 * gstatic endpoints serve the latin subsets checked in under
 * engine-rs/crates/lopsy-wasm/tests/fixtures.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from './fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../engine-rs/crates/lopsy-wasm/tests/fixtures');
const SCREENSHOTS = path.resolve(__dirname, 'screenshots/web-font-engine-loading');

/** css2 family name → latin WOFF2 fixture served for it. */
const FONT_FIXTURES: Record<string, string> = {
  'IM Fell English': 'IMFellEnglish-latin.woff2',
  'IM Fell DW Pica SC': 'IMFellDWPicaSC-latin.woff2',
  Montserrat: 'Montserrat-wght-latin.woff2',
};

const CORS = { 'access-control-allow-origin': '*' };

function fixtureSlug(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Serve fonts offline. `gstaticDelayMs` holds the WOFF2 responses back so a
 * test can observe what is drawn while the face is still loading.
 */
async function serveFontsOffline(page: Page, gstaticDelayMs = 0): Promise<void> {
  await page.route('https://cdn.jsdelivr.net/**', (route) =>
    route.fulfill({ status: 404, headers: CORS, body: 'not found' }),
  );
  await page.route('https://fonts.googleapis.com/css2**', (route) => {
    const url = new URL(route.request().url());
    const css = url.searchParams
      .getAll('family')
      .map((spec) => {
        const [family = '', axes = ''] = spec.split(':');
        const weights = axes.startsWith('wght@') ? axes.slice(5).split(';') : ['400'];
        const file = FONT_FIXTURES[family];
        if (!file) return '';
        return weights
          .map(
            (weight) => `/* latin */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  src: url(https://fonts.gstatic.com/s/lopsy-test/${fixtureSlug(family)}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`,
          )
          .join('\n');
      })
      .join('\n');
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/css' }, body: css });
  });
  await page.route('https://fonts.gstatic.com/s/lopsy-test/**', async (route) => {
    const slug = route.request().url().split('/').pop()?.replace(/\.woff2$/, '') ?? '';
    const family = Object.keys(FONT_FIXTURES).find((f) => fixtureSlug(f) === slug);
    if (!family) return route.fulfill({ status: 404, headers: CORS, body: '' });
    if (gstaticDelayMs > 0) await new Promise((r) => setTimeout(r, gstaticDelayMs));
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'font/woff2' },
      body: fs.readFileSync(path.join(FIXTURES, FONT_FIXTURES[family]!)),
    });
  });
}

async function createDocument(page: Page, width = 600, height = 300) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, true);
    },
    { w: width, h: height },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2,
      };
    },
    { docX, docY },
  );
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function selectFont(page: Page, family: string) {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForTimeout(200);
}

async function waitForFontInEngine(page: Page, family: string) {
  await page.waitForFunction(
    (f) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
      return fn ? fn(f) : false;
    },
    family,
    { timeout: 20000 },
  );
  // The post-load refresh re-renders the layer asynchronously.
  await page.waitForTimeout(500);
}

async function commitTextLayer(page: Page, x: number, y: number, text: string): Promise<string> {
  await page.keyboard.press('t');
  await clickAtDoc(page, x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter'); // commit; the layer stays active
  await page.waitForTimeout(300);
  const id = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    return store.getState().document.layers.filter((l) => l.type === 'text').pop()?.id ?? null;
  });
  expect(id).not.toBeNull();
  return id!;
}

interface Coverage {
  /** Pixels with alpha > 127. */
  opaque: number;
  /** Order-sensitive hash of the alpha channel — changes when glyph shapes do. */
  hash: number;
}

async function layerCoverage(page: Page, layerId: string): Promise<Coverage> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await read(id);
    if (!result) return { opaque: 0, hash: 0 };
    let opaque = 0;
    let hash = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      const a = result.pixels[i] ?? 0;
      if (a > 127) opaque++;
      hash = (Math.imul(hash, 31) + a + result.width) | 0;
    }
    return { opaque, hash };
  }, layerId);
}

test.describe('web fonts in the text engine', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'font picker lives in the desktop options bar');
    await serveFontsOffline(page);
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page);
  });

  test('#841: a css2-only family (IM Fell English) renders from its WOFF2, not Inter', async ({ page }) => {
    const layerId = await commitTextLayer(page, 40, 150, 'Hamburgefonts');
    const inter = await layerCoverage(page, layerId);
    expect(inter.opaque).toBeGreaterThan(200);

    await selectFont(page, 'IM Fell English');
    await waitForFontInEngine(page, 'IM Fell English');
    await page.screenshot({ path: path.join(SCREENSHOTS, 'im-fell-english.png') });

    const fell = await layerCoverage(page, layerId);
    expect(fell.opaque).toBeGreaterThan(200);
    // IM Fell's old-style serif glyphs cover a clearly different area than
    // Inter's; an identical raster means the engine still drew Inter.
    expect(Math.abs(fell.opaque - inter.opaque) / inter.opaque).toBeGreaterThan(0.05);
    expect(fell.hash).not.toBe(inter.hash);
  });

  test('#842: IM Fell DW Pica SC (name table "IM FELL DW Pica SC") renders in its own face', async ({ page }) => {
    const layerId = await commitTextLayer(page, 40, 150, 'Hamburgefonts');
    const inter = await layerCoverage(page, layerId);

    await selectFont(page, 'IM Fell DW Pica SC');
    await waitForFontInEngine(page, 'IM Fell DW Pica SC');
    await page.screenshot({ path: path.join(SCREENSHOTS, 'im-fell-dw-pica-sc.png') });

    const sc = await layerCoverage(page, layerId);
    expect(sc.opaque).toBeGreaterThan(200);
    expect(Math.abs(sc.opaque - inter.opaque) / inter.opaque).toBeGreaterThan(0.05);
    expect(sc.hash).not.toBe(inter.hash);
  });

  test('#827: a variable Google font renders every requested weight', async ({ page }) => {
    const layerId = await commitTextLayer(page, 40, 150, 'HAMBURGEFONTS');
    const inter = await layerCoverage(page, layerId);

    await selectFont(page, 'Montserrat');
    await waitForFontInEngine(page, 'Montserrat');

    const weightSelect = page.locator('select[aria-label="Font weight"]');
    const coverage: Record<string, Coverage> = {};
    for (const weight of ['100', '400', '900']) {
      await weightSelect.selectOption(weight);
      await page.waitForTimeout(400);
      coverage[weight] = await layerCoverage(page, layerId);
    }
    await page.screenshot({ path: path.join(SCREENSHOTS, 'montserrat-black.png') });

    // Heavier weights put down substantially more ink. Before the fix every
    // weight but the default instance (Thin) fell back to Inter Regular, so
    // 400 and 900 rendered identically.
    expect(coverage['400']!.opaque).toBeGreaterThan(coverage['100']!.opaque * 1.3);
    expect(coverage['900']!.opaque).toBeGreaterThan(coverage['400']!.opaque * 1.3);
    expect(coverage['400']!.hash).not.toBe(inter.hash);
    expect(coverage['900']!.hash).not.toBe(inter.hash);
  });
});

test.describe('path-bound text with a web font (#823)', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'pen tool and font picker need the desktop UI');
    // Hold the WOFF2 back so the first path-text render happens while the
    // face is still loading, like on a real network.
    await serveFontsOffline(page, 1500);
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page);
  });

  test('re-renders in the real face once the family finishes loading', async ({ page }) => {
    // A straight open path across the document.
    await page.keyboard.press('p');
    await clickAtDoc(page, 40, 200);
    await clickAtDoc(page, 560, 200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const layerId = await commitTextLayer(page, 300, 120, 'Hamburgefonts on a path');
    await page.keyboard.press('t');
    const pathSelect = page.locator('select[aria-label="Text path"]');
    await expect(pathSelect).toBeVisible();
    await pathSelect.selectOption({ index: 1 });
    await page.waitForTimeout(300);

    await selectFont(page, 'IM Fell English');
    // Rendered while the face is still downloading: the fallback face.
    await page.waitForTimeout(300);
    const whileLoading = await layerCoverage(page, layerId);
    expect(whileLoading.opaque).toBeGreaterThan(100);

    await page.waitForFunction(() => document.fonts.check(`32px 'IM Fell English'`, 'Hamburgefonts'), undefined, {
      timeout: 20000,
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'path-text-im-fell.png') });
    const loaded = await layerCoverage(page, layerId);

    // The layer was redrawn with IM Fell English after it loaded. Without
    // the fix nothing invalidates the path-text cache and the fallback
    // raster stays forever.
    expect(loaded.opaque).toBeGreaterThan(100);
    expect(loaded.hash).not.toBe(whileLoading.hash);

    // And it matches what a from-scratch render with the loaded face gives:
    // nudging the path assignment off and on forces a fresh Canvas2D render.
    await pathSelect.selectOption({ index: 0 });
    await page.waitForTimeout(200);
    await pathSelect.selectOption({ index: 1 });
    await page.waitForTimeout(400);
    const fresh = await layerCoverage(page, layerId);
    expect(loaded.opaque).toBe(fresh.opaque);
  });
});
