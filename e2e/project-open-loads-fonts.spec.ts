/**
 * Regression test for #962: opening a .lopsy never loaded the web fonts its
 * text layers use. The saved pixels looked right, but the first re-render
 * (a Size nudge, a re-edit) shaped with the engine's Inter fallback, because
 * nothing asked for the family's binary after the project loaded.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import { serveFontsOffline } from './font-fixtures';
import { waitForStore, createDocument, docToScreen, setToolOption, setActiveLayer } from './helpers';

const FAMILY = 'IM Fell English';

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForTimeout(200);
}

async function isFontLoaded(page: Page, family: string): Promise<boolean> {
  return page.evaluate((f) => {
    const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
    return fn ? fn(f) : false;
  }, family);
}

async function textLayer(page: Page): Promise<{ id: string; fontFamily: string; fontSize: number } | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; fontFamily?: string; fontSize?: number }> } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text');
    return l ? { id: l.id, fontFamily: l.fontFamily ?? '', fontSize: l.fontSize ?? 0 } : null;
  });
}

/** Opaque-pixel count of a layer — glyph coverage differs clearly between faces. */
async function coverage(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ pixels: number[] }>;
    const px = await read(id);
    let opaque = 0;
    for (let i = 3; i < px.pixels.length; i += 4) if ((px.pixels[i] ?? 0) > 127) opaque++;
    return opaque;
  }, layerId);
}

test.describe('opening a project', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test('loads its text layers\' web fonts so the next re-render keeps the face', async ({ page, isMobile }) => {
    test.skip(isMobile, 'font picker lives in the desktop options bar');
    await serveFontsOffline(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 300, true);
    await page.waitForTimeout(300);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 48);
    const at = await docToScreen(page, 40, 150);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.type('Hamburgefonts');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);
    const layer = (await textLayer(page))!;
    const interCoverage = await coverage(page, layer.id);

    await selectFont(page, FAMILY);
    await expect.poll(() => isFontLoaded(page, FAMILY), { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(500);
    const fellCoverage = await coverage(page, layer.id);
    // Sanity: the two faces are distinguishable by coverage.
    expect(Math.abs(fellCoverage - interCoverage) / interCoverage).toBeGreaterThan(0.1);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Save Project' }).click();
    const saved = readFileSync(await (await downloadPromise).path());

    // A fresh session: nothing is in the engine's font database.
    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
    expect(await isFontLoaded(page, FAMILY)).toBe(false);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('button:has-text("Open File")'),
    ]);
    await chooser.setFiles({ name: 'fonts.lopsy', mimeType: 'application/octet-stream', buffer: saved });
    await expect.poll(async () => (await textLayer(page))?.id ?? null, { timeout: 30_000 }).toBe(layer.id);

    // The bug: this stayed false forever after the project opened.
    await expect.poll(() => isFontLoaded(page, FAMILY), { timeout: 20_000 }).toBe(true);

    // Nudge Size so the layer re-renders from its properties.
    await setActiveLayer(page, layer.id);
    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 49);
    await expect.poll(async () => (await textLayer(page))?.fontSize).toBe(49);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/project-open-loads-fonts.png' });

    // 48 → 49 px grows coverage by ~4%; a fallback to Inter would land near
    // Inter's coverage instead.
    const nudged = await coverage(page, layer.id);
    expect(Math.abs(nudged - fellCoverage) / fellCoverage).toBeLessThan(0.08);
    expect(Math.abs(nudged - fellCoverage)).toBeLessThan(Math.abs(nudged - interCoverage));
  });
});
