import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, getPixelAt, applyFilter } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

test.describe('Emboss Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies emboss filter and creates 3D relief effect', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a pattern with strong edges so emboss has visible highlights/shadows.
    // A series of colored blocks creates sharp luminance transitions the emboss
    // shader will pick up as directional highlights and shadows.
    await drawRect(page, 0, 0, 200, 150, { r: 40, g: 40, b: 40 });
    await drawRect(page, 200, 0, 200, 150, { r: 220, g: 220, b: 220 });
    await drawRect(page, 0, 150, 200, 150, { r: 220, g: 50, b: 50 });
    await drawRect(page, 200, 150, 200, 150, { r: 50, g: 50, b: 220 });
    await drawRect(page, 150, 100, 100, 100, { r: 255, g: 255, b: 0 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixels before filter at edges where emboss will create highlights/shadows
    const beforeCenter = await getPixelAt(page, 200, 150);
    const beforeMidLeft = await getPixelAt(page, 100, 75);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-before.png') });

    // Apply emboss filter via menu
    await applyFilter(page, 'Emboss...', { 'Angle': 135, 'Strength': 80 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-after.png') });

    // Read pixels after — areas near edges should have changed due to the
    // directional highlight/shadow the emboss creates.
    const afterCenter = await getPixelAt(page, 200, 150);
    const afterMidLeft = await getPixelAt(page, 100, 75);

    // The center pixel (at the intersection of 4 blocks) sits right on strong
    // edges so emboss should shift its value.
    const centerDiff = Math.abs(afterCenter.r - beforeCenter.r)
      + Math.abs(afterCenter.g - beforeCenter.g)
      + Math.abs(afterCenter.b - beforeCenter.b);
    expect(centerDiff).toBeGreaterThan(10);

    // Interior of a flat region: emboss produces little change inside
    // uniform areas (no gradient = no emboss offset). The flat middle of the
    // dark block should be largely unchanged.
    const midLeftDiff = Math.abs(afterMidLeft.r - beforeMidLeft.r)
      + Math.abs(afterMidLeft.g - beforeMidLeft.g)
      + Math.abs(afterMidLeft.b - beforeMidLeft.b);
    expect(midLeftDiff).toBeLessThan(centerDiff);

    // Layer should still exist with original dimensions
    const layerInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; width: number; height: number }>; activeLayerId: string };
        };
      };
      const state = store.getState();
      return {
        layerCount: state.document.layers.length,
        layerWidth: state.document.layers[0]?.width,
        layerHeight: state.document.layers[0]?.height,
      };
    });

    expect(layerInfo.layerCount).toBeGreaterThan(0);
    expect(layerInfo.layerWidth).toBe(400);
    expect(layerInfo.layerHeight).toBe(300);
  });

  test('emboss filter dialog shows angle, strength, and type controls', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Emboss...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Emboss")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const angleLabel = page.locator('text=Angle');
    const strengthLabel = page.locator('text=Strength');
    const typeLabel = page.locator('text=Type');
    await expect(angleLabel).toBeVisible({ timeout: 3000 });
    await expect(strengthLabel).toBeVisible({ timeout: 3000 });
    await expect(typeLabel).toBeVisible({ timeout: 3000 });

    // Take screenshot of the dialog
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-dialog.png') });

    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
  });

  test('emboss filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    await drawRect(page, 0, 0, 100, 200, { r: 255, g: 255, b: 255 });
    await drawRect(page, 100, 0, 100, 200, { r: 30, g: 30, b: 30 });
    await fitToView(page);

    // Read a pixel near the edge before emboss
    const beforeEdge = await getPixelAt(page, 100, 100);

    // Apply emboss via the menu helper
    await applyFilter(page, 'Emboss...', { 'Angle': 135, 'Strength': 70 });
    await page.waitForTimeout(300);

    const afterEmboss = await getPixelAt(page, 100, 100);
    const embossDiff = Math.abs(afterEmboss.r - beforeEdge.r)
      + Math.abs(afterEmboss.g - beforeEdge.g)
      + Math.abs(afterEmboss.b - beforeEdge.b);
    expect(embossDiff).toBeGreaterThan(0);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const afterUndo = await getPixelAt(page, 100, 100);
    expect(afterUndo.r).toBe(beforeEdge.r);
    expect(afterUndo.g).toBe(beforeEdge.g);
    expect(afterUndo.b).toBe(beforeEdge.b);
  });
});
