import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  getPixelAt,
  setForegroundColor,
  drawRect,
} from './helpers';

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          bounds: { x: number; y: number; width: number; height: number } | null;
          mask: Uint8ClampedArray | null;
          maskWidth: number;
          maskHeight: number;
        };
      };
    };
    const sel = store.getState().selection;
    if (!sel.active || !sel.mask) {
      return { active: false, bounds: null, selectedCount: 0 };
    }
    let selectedCount = 0;
    for (let i = 0; i < sel.mask.length; i++) {
      if (sel.mask[i]! > 0) selectedCount++;
    }
    return {
      active: sel.active,
      bounds: sel.bounds,
      selectedCount,
    };
  });
}

async function openColorRangeDialog(page: Page) {
  await page.click('button:has-text("Select")');
  await page.waitForTimeout(100);
  await page.click('button:has-text("Color Range")');
  await page.waitForTimeout(300);
}

async function setFuzziness(page: Page, value: number) {
  const dialog = page.locator('[role="dialog"][aria-label="Color Range"]');
  const slider = dialog.locator('input[type="range"]');
  await slider.fill(String(value));
  await page.waitForTimeout(200);
}

async function applyColorRange(page: Page) {
  const dialog = page.locator('[role="dialog"][aria-label="Color Range"]');
  await dialog.locator('button:has-text("OK")').click();
  await page.waitForTimeout(200);
}

async function cancelColorRange(page: Page) {
  const dialog = page.locator('[role="dialog"][aria-label="Color Range"]');
  await dialog.locator('button:has-text("Cancel")').click();
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

test.describe('Color Range Selection', () => {
  test('selects pixels matching foreground color', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Draw a red rectangle in the top-left quadrant
    await drawRect(page, 10, 10, 80, 80, { r: 255, g: 0, b: 0 });
    // Draw a blue rectangle in the bottom-right quadrant
    await drawRect(page, 110, 110, 80, 80, { r: 0, g: 0, b: 255 });

    // Screenshot before applying color range
    await page.screenshot({ path: 'e2e/screenshots/color-range-before.png' });

    // Set foreground color to red — this is what Color Range will match against
    await setForegroundColor(page, 255, 0, 0);

    // Open Color Range dialog
    await openColorRangeDialog(page);

    // Verify the dialog is visible
    const dialog = page.locator('[role="dialog"][aria-label="Color Range"]');
    await expect(dialog).toBeVisible();

    // Set a low fuzziness so only exact red matches
    await setFuzziness(page, 10);

    // Screenshot showing the dialog with preview
    await page.screenshot({ path: 'e2e/screenshots/color-range-dialog.png' });

    // Apply
    await applyColorRange(page);

    // Screenshot after applying
    await page.screenshot({ path: 'e2e/screenshots/color-range-after.png' });

    // Verify selection is active
    const selState = await getSelectionState(page);
    expect(selState.active).toBe(true);
    expect(selState.selectedCount).toBeGreaterThan(0);

    // The selection should cover roughly the red rectangle area (80x80 = 6400 pixels)
    // Allow some tolerance for anti-aliasing
    expect(selState.selectedCount).toBeGreaterThan(5000);
    expect(selState.selectedCount).toBeLessThan(10000);

    // The bounds should roughly match the red rect position
    expect(selState.bounds).not.toBeNull();
    if (selState.bounds) {
      expect(selState.bounds.x).toBeLessThanOrEqual(15);
      expect(selState.bounds.y).toBeLessThanOrEqual(15);
    }
  });

  test('fuzziness controls how many pixels are selected', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Draw a red rectangle
    await drawRect(page, 20, 20, 60, 60, { r: 255, g: 0, b: 0 });
    // Draw a dark red rectangle (similar but not identical)
    await drawRect(page, 120, 20, 60, 60, { r: 200, g: 0, b: 0 });

    // Set foreground to exact red
    await setForegroundColor(page, 255, 0, 0);

    // Low fuzziness: should only match the exact red
    await openColorRangeDialog(page);
    await setFuzziness(page, 10);
    await applyColorRange(page);

    const lowFuzzState = await getSelectionState(page);
    expect(lowFuzzState.active).toBe(true);
    const lowCount = lowFuzzState.selectedCount;

    // Deselect
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(100);

    // High fuzziness: should match both reds
    await openColorRangeDialog(page);
    await setFuzziness(page, 100);
    await applyColorRange(page);

    const highFuzzState = await getSelectionState(page);
    expect(highFuzzState.active).toBe(true);
    const highCount = highFuzzState.selectedCount;

    // Higher fuzziness should select more pixels
    expect(highCount).toBeGreaterThan(lowCount);
  });

  test('cancel does not create a selection', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 20, 20, 60, 60, { r: 255, g: 0, b: 0 });
    await setForegroundColor(page, 255, 0, 0);

    await openColorRangeDialog(page);
    await cancelColorRange(page);

    const selState = await getSelectionState(page);
    expect(selState.active).toBe(false);
  });

  test('dialog shows preview canvas', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 40, 40, 120, 120, { r: 0, g: 255, b: 0 });
    await setForegroundColor(page, 0, 255, 0);

    await openColorRangeDialog(page);

    // Verify the preview canvas exists within the dialog
    const dialog = page.locator('[role="dialog"][aria-label="Color Range"]');
    const previewCanvas = dialog.locator('canvas');
    await expect(previewCanvas).toBeVisible();

    // Screenshot of the dialog showing the green selection preview
    await page.screenshot({ path: 'e2e/screenshots/color-range-preview.png' });

    await cancelColorRange(page);
  });
});
