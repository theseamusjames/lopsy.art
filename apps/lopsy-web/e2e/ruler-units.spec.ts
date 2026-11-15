import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

async function openUnitsSubmenu(page: Page) {
  await page.getByRole('button', { name: 'View' }).click();
  await page.hover('[role="menuitem"]:has-text("Units")');
  const submenu = page.locator('[role="menu"][aria-label="Units"]');
  await expect(submenu).toBeVisible();
  return submenu;
}

/**
 * The top ruler strip, as pixels: the only place the unit is visible. The
 * pointer is parked on a fixed canvas point first, because the ruler draws a
 * cursor-indicator line at the pointer's document X and the menu clicks move
 * the pointer across the canvas.
 */
async function topRulerStrip(page: Page): Promise<Buffer> {
  const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!box) throw new Error('canvas container not laid out');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.waitForTimeout(150);
  return page.screenshot({ clip: { x: box.x + 20, y: box.y, width: 600, height: 20 } });
}

test.describe('Ruler units', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers and the menu bar are desktop-only');
  });

  test('View → Units relabels the rulers and marks the current unit', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 720, 720);

    const pixels = await topRulerStrip(page);

    let submenu = await openUnitsSubmenu(page);
    await expect(submenu.locator('[role="menuitem"]')).toHaveText(['Pixels', 'Points', 'Inches', 'Millimeters'].map((l) => new RegExp(l)));
    await expect(submenu.locator('[role="menuitem"]:has-text("Pixels")')).toContainText('✓');
    await submenu.locator('[role="menuitem"]:has-text("Inches")').click();
    await expect(page.locator('[role="menu"][aria-label="View"]')).toHaveCount(0);

    const inches = await topRulerStrip(page);
    expect(inches.equals(pixels), 'inch ruler must look different from the pixel ruler').toBe(false);

    submenu = await openUnitsSubmenu(page);
    await expect(submenu.locator('[role="menuitem"]:has-text("Inches")')).toContainText('✓');
    await expect(submenu.locator('[role="menuitem"]:has-text("Pixels")')).not.toContainText('✓');
    await submenu.locator('[role="menuitem"]:has-text("Millimeters")').click();

    const millimeters = await topRulerStrip(page);
    expect(millimeters.equals(pixels)).toBe(false);
    expect(millimeters.equals(inches)).toBe(false);

    submenu = await openUnitsSubmenu(page);
    await submenu.locator('[role="menuitem"]:has-text("Pixels")').click();
    expect((await topRulerStrip(page)).equals(pixels), 'switching back restores the pixel ruler').toBe(true);
  });

  test('the New Document modal stores its DPI on the document', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'US Letter' }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await waitForStore(page);

    const doc = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { width: number; height: number; dpi?: number } };
      };
      const { width, height, dpi } = store.getState().document;
      return { width, height, dpi };
    });
    expect(doc).toEqual({ width: 2550, height: 3300, dpi: 300 });
  });

  test('the document dpi survives a project save and reload', async ({ page, browserName, allowConsoleErrors }) => {
    test.skip(browserName !== 'chromium', 'download interception is only wired up for chromium');
    (allowConsoleErrors as RegExp[]).push(/WebSocket connection/);

    await page.goto('/');
    await page.locator('button', { hasText: 'US Letter' }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await waitForStore(page);

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
      const saveFn = (window as unknown as Record<string, unknown>).__saveProject as () => Promise<void>;
      await saveFn();
    });
    const download = await downloadPromise;
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    const lopsyBase64 = Buffer.concat(chunks).toString('base64');

    await page.reload();
    await waitForStore(page);
    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const loadFn = (window as unknown as Record<string, unknown>).__loadProject as (file: File) => Promise<void>;
      await loadFn(new File([bytes], 'letter.lopsy'));
    }, lopsyBase64);
    await page.waitForFunction(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { documentReady: boolean; document: { width: number } };
      };
      const s = store.getState();
      return s.documentReady && s.document.width === 2550;
    });

    const dpi = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { dpi?: number } };
      };
      return store.getState().document.dpi;
    });
    expect(dpi).toBe(300);
  });
});
