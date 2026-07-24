import { test, expect, type Page } from './fixtures';

async function createDocument(page: Page, width = 600, height = 500) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
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

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function selectFont(page: Page, fontFamily: string) {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.waitForTimeout(150);

  const searchInput = page.locator('input[aria-label="Search fonts"]');
  await searchInput.fill(fontFamily);
  await page.waitForTimeout(300);

  const byImage = page.locator('[role="option"]').filter({ has: page.locator(`img[alt="${fontFamily}"]`) });
  await page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 });

  const imageCount = await byImage.count();
  const fontItem = imageCount > 0
    ? byImage.first()
    : page.locator('[role="option"]').filter({ hasText: new RegExp(`^${fontFamily}`) }).first();
  await fontItem.click();
  await page.waitForTimeout(200);
}

async function waitForFontInEngine(page: Page, fontFamily: string, timeoutMs = 20000) {
  await page.waitForFunction(
    (family) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as
        ((f: string) => boolean) | undefined;
      return fn ? fn(family) : false;
    },
    fontFamily,
    { timeout: timeoutMs },
  );
}

async function countOpaquePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i] ?? 0) > 10) count++;
    }
    return count;
  }, layerId);
}

async function getTextLayers(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{
            id: string;
            type: string;
            name: string;
            visible: boolean;
            fontFamily?: string;
          }>;
        };
      };
    };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({
        id: l.id,
        name: l.name,
        fontFamily: l.fontFamily ?? 'unknown',
      }));
  });
}

test.describe('WOFF2 TrueType font rendering', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource.*403/, /WOFF2 decode failed/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 600, 500);
    await page.keyboard.press('t');
  });

  test('Bebas Neue (TrueType WOFF2) renders distinct glyphs, not Inter fallback', async ({ page }) => {
    // Create one committed text layer in Inter and measure its footprint.
    // (Since #690, picking a font in the options bar re-styles the selected
    // committed text layer in place, so we compare the same layer before and
    // after the font swap rather than juggling two layers — two layers would
    // both end up Bebas once the font is applied to the active one.)
    await clickAtDoc(page, 300, 200);
    await page.keyboard.type('HELLO');
    await page.keyboard.press('Shift+Enter'); // commit; layer stays active
    await page.waitForTimeout(300);

    const interLayers = await getTextLayers(page);
    expect(interLayers.length).toBe(1);
    const layerId = interLayers[0]!.id;

    const interCount = await countOpaquePixels(page, layerId);
    expect(interCount).toBeGreaterThan(50);

    // Swap the committed, still-active layer to Bebas Neue — a TrueType font that
    // requires WOFF2 glyf-transform decoding.
    await selectFont(page, 'Bebas Neue');
    await waitForFontInEngine(page, 'Bebas Neue');
    await page.waitForTimeout(600); // allow the async post-load re-render

    // The layer's font family must have actually switched to Bebas Neue.
    const afterLayers = await getTextLayers(page);
    expect(afterLayers.length).toBe(1);
    expect(afterLayers[0]!.fontFamily).toContain('Bebas Neue');

    await page.screenshot({ path: 'e2e/screenshots/woff2-bebas-neue-vs-inter.png' });

    const bebasCount = await countOpaquePixels(page, layerId);
    expect(bebasCount).toBeGreaterThan(50);

    // Bebas Neue is a condensed display font — its pixel footprint should differ
    // meaningfully from Inter. If they're identical, the WOFF2 decoder failed
    // and the engine fell back to Inter.
    expect(interCount).not.toBe(bebasCount);
  });

});
