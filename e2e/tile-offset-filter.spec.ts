import { test, expect } from './fixtures';
import { waitForStore, createDocument, getPixelAt } from './helpers';

/**
 * Paint two side-by-side halves in a single store update:
 *   x = 0..3  → red   (255, 0, 0, 255)
 *   x = 4..7  → green (0, 255, 0, 255)
 *
 * Using a single updateLayerPixelData call avoids the auto-crop
 * pitfall (see GUIDE.md pitfall #1).
 */
async function paintHalves(page: Parameters<typeof createDocument>[0]): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const w = state.document.width;
    const h = state.document.height;
    state.pushHistory('Paint halves');
    const data = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x < w / 2) {
          // Left half → red
          data.data[i] = 255;
          data.data[i + 1] = 0;
          data.data[i + 2] = 0;
          data.data[i + 3] = 255;
        } else {
          // Right half → green
          data.data[i] = 0;
          data.data[i + 1] = 255;
          data.data[i + 2] = 0;
          data.data[i + 3] = 255;
        }
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

test.describe('Tile/Offset Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('shifts pixels horizontally with wrap-around', async ({ page }) => {
    // 8×4 doc: left 4 columns red, right 4 columns green.
    await createDocument(page, 8, 4, true);
    await paintHalves(page);

    // Sanity: verify pre-filter state.
    const preBefore = await getPixelAt(page, 0, 2);
    expect(preBefore.r, 'left half should be red before filter').toBe(255);
    expect(preBefore.g).toBe(0);
    const preAfter = await getPixelAt(page, 5, 2);
    expect(preAfter.g, 'right half should be green before filter').toBe(255);
    expect(preAfter.r).toBe(0);

    // Open Filter → Offset...
    await page.click('text=Filter');
    await page.click('text=Offset...');
    await expect(page.locator('h2:has-text("Offset")')).toBeVisible({ timeout: 5000 });

    // Find the modal ancestor of the h2 header.
    const modal = page.locator('h2:has-text("Offset")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');

    // Set horizontal offset to 4 (half of 8) via the Horizontal slider.
    const hSlider = modal.locator('input[type="range"]').first();
    await hSlider.fill('4');

    // Ensure "Wrap Around" checkbox is checked (it should default to checked).
    const wrapCheckbox = modal.locator('input[type="checkbox"]');
    await expect(wrapCheckbox).toBeChecked();

    // Click Apply.
    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Offset")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    // Take a screenshot for review.
    await page.screenshot({ path: 'e2e/screenshots/tile-offset-horizontal-wrap.png' });

    // After shifting right by 4 (half the 8px width), the red and green
    // halves should have swapped:
    //   x = 0..3 should now be green (was at x = 4..7 before)
    //   x = 4..7 should now be red   (was at x = 0..3 before)
    const leftAfter = await getPixelAt(page, 1, 2);
    expect(leftAfter.g, 'left half should be green after half-width offset').toBe(255);
    expect(leftAfter.r).toBe(0);

    const rightAfter = await getPixelAt(page, 5, 2);
    expect(rightAfter.r, 'right half should be red after half-width offset').toBe(255);
    expect(rightAfter.g).toBe(0);
  });

  test('offset (0, 0) is a no-op', async ({ page }) => {
    await createDocument(page, 8, 4, true);
    await paintHalves(page);

    await page.click('text=Filter');
    await page.click('text=Offset...');
    await expect(page.locator('h2:has-text("Offset")')).toBeVisible({ timeout: 5000 });

    // Sliders default to 0 — just click Apply immediately.
    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Offset")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    // Pixels should be unchanged.
    const leftAfter = await getPixelAt(page, 1, 2);
    expect(leftAfter.r, 'left half should still be red after zero offset').toBe(255);
    const rightAfter = await getPixelAt(page, 5, 2);
    expect(rightAfter.g, 'right half should still be green after zero offset').toBe(255);
  });

  test('no-wrap mode fills exposed edges with transparent', async ({ page }) => {
    await createDocument(page, 8, 4, true);
    await paintHalves(page);

    await page.click('text=Filter');
    await page.click('text=Offset...');
    await expect(page.locator('h2:has-text("Offset")')).toBeVisible({ timeout: 5000 });

    const modal = page.locator('h2:has-text("Offset")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');

    // Shift right by 4 pixels.
    const hSlider = modal.locator('input[type="range"]').first();
    await hSlider.fill('4');

    // Uncheck "Wrap Around".
    const wrapCheckbox = modal.locator('input[type="checkbox"]');
    await wrapCheckbox.uncheck();
    await expect(wrapCheckbox).not.toBeChecked();

    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Offset")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/tile-offset-no-wrap.png' });

    // Left 4 columns (exposed) should be transparent.
    const leftEdge = await getPixelAt(page, 0, 2);
    expect(leftEdge.a, 'exposed left edge should be transparent in no-wrap mode').toBe(0);
    const leftEdge2 = await getPixelAt(page, 3, 2);
    expect(leftEdge2.a, 'exposed left edge (x=3) should be transparent').toBe(0);

    // Right 4 columns should now contain the original left (red) content.
    const rightShifted = await getPixelAt(page, 5, 2);
    expect(rightShifted.r, 'shifted content should be red at x=5').toBe(255);
    expect(rightShifted.a, 'shifted content should be opaque').toBe(255);
  });

  test('offset is undoable', async ({ page }) => {
    await createDocument(page, 8, 4, true);
    await paintHalves(page);

    // Apply half-width offset with wrap.
    await page.click('text=Filter');
    await page.click('text=Offset...');
    await expect(page.locator('h2:has-text("Offset")')).toBeVisible({ timeout: 5000 });

    const modal = page.locator('h2:has-text("Offset")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    await modal.locator('input[type="range"]').first().fill('4');
    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Offset")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    // After offset, left should be green.
    const afterLeft = await getPixelAt(page, 1, 2);
    expect(afterLeft.g, 'after offset left half should be green').toBe(255);

    // Undo.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // Original state should be restored: left = red.
    const restoredLeft = await getPixelAt(page, 1, 2);
    expect(restoredLeft.r, 'after undo left half should be red again').toBe(255);
    expect(restoredLeft.g).toBe(0);
  });

  test('Half Width convenience button sets the correct value', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await page.click('text=Filter');
    await page.click('text=Offset...');
    await expect(page.locator('h2:has-text("Offset")')).toBeVisible({ timeout: 5000 });

    // Click "Half Width" button — should set offsetX to 50.
    await page.locator('button[aria-label="Set to half width"]').click();

    const modal = page.locator('h2:has-text("Offset")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const hSlider = modal.locator('input[type="range"]').first();
    await expect(hSlider).toHaveValue('50');

    await page.locator('button:has-text("Cancel")').click();
  });
});
