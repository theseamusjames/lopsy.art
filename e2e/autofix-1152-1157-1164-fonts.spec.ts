/**
 * #1152 — Style on a committed text layer loads the face it switches to.
 * #1157 — glyphs an italic face lacks fall back instead of drawing NO GLYPH boxes.
 * #1164 — the same for a condensed face (Barlow Condensed).
 *
 * Fonts are served offline from the fixtures in
 * engine-rs/crates/lopsy-wasm/tests/fixtures (see font-fixtures.ts).
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from './fixtures';
import { serveFontsOffline } from './font-fixtures';
import { waitForStore, createDocument, getEditorState, docToScreen, setToolOption } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.resolve(__dirname, 'screenshots');

interface Raster {
  width: number;
  height: number;
  /** Pixels with alpha > 127. */
  opaque: number;
  /** Order-sensitive hash of the alpha channel — changes when glyph shapes do. */
  hash: number;
}

async function layerRaster(page: Page, layerId: string): Promise<Raster> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await read(id);
    if (!result) return { width: 0, height: 0, opaque: 0, hash: 0 };
    let opaque = 0;
    let hash = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      const a = result.pixels[i] ?? 0;
      if (a > 127) opaque++;
      hash = (Math.imul(hash, 31) + a + result.width) | 0;
    }
    return { width: result.width, height: result.height, opaque, hash };
  }, layerId);
}

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForTimeout(200);
}

async function waitForFontInEngine(page: Page, family: string): Promise<void> {
  await page.waitForFunction(
    (f) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
      return fn ? fn(f) : false;
    },
    family,
    { timeout: 20000 },
  );
  // The post-load refresh re-renders text asynchronously.
  await page.waitForTimeout(500);
}

/** Click at a doc point with the Text tool, type, and commit with Tab. */
async function typeText(page: Page, docX: number, docY: number, text: string): Promise<string> {
  const before = new Set((await getEditorState(page)).document.layers.map((l) => l.id));
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const layer = (await getEditorState(page)).document.layers.find((l) => !before.has(l.id));
  if (!layer) throw new Error('typing did not create a text layer');
  return layer.id;
}

/** Make the Background layer active so the options bar sets up the next text layer. */
async function selectBackground(page: Page): Promise<void> {
  const bg = (await getEditorState(page)).document.layers.find((l) => l.name === 'Background');
  if (!bg) throw new Error('no Background layer');
  await page.locator(`[data-layer-id="${bg.id}"]`).click();
}

function fontStyleSelect(page: Page) {
  return page.locator('role=toolbar >> select[aria-label="Font style"]');
}

test.describe('Style on a committed text layer (#1152)', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options require the desktop layout');
    await serveFontsOffline(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1400, 400, true);
  });

  test('Normal → Italic loads the italic face, as one undoable step', async ({ page }) => {
    const italicFetches: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/lopsy-test/im-fell-english-italic.woff2')) italicFetches.push(req.url());
    });

    await page.keyboard.press('t');
    await selectFont(page, 'IM Fell English');
    await waitForFontInEngine(page, 'IM Fell English');
    await setToolOption(page, 'Size', 60);
    const layerId = await typeText(page, 60, 200, 'Callipepla californica');
    const upright = await layerRaster(page, layerId);
    expect(upright.opaque).toBeGreaterThan(1000);
    const undoBefore = (await getEditorState(page)).undoStackLength;

    await fontStyleSelect(page).selectOption('italic');

    // The engine fetches the italic face and re-renders the layer with it.
    await expect.poll(() => italicFetches.length, { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await layerRaster(page, layerId)).hash, { timeout: 15000 }).not.toBe(upright.hash);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'text-style-italic-committed.png') });

    const italic = await layerRaster(page, layerId);
    // IM Fell's italic is a distinct, narrower design: a clearly different
    // amount of ink, not a re-render of the same upright glyphs.
    expect(Math.abs(italic.opaque - upright.opaque) / upright.opaque).toBeGreaterThan(0.03);
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore + 1);

    // One undo brings the upright raster back.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await layerRaster(page, layerId)).hash, { timeout: 5000 }).toBe(upright.hash);
  });

  test('Italic → Normal loads the upright face', async ({ page }) => {
    await page.keyboard.press('t');
    await fontStyleSelect(page).selectOption('italic');
    await selectFont(page, 'IM Fell English');
    await waitForFontInEngine(page, 'IM Fell English');
    await setToolOption(page, 'Size', 60);
    const layerId = await typeText(page, 60, 200, 'Callipepla californica');
    const italic = await layerRaster(page, layerId);
    expect(italic.opaque).toBeGreaterThan(1000);

    await fontStyleSelect(page).selectOption('normal');
    await expect.poll(async () => (await layerRaster(page, layerId)).hash, { timeout: 15000 }).not.toBe(italic.hash);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS, 'text-style-normal-committed.png') });

    // Reference: the same text typed upright from the start.
    await selectBackground(page);
    const refId = await typeText(page, 60, 320, 'Callipepla californica');
    const reference = await layerRaster(page, refId);
    const upright = await layerRaster(page, layerId);
    expect(Math.abs(upright.opaque - reference.opaque) / reference.opaque).toBeLessThan(0.02);
    expect(Math.abs(upright.opaque - italic.opaque) / italic.opaque).toBeGreaterThan(0.03);
  });
});

/**
 * Type `text` once in the default face (Inter, which has the symbols) and once
 * in `family`/`style`, which lacks them. With per-glyph fallback the second
 * layer's symbols come from Inter too, so both layers carry about the same
 * ink; NO GLYPH boxes in their place carry a very different amount.
 */
async function compareWithInter(
  page: Page,
  family: string,
  style: 'normal' | 'italic',
  text: string,
  screenshot: string,
): Promise<{ inter: Raster; styled: Raster }> {
  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 80);
  const interId = await typeText(page, 60, 120, text);

  await selectBackground(page);
  await selectFont(page, family);
  await fontStyleSelect(page).selectOption(style);
  await waitForFontInEngine(page, family);
  const styledId = await typeText(page, 60, 300, text);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENSHOTS, screenshot) });

  return { inter: await layerRaster(page, interId), styled: await layerRaster(page, styledId) };
}

test.describe('per-glyph fallback across style and width (#1157, #1164)', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options require the desktop layout');
    await serveFontsOffline(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 900, 400, true);
  });

  test('#1157: ★ and → in italic IM Fell English come from the fallback face', async ({ page }) => {
    const { inter, styled } = await compareWithInter(page, 'IM Fell English', 'italic', '★→★', 'text-fallback-italic.png');
    expect(inter.opaque).toBeGreaterThan(1500);
    expect(Math.abs(styled.opaque - inter.opaque) / inter.opaque).toBeLessThan(0.05);
  });

  test('#1164: ⅓ ★ → in Barlow Condensed come from the fallback face', async ({ page }) => {
    const { inter, styled } = await compareWithInter(page, 'Barlow Condensed', 'normal', '⅓★→', 'text-fallback-condensed.png');
    expect(inter.opaque).toBeGreaterThan(1500);
    expect(Math.abs(styled.opaque - inter.opaque) / inter.opaque).toBeLessThan(0.05);
  });
});
