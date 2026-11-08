/**
 * #1457: after Open Project in a fresh page, undoing the bottom "New
 * Document" entry re-rendered text-on-path in a fallback face.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

interface PathTextSnapshot { id: string; pathId?: string; fontFamily: string; opaque: number; sum: number }

async function pathText(page: Page): Promise<PathTextSnapshot | null> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; pathId?: string; fontFamily?: string }> } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text' && x.pathId);
    if (!l) return null;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(l.id);
    let opaque = 0;
    let sum = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        const a = px.pixels[(y * px.width + x) * 4 + 3] ?? 0;
        if (a > 127) { opaque++; sum += x * 7 + y * 13; }
      }
    }
    return { id: l.id, pathId: l.pathId, fontFamily: l.fontFamily ?? '', opaque, sum };
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(80);
}

async function selectFont(page: Page, fontFamily: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(fontFamily);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${fontFamily}`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
}

async function undoDepth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: unknown[] };
    };
    return store.getState().undoStack.length;
  });
}

// The engine's font-binary fetch may fail offline; the Canvas2D path render
// only needs the stylesheet face.
test.use({ allowConsoleErrors: [/Failed to load resource/] });

test('undoing the opened project\'s first entry keeps path text in its web font', async ({ page, isMobile }) => {
  test.skip(isMobile, 'text options bar Path dropdown requires desktop viewport');
  test.setTimeout(120_000);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 800, false);

  await page.keyboard.press('p');
  await clickAtDoc(page, 100, 500);
  await clickAtDoc(page, 300, 250);
  await clickAtDoc(page, 500, 200);
  await clickAtDoc(page, 700, 350);
  await page.locator('button[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);

  await page.keyboard.press('t');
  await selectFont(page, 'Anton');
  await clickAtDoc(page, 60, 60);
  await page.keyboard.type('VRRRRRRR-ROOOOOOOOM!');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const pathId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ id: string }> };
    };
    return store.getState().paths[0]?.id ?? null;
  });
  expect(pathId).not.toBeNull();
  await page.locator('[aria-label="Text path"]').selectOption(pathId!);
  await expect.poll(async () => (await pathText(page))?.pathId).toBe(pathId);
  await page.waitForTimeout(1500);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Save Project' }).click();
  const saved = readFileSync(await (await downloadPromise).path());

  await page.reload();
  await waitForStore(page);
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open File")'),
  ]);
  await chooser.setFiles({ name: 'path-text.lopsy', mimeType: 'application/octet-stream', buffer: saved });
  await expect.poll(async () => (await pathText(page))?.pathId ?? null, { timeout: 30_000 }).toBe(pathId);
  await page.waitForTimeout(3000);
  const opened = (await pathText(page))!;
  expect(opened.fontFamily).toMatch(/Anton/);

  await expect.poll(() => undoDepth(page)).toBe(1);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => undoDepth(page)).toBe(0);
  await page.waitForTimeout(3000);

  const undone = (await pathText(page))!;
  expect(undone.opaque).toBe(opened.opaque);
  expect(undone.sum).toBe(opened.sum);
});
