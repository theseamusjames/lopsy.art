/**
 * #1328: when the jsDelivr TTF request stalls (never answers), the loader
 * must time out and fall back to the Google Fonts css2 API instead of
 * leaving the text in the bundled Inter forever.
 *
 * Fonts are served offline by serveFontsOffline; this spec then overrides
 * jsDelivr with a route that never responds.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { clickAtDoc } from './text-edit-helpers';
import { serveFontsOffline } from './font-fixtures';

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
}

async function layerAlphaHash(page: Page, layerId: string): Promise<{ opaque: number; hash: number }> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; pixels: number[] } | null>;
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

test.describe('font CDN stall (#1328)', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource|ERR_FAILED|NS_BINDING_ABORTED/] });

  test('a stalled jsDelivr request falls back to css2 and renders the chosen face', async ({ page, isMobile }) => {
    test.skip(isMobile, 'font picker lives in the desktop options bar');
    test.setTimeout(60_000);

    await serveFontsOffline(page);
    let stalledRequests = 0;
    await page.route('https://cdn.jsdelivr.net/**', () => {
      stalledRequests++;
      return new Promise<void>(() => {});
    });
    let css2Requests = 0;
    page.on('request', (req) => {
      if (req.url().includes('fonts.googleapis.com/css2') && req.url().includes('Montserrat')) css2Requests++;
    });

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 300, true);

    await page.keyboard.press('t');
    await clickAtDoc(page, 40, 150);
    await page.keyboard.type('HAMBURGEFONTS');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);
    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string }> } };
      };
      return store.getState().document.layers.filter((l) => l.type === 'text').pop()?.id ?? null;
    });
    expect(layerId).not.toBeNull();
    const inter = await layerAlphaHash(page, layerId!);
    expect(inter.opaque).toBeGreaterThan(200);

    await selectFont(page, 'Montserrat');

    await page.waitForFunction(
      (f) => {
        const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
        return fn ? fn(f) : false;
      },
      'Montserrat',
      { timeout: 30_000 },
    );
    await expect.poll(async () => (await layerAlphaHash(page, layerId!)).hash, { timeout: 5000 }).not.toBe(inter.hash);

    expect(stalledRequests).toBeGreaterThan(0);
    expect(css2Requests).toBeGreaterThan(0);
  });
});
