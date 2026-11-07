/**
 * #1527 — rotated live text came back soft after Save / Open Project.
 *
 * Turning text with the Move tool's shared box (the text layer and another
 * layer selected) leaves the transform live after the release: the text is
 * shown resampled from its upright pixels until the session is baked, which
 * re-renders it sharp from its props. Save Project and Quick Export read the
 * layers without baking, so the file held the resampled glyphs while the
 * text's stored transform said "re-render me sharp" — any later re-render
 * (Image → Rotate 90° CW then CCW) changed it.
 *
 * Saving and exporting now bake the session first, so the saved text, the
 * export and a re-render after reopening are the same pixels.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';
import { findTransformHandle } from './text-edit-helpers';

interface LayerPixels { id: string; x: number; y: number; width: number; height: number; pixels: number[] }

async function layerIdByName(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    return store.getState().document.layers.find((l) => l.name === n)!.id;
  }, name);
}

async function textLayerPixels(page: Page): Promise<LayerPixels | null> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text');
    if (!l) return null;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const px = await read(l.id);
    if (!px) return null;
    return { id: l.id, x: l.x, y: l.y, width: px.width, height: px.height, pixels: Array.from(px.pixels) };
  });
}

async function clickRow(page: Page, layerId: string, modifiers: Array<'Meta'> = []): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"] span[class*="name"]`).first().click({ modifiers });
  await page.waitForTimeout(100);
}

async function fileMenu(page: Page, item: string): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  return readFileSync(await (await download).path());
}

/** RGBA of an exported PNG inside `rect`, decoded in the page. */
async function exportedRegion(
  page: Page,
  png: Buffer,
  rect: { x: number; y: number; width: number; height: number },
): Promise<number[]> {
  return page.evaluate(async ({ b64, rect }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    return Array.from(ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data);
  }, { b64: png.toString('base64'), rect });
}

function countDiffs(a: readonly number[], b: readonly number[]): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 2) n++;
  return n;
}

function expectSamePixels(a: LayerPixels, b: LayerPixels): void {
  expect({ x: b.x, y: b.y, width: b.width, height: b.height }).toEqual({ x: a.x, y: a.y, width: a.width, height: a.height });
  expect(countDiffs(a.pixels, b.pixels)).toBe(0);
}

async function rotateImageRoundTrip(page: Page): Promise<void> {
  for (const dir of ['CW', 'CCW']) {
    await page.getByRole('button', { name: 'Image' }).click();
    await page.getByRole('menuitem', { name: `Rotate 90° ${dir}`, exact: true }).click();
    await page.waitForTimeout(300);
  }
}

test('rotated text saves, exports and reopens as sharp as a re-render (#1527)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Layers panel multi-select and transform handles need the desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);

  await clickRow(page, await layerIdByName(page, 'Background'));
  await setForegroundColor(page, 0x1b, 0x13, 0x40);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();

  const layer1 = await layerIdByName(page, 'Layer 1');
  await clickRow(page, layer1);
  await setForegroundColor(page, 0xe8, 0xff, 0x3a);
  await selectTool(page, 'text');
  await setToolOption(page, 'Size', 24);
  const at = await docToScreen(page, 100, 120);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  await page.keyboard.type('RAIN SURGE 1.4');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const upright = (await textLayerPixels(page))!;
  expect(upright.width).toBeGreaterThan(100);

  // A second layer for the shared box: a small filled marquee on Layer 1.
  await clickRow(page, layer1);
  await page.keyboard.press('m');
  const m0 = await docToScreen(page, 110, 160);
  const m1 = await docToScreen(page, 170, 190);
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m1.x, m1.y, { steps: 5 });
  await page.mouse.up();
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  await clickRow(page, upright.id);
  await clickRow(page, layer1, ['Meta']);
  await selectTool(page, 'move');

  // Turn the box ~7° counter-clockwise with its top-right rotate handle and
  // release — no Enter or Escape, so the transform stays live.
  const handle = await findTransformHandle(
    page, 'rotate-top-right', { x: upright.x + upright.width + 10, y: upright.y - 10 }, 30,
  );
  const pivot = await docToScreen(page, upright.x + upright.width / 2, (upright.y + 190) / 2);
  const radius = Math.hypot(handle.x - pivot.x, handle.y - pivot.y);
  const from = Math.atan2(handle.y - pivot.y, handle.x - pivot.x);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    const a = from - ((7 * Math.PI) / 180) * (i / 8);
    await page.mouse.move(pivot.x + radius * Math.cos(a), pivot.y + radius * Math.sin(a));
  }
  await page.mouse.up();
  await page.waitForTimeout(300);

  const exportA = await fileMenu(page, 'Quick Export PNG');
  await page.waitForTimeout(200);
  const saved = await fileMenu(page, 'Save Project');
  const atSave = (await textLayerPixels(page))!;

  await page.reload();
  await waitForStore(page);
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open File")'),
  ]);
  await chooser.setFiles({ name: 'rotated-text.lopsy', mimeType: 'application/octet-stream', buffer: saved });
  await expect.poll(async () => (await textLayerPixels(page))?.id ?? null, { timeout: 30_000 }).toBe(upright.id);
  await page.waitForTimeout(500);
  const reopened = (await textLayerPixels(page))!;
  expectSamePixels(atSave, reopened);
  const exportB = await fileMenu(page, 'Quick Export PNG');

  // A re-render from the text's props: it used to come back sharper (and at
  // a different size) than what the file held.
  await rotateImageRoundTrip(page);
  const rerendered = (await textLayerPixels(page))!;
  await page.screenshot({ path: 'e2e/screenshots/text-rotate-reopen-1527.png' });
  expectSamePixels(reopened, rerendered);
  const exportC = await fileMenu(page, 'Quick Export PNG');

  const region = { x: 80, y: 90, width: 240, height: 90 };
  const pngA = await exportedRegion(page, exportA, region);
  const pngB = await exportedRegion(page, exportB, region);
  const pngC = await exportedRegion(page, exportC, region);
  expect(countDiffs(pngA, pngB)).toBe(0);
  expect(countDiffs(pngB, pngC)).toBe(0);
});
