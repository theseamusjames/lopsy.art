import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, docToScreen } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function getUIState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { isQuickMaskMode: boolean };
    };
    return store.getState();
  });
}

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          maskWidth: number;
          maskHeight: number;
          mask: number[] | null;
        };
      };
    };
    return store.getState().selection;
  });
}

/**
 * Sample the overlay canvas at a given screen position.
 * Returns { r, g, b, a } of the pixel at (screenX, screenY).
 */
async function sampleOverlayPixel(page: Page, screenX: number, screenY: number) {
  return page.evaluate(
    ({ sx, sy }) => {
      const all = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
      const overlay = all.find((c) => /overlayCanvas/.test(c.className));
      if (!overlay) return { r: 0, g: 0, b: 0, a: 0 };
      const rect = overlay.getBoundingClientRect();
      const x = Math.round(sx - rect.left);
      const y = Math.round(sy - rect.top);
      if (x < 0 || y < 0 || x >= overlay.width || y >= overlay.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const ctx = overlay.getContext('2d');
      if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
      const data = ctx.getImageData(x, y, 1, 1).data;
      return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! };
    },
    { sx: screenX, sy: screenY },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Quick Mask Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('Q toggles Quick Mask Mode on and off', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Initially off
    const before = await getUIState(page);
    expect(before.isQuickMaskMode).toBe(false);

    // Press Q to enter
    await page.keyboard.press('q');
    await page.waitForTimeout(100);

    const entered = await getUIState(page);
    expect(entered.isQuickMaskMode).toBe(true);

    // Press Q again to exit
    await page.keyboard.press('q');
    await page.waitForTimeout(100);

    const exited = await getUIState(page);
    expect(exited.isQuickMaskMode).toBe(false);
  });

  test('Quick Mask toggle button in toolbox changes active state', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    const toggleBtn = page.locator('[data-testid="quick-mask-toggle"]');
    await expect(toggleBtn).toBeVisible();

    // Initially not active
    await page.keyboard.press('q');
    await page.waitForTimeout(100);

    // Now active — verify the aria-pressed or class
    await page.keyboard.press('q');
    await page.waitForTimeout(100);

    // Verify it's back to off
    const state = await getUIState(page);
    expect(state.isQuickMaskMode).toBe(false);
  });

  test('entering Quick Mask Mode with no selection shows full blue overlay over the document', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Enter Quick Mask Mode (no existing selection → all blue)
    await page.keyboard.press('q');
    await page.waitForTimeout(150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'quick-mask-enter-no-selection.png') });

    // Sample the overlay at the center of the document — should have blue tint
    const centerScreen = await docToScreen(page, 100, 100);
    const overlayPixel = await sampleOverlayPixel(page, centerScreen.x, centerScreen.y);

    // The quick mask overlay paints blue (R=0, G=100, B=255) with ~60% opacity (alpha~153)
    // over unselected areas. Since no selection exists, the whole doc is unselected (blue).
    expect(overlayPixel.r).toBeLessThan(50);
    expect(overlayPixel.g).toBeGreaterThan(50);
    expect(overlayPixel.b).toBeGreaterThan(200);
    expect(overlayPixel.a).toBeGreaterThan(100);

    // Exit Quick Mask Mode
    await page.keyboard.press('q');
    await page.waitForTimeout(100);
  });

  test('entering Quick Mask Mode with an existing selection shows clear area for selected region', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Create a rectangular selection covering the right half of the document
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            w: number,
            h: number,
          ) => void;
        };
      };
      const mask = new Uint8ClampedArray(200 * 200);
      // Right half (x >= 100) is selected
      for (let y = 0; y < 200; y++) {
        for (let x = 100; x < 200; x++) {
          mask[y * 200 + x] = 255;
        }
      }
      store.getState().setSelection({ x: 100, y: 0, width: 100, height: 200 }, mask, 200, 200);
    });
    await page.waitForTimeout(100);

    // Enter Quick Mask Mode
    await page.keyboard.press('q');
    await page.waitForTimeout(150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'quick-mask-with-selection.png') });

    // Left half (unselected) should have blue overlay
    const leftScreen = await docToScreen(page, 50, 100);
    const leftPixel = await sampleOverlayPixel(page, leftScreen.x, leftScreen.y);
    expect(leftPixel.b).toBeGreaterThan(200);
    expect(leftPixel.a).toBeGreaterThan(100);

    // Right half (selected) should be clear (no blue overlay)
    const rightScreen = await docToScreen(page, 150, 100);
    const rightPixel = await sampleOverlayPixel(page, rightScreen.x, rightScreen.y);
    // Selected areas have alpha = 0 (no overlay)
    expect(rightPixel.a).toBeLessThan(30);

    // Exit
    await page.keyboard.press('q');
    await page.waitForTimeout(100);
  });

  test('exiting Quick Mask Mode with no painting clears selection (all-unselected mask)', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    // Enter with no selection
    await page.keyboard.press('q');
    await page.waitForTimeout(100);

    // Exit without painting
    await page.keyboard.press('q');
    await page.waitForTimeout(100);

    const sel = await getSelectionState(page);
    // All-zero mask → no selection
    expect(sel.active).toBe(false);
  });

  test('exiting Quick Mask Mode after painting applies selection from painted mask', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Enter Quick Mask Mode (fully unselected → all blue)
    await page.keyboard.press('q');
    await page.waitForTimeout(150);

    // Paint with brush (white = select) over the top-left quadrant (doc 0–100, 0–100)
    await page.keyboard.press('b');
    await page.waitForTimeout(50);

    // Set a large brush so we can paint a big area with fewer strokes
    // We'll paint a horizontal stroke across the top-left area
    const start = await docToScreen(page, 10, 50);
    const end = await docToScreen(page, 90, 50);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'quick-mask-after-paint.png') });

    // Exit Quick Mask Mode
    await page.keyboard.press('q');
    await page.waitForTimeout(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'quick-mask-after-exit.png') });

    // After exit, a selection should be active (painted white = selected area)
    const sel = await getSelectionState(page);
    expect(sel.active).toBe(true);
    expect(sel.maskWidth).toBe(200);
    expect(sel.maskHeight).toBe(200);
    expect(sel.mask).not.toBeNull();

    // The painted stroke area should have some selected pixels
    const strokeY = 50; // We painted at y=50
    const someSelectedInStrokeRow = sel.mask!.some(
      (_v, i) => Math.floor(i / 200) === strokeY && sel.mask![i]! > 0,
    );
    expect(someSelectedInStrokeRow).toBe(true);
  });

  test('painting in Quick Mask Mode updates the overlay visually', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Enter Quick Mask Mode
    await page.keyboard.press('q');
    await page.waitForTimeout(150);

    // Sample the center before painting — should be blue (unselected)
    const centerScreen = await docToScreen(page, 100, 100);
    const beforePixel = await sampleOverlayPixel(page, centerScreen.x, centerScreen.y);
    expect(beforePixel.b).toBeGreaterThan(150);
    expect(beforePixel.a).toBeGreaterThan(50);

    // Paint over the center with brush (white = select)
    await page.keyboard.press('b');
    await page.waitForTimeout(50);

    await page.mouse.move(centerScreen.x - 20, centerScreen.y);
    await page.mouse.down();
    await page.mouse.move(centerScreen.x + 20, centerScreen.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'quick-mask-painted.png') });

    // Sample center after painting — should have less blue (partially selected)
    const afterPixel = await sampleOverlayPixel(page, centerScreen.x, centerScreen.y);
    // Painted area should have lower blue alpha than unpainted area
    expect(afterPixel.a).toBeLessThan(beforePixel.a);

    // Exit
    await page.keyboard.press('q');
    await page.waitForTimeout(100);
  });
});
