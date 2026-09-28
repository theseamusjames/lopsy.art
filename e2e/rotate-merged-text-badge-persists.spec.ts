/**
 * Regression test for #880: a rotation committed with ⌘D on a layer made by
 * Rasterize Layer → Merge Down must stay rotated after another layer's row
 * is clicked (which schedules the crop-on-leave of the rotated layer), both
 * on the presented canvas and in the layer's pixels.
 *
 * The web font is served offline with a delay so it lands mid-sequence, as
 * in a fresh tab — the reports hit most often on a first attempt.
 */
import { test, expect, type Page } from './fixtures';
import { serveFontsOffline } from './font-fixtures';
import { waitForStore, createDocument, selectTool, setForegroundColor, docToScreen, setToolOption } from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Quantised hash of the presented (screenshot) pixels over a doc-space rect. */
async function presentedHash(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ png, a, b }) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const d = ctx.getImageData(Math.round(a.x * k), Math.round(a.y * k), Math.round((b.x - a.x) * k), Math.round((b.y - a.y) * k)).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + (d[i]! >> 4) * 7 + (d[i + 1]! >> 4) * 3 + (d[i + 2]! >> 4)) | 0;
    return h;
  }, { png, a, b });
}

/** Doc-space positions of the dark (text) pixels on a layer, as a hash. */
async function textPixelsHash(page: Page, layerId: string): Promise<{ hash: number; count: number }> {
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    let hash = 0;
    let count = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        const i = (y * px.width + x) * 4;
        // Text is #1D4E57 on the #F2B233 disc: red channel well below the disc's.
        if ((px.pixels[i + 3] ?? 0) > 200 && (px.pixels[i] ?? 255) < 120) {
          count++;
          hash = (Math.imul(hash, 31) + (layer.x + x) * 4099 + (layer.y + y)) | 0;
        }
      }
    }
    return { hash, count };
  }, layerId);
}

test.use({ allowConsoleErrors: [/Failed to load resource/] });

test('a rotation committed on a rasterized-text + Merge Down layer survives the next row click', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel and transform handles need the desktop layout');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await serveFontsOffline(page, 2500);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1000, 1400, false);
  await page.waitForTimeout(300);

  // Badge disc on its own layer.
  await page.locator('[aria-label="Add Layer"]').click();
  await setForegroundColor(page, 0xf2, 0xb2, 0x33);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  await drag(page, 718, 113, 862, 257);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // Three lines of centred area text in a web font.
  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 26);
  await page.locator('select[aria-labelledby="text-align-label"]').selectOption('center');
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill('Montserrat');
  await page.locator('[role="option"]').filter({ hasText: /^Montserrat$/ }).first().click();
  await setForegroundColor(page, 0x1d, 0x4e, 0x57);
  await drag(page, 718, 128, 862, 168);
  await page.keyboard.type('HOT');
  await page.keyboard.press('Enter');
  await page.keyboard.type('OFF THE');
  await page.keyboard.press('Enter');
  await page.keyboard.type('SPIT');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);

  await page.getByRole('button', { name: 'Rasterize Layer' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Merge Down' }).click();
  await page.waitForTimeout(150);
  const badgeId = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { document: { activeLayerId: string } } };
    return s.getState().document.activeLayerId;
  });
  const upright = await textPixelsHash(page, badgeId);
  expect(upright.count).toBeGreaterThan(100);

  // Marquee around the badge, then drag the rotate handle (~20 doc px outside
  // the top-right corner) with the Move tool.
  await selectTool(page, 'marquee-rect');
  await drag(page, 700, 95, 880, 275);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
  const zoom = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { viewport: { zoom: number } } };
    return s.getState().viewport.zoom;
  });
  const corner = await docToScreen(page, 880, 95);
  const off = 20 * zoom;
  await page.mouse.move(corner.x + off, corner.y - off);
  await page.mouse.down();
  await page.mouse.move(corner.x + off + 14, corner.y - off + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const rotation = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { transform: { rotation: number } | null } };
    return ui.getState().transform?.rotation ?? 0;
  });
  expect(Math.abs(rotation)).toBeGreaterThan(0.1);

  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(400);
  const presentedAfterCommit = await presentedHash(page, 700, 95, 880, 275);
  const rotated = await textPixelsHash(page, badgeId);
  expect(rotated.hash).not.toBe(upright.hash);

  // Click another layer's row; the deferred crop-on-leave runs on idle
  // (≤ 500 ms) and the web font finishes landing meanwhile.
  const backgroundId = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    return s.getState().document.layers.find((l) => l.name === 'Background')!.id;
  });
  await page.locator(`[data-layer-id="${backgroundId}"]`).click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'e2e/screenshots/rotate-merged-text-badge-persists.png' });

  expect(await presentedHash(page, 700, 95, 880, 275)).toBe(presentedAfterCommit);
  const afterClick = await textPixelsHash(page, badgeId);
  expect(afterClick.hash).toBe(rotated.hash);
  expect(afterClick.hash).not.toBe(upright.hash);
});
