/**
 * #1086: default path names came from a session counter that Open Project
 * never advanced, so the first Pen path after reopening a project was named
 * "Path 1" again, next to the loaded "Path 1".
 */
import { readFileSync } from 'fs';
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

async function pathNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ name: string }> };
    };
    return store.getState().paths.map((p) => p.name);
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(80);
}

async function penPath(page: Page, y: number): Promise<void> {
  await page.keyboard.press('p');
  await clickAtDoc(page, 100, y);
  await clickAtDoc(page, 300, y + 40);
  await clickAtDoc(page, 500, y);
  await page.locator('button[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);
}

test('a Pen path after Open Project numbers past the loaded paths', async ({ page, isMobile }) => {
  test.skip(isMobile, 'pen tool commit button requires desktop viewport');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);

  await penPath(page, 100);
  await penPath(page, 250);
  expect(await pathNames(page)).toEqual(['Path 1', 'Path 2']);

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
  await chooser.setFiles({ name: 'repro-paths.lopsy', mimeType: 'application/octet-stream', buffer: saved });
  await expect.poll(() => pathNames(page), { timeout: 30_000 }).toEqual(['Path 1', 'Path 2']);

  await penPath(page, 330);
  expect(await pathNames(page)).toEqual(['Path 1', 'Path 2', 'Path 3']);
});
