/**
 * Regression test for #966: Save Project dropped a text layer's path binding
 * (`pathId` / `prePathX` / `prePathY`). The reopened layer still showed its
 * saved curved raster, but the first re-render drew it as a straight line.
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, setActiveLayer, setToolOption } from './helpers';

interface TextInfo { id: string; pathId?: string; width: number; height: number; fontSize: number }

async function textLayer(page: Page): Promise<TextInfo | null> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; pathId?: string; fontSize?: number }> } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text');
    if (!l) return null;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(l.id);
    // Opaque-content bounds: a straight run of text is short and wide; the
    // same text laid along the arc spans far more rows.
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 127) {
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        }
      }
    }
    return {
      id: l.id,
      pathId: l.pathId,
      width: maxX >= minX ? maxX - minX + 1 : 0,
      height: maxY >= minY ? maxY - minY + 1 : 0,
      fontSize: l.fontSize ?? 0,
    };
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(80);
}

test('a text-on-path layer stays bound to its path after Save / Open Project', async ({ page, isMobile }) => {
  test.skip(isMobile, 'text options bar Path dropdown requires desktop viewport');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);

  // A smooth arch with the pen tool.
  await page.keyboard.press('p');
  await clickAtDoc(page, 100, 300);
  await clickAtDoc(page, 300, 100);
  await clickAtDoc(page, 500, 300);
  await page.locator('button[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);
  const pathId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ id: string }> };
    };
    return store.getState().paths[0]?.id ?? null;
  });
  expect(pathId).not.toBeNull();

  await page.keyboard.press('t');
  await clickAtDoc(page, 40, 40);
  await page.keyboard.type('AROUND THE ARCH AROUND THE ARCH');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  await page.locator('[aria-label="Text path"]').selectOption(pathId!);
  await page.waitForTimeout(300);
  const bound = (await textLayer(page))!;
  expect(bound.pathId).toBe(pathId);
  // Laid along the arch the glyphs span well over 100 rows.
  expect(bound.height).toBeGreaterThan(100);

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
  await chooser.setFiles({ name: 'text-on-path.lopsy', mimeType: 'application/octet-stream', buffer: saved });
  await expect.poll(async () => (await textLayer(page))?.id ?? null, { timeout: 30_000 }).toBe(bound.id);

  const reopened = (await textLayer(page))!;
  // The bug: pathId came back undefined.
  expect(reopened.pathId).toBe(pathId);

  // The options bar shows the binding, and a re-render keeps the text on the arch.
  await setActiveLayer(page, bound.id);
  await page.keyboard.press('t');
  await expect(page.locator('[aria-label="Text path"]')).toHaveValue(pathId!);
  await setToolOption(page, 'Size', bound.fontSize + 2);
  await expect.poll(async () => (await textLayer(page))?.fontSize).toBe(bound.fontSize + 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/project-save-text-on-path.png' });

  const edited = (await textLayer(page))!;
  expect(edited.pathId).toBe(pathId);
  // A straight line of this text at this size is ~30 px tall.
  expect(edited.height).toBeGreaterThan(100);
});
