/**
 * The Photonamous ⇄ Lopsy round trip with both apps running (spec 5.6,
 * 6.12). Run it with its own config, which starts both dev servers:
 *
 *   npx playwright test -c e2e/roundtrip.config.ts
 *
 * Photonamous keeps its library in this browser. A generated JPEG is imported,
 * sent to Lopsy with "Edit in Lopsy", inverted there through Lopsy's
 * Filter menu and saved back; the document joins the library with a
 * preview. Reopening that document in Lopsy and saving again updates it
 * in place.
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

test.skip(!process.env.LOPSY_ROUNDTRIP, 'needs both apps running: npx playwright test -c e2e/roundtrip.config.ts');

const PHOTO_NAME = 'roundtrip';

/** A 320x240 JPEG drawn in the page: dark left, light right, so an inversion is easy to see. */
async function makeJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(320, 240);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(0, 0, 160, 240);
    ctx.fillStyle = '#e0c090';
    ctx.fillRect(160, 0, 160, 240);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(base64, 'base64');
}

/** Left-half brightness of a tile's preview: dark in the photo, light once inverted. */
async function tileLeftBrightness(tile: Locator): Promise<number> {
  const img = tile.locator('img');
  await expect(img).toBeVisible();
  return img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(el, 0, 0);
    const data = ctx.getImageData(0, 0, Math.floor(w / 3), h).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    return sum / (data.length / 4);
  });
}

async function startLibraryInThisBrowser(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByRole('button', { name: /Import photos/ }).first()).toBeVisible();
}

async function importPhoto(page: Page, jpeg: Buffer): Promise<Locator> {
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: /Choose photos/ }).click(),
  ]);
  await chooser.setFiles({ name: `${PHOTO_NAME}.jpg`, mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('button', { name: 'Import 1 photo' }).click();
  const tile = page.locator(`[role="gridcell"][title="${PHOTO_NAME}.jpg"]`);
  await expect(tile).toBeVisible({ timeout: 60_000 });
  await expect(tile.locator('img')).toBeVisible({ timeout: 60_000 });
  return tile;
}

/** Selects a tile and clicks Edit in Lopsy; returns Lopsy's tab once its handoff bar shows `name`. */
async function editInLopsy(page: Page, context: BrowserContext, tile: Locator, name: string, lopsy?: Page): Promise<Page> {
  await tile.click();
  // The grid toolbar's More menu: "Edit in Lopsy, with layers, painting and text".
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const button = page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Edit in Lopsy/ });
  let editor: Page;
  if (lopsy) {
    // The named target reuses Lopsy's tab: it navigates rather than opening a new one.
    await button.click();
    editor = lopsy;
  } else {
    [editor] = await Promise.all([context.waitForEvent('page'), button.click()]);
  }
  await editor.waitForLoadState();
  const bar = editor.getByRole('region', { name: 'Photonamous' });
  await expect(bar).toContainText(`From Photonamous: ${name}`, { timeout: 120_000 });
  return editor;
}

async function invertInLopsy(lopsy: Page): Promise<void> {
  await lopsy.getByRole('button', { name: 'Filter' }).click();
  await lopsy.getByRole('menuitem', { name: 'Invert', exact: true }).click();
}

async function saveToPhotos(lopsy: Page): Promise<void> {
  const bar = lopsy.getByRole('region', { name: 'Photonamous' });
  await bar.getByRole('button', { name: 'Save to Photonamous' }).click();
  await expect(bar.getByRole('status')).toHaveText('Saved to Photonamous', { timeout: 120_000 });
}

test('a photo goes to Lopsy and comes back as a document, then updates in place', async ({ page, context }) => {
  await startLibraryInThisBrowser(page);
  const photoTile = await importPhoto(page, await makeJpeg(page));
  const photoLeft = await tileLeftBrightness(photoTile);
  expect(photoLeft).toBeLessThan(80);

  // Photonamous → Lopsy: the photo opens as a document named after it.
  const lopsy = await editInLopsy(page, context, photoTile, PHOTO_NAME);
  await expect(lopsy.getByRole('dialog', { name: 'New Document' })).toBeHidden();
  const size = await lopsy.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { document: { width: number; height: number; name: string } } } }).__editorStore;
    const { width, height, name } = store.getState().document;
    return { width, height, name };
  });
  expect(size).toEqual({ width: 320, height: 240, name: PHOTO_NAME });

  // A visible edit through Lopsy's menus, then save.
  await invertInLopsy(lopsy);
  await saveToPhotos(lopsy);
  await lopsy.screenshot({ path: 'test-results/roundtrip-lopsy-saved.png' });

  // Back in Photonamous: the document is in the library, beside the photo, with an inverted preview.
  const docTile = page.locator(`[role="gridcell"][title="${PHOTO_NAME}.lopsy"]`);
  await page.bringToFront();
  await page.getByRole('button', { name: /All photos/ }).click();
  await expect(photoTile).toBeVisible();
  // It is stacked behind the photo it was made from: the photo's badge opens the stack.
  const stackBadge = photoTile.getByRole('button', { name: '1 Lopsy document', exact: true });
  await expect(stackBadge).toBeVisible({ timeout: 60_000 });
  await stackBadge.click();
  await expect(docTile).toHaveCount(1, { timeout: 60_000 });
  await expect(docTile.locator('img')).toBeVisible({ timeout: 60_000 });
  const docLeft = await tileLeftBrightness(docTile);
  expect(docLeft).toBeGreaterThan(photoLeft + 100);
  await page.screenshot({ path: 'test-results/roundtrip-photos-document.png' });
  const firstSrc = await docTile.locator('img').getAttribute('src');

  // Reopen the document in Lopsy: it arrives as the .lopsy, inverted already.
  await editInLopsy(page, context, docTile, PHOTO_NAME, lopsy);
  // Invert again (back to the photo's look) and save: the same document updates.
  await invertInLopsy(lopsy);
  await saveToPhotos(lopsy);

  await page.bringToFront();
  await expect(docTile).toHaveCount(1);
  await expect(page.locator('[role="gridcell"][title$=".lopsy"]')).toHaveCount(1);
  await expect.poll(async () => docTile.locator('img').getAttribute('src'), { timeout: 60_000 }).not.toBe(firstSrc);
  await expect.poll(async () => tileLeftBrightness(docTile), { timeout: 60_000 }).toBeLessThan(80);
});

/** A layer's pixel in Lopsy, read back from the engine (as Lopsy's own e2e helpers do). */
async function lopsyPixel(lopsy: Page, x: number, y: number, layerId: string): Promise<number[]> {
  return lopsy.evaluate(
    async ({ x, y, layerId }) => {
      const read = (window as unknown as { __readLayerPixels: (id: string) => Promise<{ width: number; pixels: number[] }> }).__readLayerPixels;
      const { width, pixels } = await read(layerId);
      const i = (y * width + x) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!];
    },
    { x, y, layerId },
  );
}

test('a Lopsy layer is graded in Photonamous and comes back as one undoable step', async ({ page, context }) => {
  const lopsyUrl = process.env.ROUNDTRIP_LOPSY_URL ?? 'http://localhost:5173/';
  await page.goto(lopsyUrl);
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  await page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { createDocument: (w: number, h: number, t: boolean) => void } } }).__editorStore;
    store.getState().createDocument(160, 120, false);
  });
  const bgId = await page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { document: { layers: Array<{ id: string; name: string }> } } } }).__editorStore;
    return store.getState().document.layers.find((l) => l.name === 'Background')!.id;
  });
  await expect.poll(() => lopsyPixel(page, 20, 20, bgId)).toEqual([255, 255, 255, 255]);

  // Lopsy → Photonamous: the layer opens in Photonamous' Edit view, with no library.
  await page.locator(`[data-layer-id="${bgId}"]`).click({ button: 'right' });
  const [photos] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Grade in Photonamous…' }).click(),
  ]);
  await photos.waitForURL(/grade=/);
  await expect(photos.getByTestId('edit-view')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  await expect(photos.getByRole('heading', { name: 'Where should your library live?' })).toHaveCount(0);

  // Darken it: Exposure -1.
  const exposure = photos.getByLabel('Exposure value');
  await exposure.fill('-1');
  await exposure.press('Enter');
  await expect(exposure).toHaveValue('−1.00');
  await photos.screenshot({ path: 'test-results/roundtrip-grade-photos.png' });
  await Promise.all([photos.waitForEvent('close', { timeout: 60_000 }), photos.getByRole('button', { name: 'Done' }).click()]);

  // Photonamous → Lopsy: the layer is darker, as one history step, and undo restores it.
  await expect.poll(() => lopsyPixel(page, 20, 20, bgId).then((p) => p[0]!), { timeout: 60_000 }).toBeLessThan(200);
  const graded = await lopsyPixel(page, 20, 20, bgId);
  expect(graded[3]).toBe(255);
  const state = await page.evaluate((id) => {
    const store = (window as unknown as {
      __editorStore: {
        getState: () => {
          document: { layers: Array<{ id: string; gradeRecipe?: { tone?: { exposure?: number } } }> };
          undoStack: Array<{ label?: string }>;
        };
      };
    }).__editorStore;
    const s = store.getState();
    return { label: s.undoStack.at(-1)?.label, exposure: s.document.layers.find((l) => l.id === id)?.gradeRecipe?.tone?.exposure };
  }, bgId);
  expect(state).toEqual({ label: 'Grade in Photonamous', exposure: -1 });
  await page.screenshot({ path: 'test-results/roundtrip-grade-lopsy.png' });

  await page.locator('[data-testid="canvas-container"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => lopsyPixel(page, 20, 20, bgId)).toEqual([255, 255, 255, 255]);
});
