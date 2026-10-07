/**
 * #1213 — after reopening a project, committing a group scale must leave
 * live text that starts with blank lines / leading spaces where the pending
 * preview showed it.
 *
 * The text layer's texture is trimmed to its ink, so its top-left sits far
 * from the layout anchor when the text opens with whitespace; the transform
 * recovers the anchor as `x − renderOffset`. A reopened document's web font
 * arrives after the overlay has already laid the text out with the Inter
 * fallback, and that layout (and the measured frame) stayed cached. The
 * offset then carried the fallback's space width while the saved pixels and
 * the commit's re-render use the real face, so the text jumped sideways by
 * the difference across every leading space.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  getEditorState,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';
import { findTransformHandle } from './text-edit-helpers';
import { serveFontsOffline } from './font-fixtures';

const FAMILY = 'Barlow Condensed';
const FONT_DELAY_MS = 4000;

const RECT = { x0: 100, y0: 100, x1: 1500, y1: 900 };

interface LayerRow {
  id: string;
  type: string;
}

interface Ink {
  count: number;
  minX: number;
  minY: number;
}

async function layerRows(page: Page): Promise<LayerRow[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: LayerRow[] } };
    };
    return store.getState().document.layers.map((l) => ({ id: l.id, type: l.type }));
  });
}

/** Document-space bounds of a layer's opaque pixels. */
async function ink(page: Page, layerId: string): Promise<Ink> {
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) <= 128) continue;
        count++;
        minX = Math.min(minX, x + layer.x);
        minY = Math.min(minY, y + layer.y);
      }
    }
    return { count, minX, minY };
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

async function isFontLoaded(page: Page, family: string): Promise<boolean> {
  return page.evaluate((f) => {
    const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
    return fn ? fn(f) : false;
  }, family);
}

async function clickRow(page: Page, layerId: string): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"] span[class*="name"]`).first().click();
  await page.waitForTimeout(100);
}

async function fillRect(page: Page): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, RECT.x0, RECT.y0);
  const end = await docToScreen(page, RECT.x1, RECT.y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await setForegroundColor(page, 160, 160, 160);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

/** Save, reload and reopen; the reopened document's font binary arrives late. */
async function saveAndReopen(page: Page, waitForId: string): Promise<void> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Save Project' }).click();
  const saved = readFileSync(await (await download).path());
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await serveFontsOffline(page, FONT_DELAY_MS);
  await page.reload();
  await waitForStore(page);
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open File")'),
  ]);
  await chooser.setFiles({ name: 'sheet.lopsy', mimeType: 'application/octet-stream', buffer: saved });
  await expect.poll(async () => (await layerRows(page)).some((l) => l.id === waitForId), { timeout: 30_000 }).toBe(true);
}

test.describe('#1213 group scale after reopening keeps whitespace-led text in place', { tag: '@chromium' }, () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layers panel and options bar need the desktop layout');
    await serveFontsOffline(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1600, 1000, true);
  });

  test('text that opens with blank lines and spaces stays where the preview put it', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = (await getEditorState(page)).document.activeLayerId;
    await page.locator('[aria-label="Add Layer"]').click();
    await fillRect(page);

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 48);
    const at = await docToScreen(page, 200, 200);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await page.keyboard.type(`${' '.repeat(40)}HELLO`);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const textId = (await layerRows(page)).find((l) => l.type === 'text')?.id;
    if (!textId) throw new Error('text layer not created');
    await clickRow(page, textId);
    await selectTool(page, 'text');
    await selectFont(page, FAMILY);
    await expect.poll(() => isFontLoaded(page, FAMILY), { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(500);

    const original = await ink(page, textId);
    expect(original.count).toBeGreaterThan(100);
    // The whitespace pushes the ink well right of and below the click.
    expect(original.minX).toBeGreaterThan(400);
    expect(original.minY).toBeGreaterThan(250);

    await saveAndReopen(page, textId);
    expect(await isFontLoaded(page, FAMILY)).toBe(false);
    // The Move tool's text handles lay the active text layer out every
    // frame — here before the font has arrived, so with the fallback face.
    await clickRow(page, textId);
    await selectTool(page, 'move');
    await page.waitForTimeout(300);
    await expect.poll(() => isFontLoaded(page, FAMILY), { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(500);
    const reopened = await ink(page, textId);
    expect(Math.abs(reopened.minX - original.minX)).toBeLessThan(2);
    expect(Math.abs(reopened.minY - original.minY)).toBeLessThan(2);

    // Scale the group by 0.9 about its top-left corner with the
    // bottom-right handle, then commit with ⌘D.
    await clickRow(page, groupId);
    await page.keyboard.press('Control+d');
    await selectTool(page, 'move');
    const handle = await findTransformHandle(page, 'bottom-right', { x: RECT.x1, y: RECT.y1 }, 10);
    const target = await docToScreen(page, RECT.x1 - 140, RECT.y1 - 80);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/screenshots/group-scale-reopened-text-1213.png' });

    const sx = (RECT.x1 - 140 - RECT.x0) / (RECT.x1 - RECT.x0);
    const sy = (RECT.y1 - 80 - RECT.y0) / (RECT.y1 - RECT.y0);
    const expectedX = RECT.x0 + (original.minX - RECT.x0) * sx;
    const expectedY = RECT.y0 + (original.minY - RECT.y0) * sy;
    const committed = await ink(page, textId);
    expect(committed.count).toBeGreaterThan(50);
    expect(Math.abs(committed.minX - expectedX)).toBeLessThan(8);
    expect(Math.abs(committed.minY - expectedY)).toBeLessThan(8);
  });
});
