import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForStore,
  createDocument,
  getEditorState,
  getPixelAt,
  selectTool,
  setForegroundColor,
  docToScreen,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function selectRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function editMenu(page: Page, item: string): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(200);
}

function expectColor(
  px: { r: number; g: number; b: number; a: number },
  rgb: [number, number, number],
): void {
  expect(px.a).toBeGreaterThan(245);
  expect(Math.abs(px.r - rgb[0])).toBeLessThan(10);
  expect(Math.abs(px.g - rgb[1])).toBeLessThan(10);
  expect(Math.abs(px.b - rgb[2])).toBeLessThan(10);
}

const RED: [number, number, number] = [255, 0, 0];
const BLACK: [number, number, number] = [0, 0, 0];

test.describe('Fill with Pattern composites over the layer (#942)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'Edit menu / layer panel need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('transparent tile areas keep the existing layer pixels', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    const state = await getEditorState(page);
    const layer1 = state.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');
    expect(state.document.activeLayerId).toBe(layer1.id);

    // Build an 80x80 tile: black 40x40 square top-left, the rest transparent.
    await setForegroundColor(page, 0, 0, 0);
    await selectRect(page, 0, 0, 40, 40);
    await editMenu(page, 'Fill');
    // Deselect first: a marquee drag that starts inside an active selection
    // moves the selection instead of drawing a new one.
    await page.keyboard.press('Control+d');
    await selectRect(page, 0, 0, 80, 80);
    await editMenu(page, 'Define Pattern');
    const pattern = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__patternStore as {
        getState: () => { patterns: Array<{ width: number; height: number }> };
      };
      const p = store.getState().patterns;
      return { count: p.length, width: p[0]?.width ?? 0, height: p[0]?.height ?? 0 };
    });
    expect(pattern).toEqual({ count: 1, width: 80, height: 80 });

    // Clear Layer 1, then fill it solid red (no selection → whole layer).
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);
    await setForegroundColor(page, 255, 0, 0);
    await editMenu(page, 'Fill');

    expectColor(await getPixelAt(page, 20, 20, layer1.id), RED);
    expectColor(await getPixelAt(page, 150, 150, layer1.id), RED);

    // Fill a marquee with the pattern.
    await selectRect(page, 100, 100, 300, 250);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill with Pattern...', exact: true }).click();
    const dialog = page.locator('[role="dialog"][aria-label="Pattern Fill"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('button[class*="patternSwatch"]').first().click();
    await dialog.locator('button:has-text("Apply")').click();
    await expect(dialog).not.toBeVisible();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pattern-fill-composite-after.png') });

    // The tile repeats every 80px from the document origin: black where
    // x % 80 < 40 and y % 80 < 40, transparent elsewhere.
    //
    // Inside the marquee, over a transparent part of the tile, the layer
    // must stay red. The bug replaced pixels, leaving [0,0,0,0] here.
    expectColor(await getPixelAt(page, 150, 150, layer1.id), RED);
    expectColor(await getPixelAt(page, 290, 130, layer1.id), RED);
    expectColor(await getPixelAt(page, 180, 200, layer1.id), RED);

    // Inside the marquee, over the tile's black square: black, opaque.
    expectColor(await getPixelAt(page, 170, 170, layer1.id), BLACK);
    expectColor(await getPixelAt(page, 250, 170, layer1.id), BLACK);
    expectColor(await getPixelAt(page, 170, 245, layer1.id), BLACK);

    // Outside the marquee — including spots where the tile would be black —
    // the layer is untouched red.
    expectColor(await getPixelAt(page, 20, 20, layer1.id), RED);
    expectColor(await getPixelAt(page, 90, 170, layer1.id), RED);
    expectColor(await getPixelAt(page, 350, 280, layer1.id), RED);
  });
});
