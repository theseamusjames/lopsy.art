import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForStore, createDocument, getPixelAt } from './helpers';

/**
 * Paint three side-by-side coloured blocks into the active layer in a
 * single store update so the per-call auto-crop doesn't shrink the layer
 * after the first rect.
 */
async function paintThreeBlocks(page: Page): Promise<void> {
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
    state.pushHistory('Paint blocks');
    const w = state.document.width;
    const h = state.document.height;
    const data = new ImageData(w, h);
    const blocks: Array<[number, number, number, number, [number, number, number]]> = [
      [0, 0, 10, 10, [255, 0, 0]],
      [10, 0, 10, 10, [0, 255, 0]],
      [20, 0, 10, 10, [0, 0, 255]],
    ];
    for (const [bx, by, bw, bh, [r, g, b]] of blocks) {
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * w + x) * 4;
          data.data[i] = r;
          data.data[i + 1] = g;
          data.data[i + 2] = b;
          data.data[i + 3] = 255;
        }
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

// ---------------------------------------------------------------------------
// Pixelate filter
//
// The shader (engine-rs/.../pixelate.glsl) samples a single pixel at the
// CENTER of each blockSize×blockSize block and writes it to every pixel in
// the block. So the meaningful test is:
//
//   1. Paint content where each blockSize-aligned region has a known color
//      at its center.
//   2. Apply pixelate with that block size.
//   3. Verify each block is uniformly the color that was at its center.
// ---------------------------------------------------------------------------

test.describe('Pixelate / Mosaic Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies pixelate via menu and produces uniform blocks', async ({ page }) => {
    // 30×10 transparent doc with three side-by-side 10×10 blocks of solid
    // colour at known positions:
    //   x = 0..9   → red
    //   x = 10..19 → green
    //   x = 20..29 → blue
    // The centre of each block is at x = 5 / 15 / 25 — the colour that
    // pixelate should sample with blockSize = 10.
    await createDocument(page, 30, 10, true);
    await paintThreeBlocks(page);

    // Sanity: the painted layer is exactly the three blocks.
    expect((await getPixelAt(page, 0, 5)).r).toBe(255);
    expect((await getPixelAt(page, 9, 5)).r).toBe(255);
    expect((await getPixelAt(page, 10, 5)).g).toBe(255);
    expect((await getPixelAt(page, 19, 5)).g).toBe(255);
    expect((await getPixelAt(page, 20, 5)).b).toBe(255);
    expect((await getPixelAt(page, 29, 5)).b).toBe(255);

    // Open Filter → Pixelate via the menu UI.
    await page.click('text=Filter');
    await page.click('text=Pixelate...');

    const dialog = page.locator('[class*="overlay"][class*="FilterDialog"], [class*="overlay_"]').first();
    // The dialog hosts a heading <h2>Pixelate</h2>; wait for it.
    await expect(page.locator('h2:has-text("Pixelate")')).toBeVisible({ timeout: 3000 });

    // Set blockSize to 10 by writing into the slider scoped to the dialog
    // body. The dialog contains exactly one range slider (the blockSize
    // param). Use the .slider class from the Slider component to scope.
    const slider = page.locator('h2:has-text("Pixelate")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]')
      .locator('input[type="range"]');
    await expect(slider).toHaveCount(1);
    await slider.fill('10');

    // Click Apply.
    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Pixelate")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    // After pixelate the entire 0..9 block should be red, 10..19 green,
    // 20..29 blue. Sample multiple positions inside each block.
    for (const x of [0, 3, 5, 9]) {
      const p = await getPixelAt(page, x, 5);
      expect(p.r, `block 1 px(${x},5).r`).toBe(255);
      expect(p.g, `block 1 px(${x},5).g`).toBe(0);
      expect(p.b, `block 1 px(${x},5).b`).toBe(0);
    }
    for (const x of [10, 14, 15, 19]) {
      const p = await getPixelAt(page, x, 5);
      expect(p.r, `block 2 px(${x},5).r`).toBe(0);
      expect(p.g, `block 2 px(${x},5).g`).toBe(255);
      expect(p.b, `block 2 px(${x},5).b`).toBe(0);
    }
    for (const x of [20, 24, 25, 29]) {
      const p = await getPixelAt(page, x, 5);
      expect(p.r, `block 3 px(${x},5).r`).toBe(0);
      expect(p.g, `block 3 px(${x},5).g`).toBe(0);
      expect(p.b, `block 3 px(${x},5).b`).toBe(255);
    }

    // The same property must hold along a different y row, since pixelate
    // is 2D — block 1 at y=0..9 should be uniformly red.
    for (const y of [0, 4, 9]) {
      const p = await getPixelAt(page, 5, y);
      expect(p.r, `block 1 vert px(5,${y}).r`).toBe(255);
    }
  });

  test('pixelate is undoable and restores the original pixels', async ({ page }) => {
    await createDocument(page, 30, 10, true);
    await paintThreeBlocks(page);

    // Snapshot the corner pixels before pixelating: the boundary between
    // block 1 and block 2 (x=9 / x=10) is sharp.
    const beforeLeftEdge = await getPixelAt(page, 9, 5);
    const beforeRightEdge = await getPixelAt(page, 10, 5);
    expect(beforeLeftEdge.r).toBe(255);
    expect(beforeRightEdge.g).toBe(255);

    // Apply pixelate with blockSize = 30 — this single block spans the
    // entire image and samples the centre at x = 15, y = 5 (green).
    await page.click('text=Filter');
    await page.click('text=Pixelate...');
    await expect(page.locator('h2:has-text("Pixelate")')).toBeVisible({ timeout: 3000 });
    const slider = page.locator('h2:has-text("Pixelate")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]')
      .locator('input[type="range"]');
    await slider.fill('30');
    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Pixelate")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    // Now the entire image is uniform — every pixel should match the
    // sampled centre colour (green).
    const after = await getPixelAt(page, 0, 0);
    expect(after.g).toBe(255);
    expect(after.r).toBe(0);
    expect(after.b).toBe(0);
    const afterRight = await getPixelAt(page, 29, 9);
    expect(afterRight.g).toBe(255);

    // Undo with the keyboard shortcut — Linux/Win uses Control, macOS uses
    // Meta. Send both for portability.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // The pre-filter pixels must be restored exactly.
    const restoredLeft = await getPixelAt(page, 9, 5);
    const restoredRight = await getPixelAt(page, 10, 5);
    expect(restoredLeft.r).toBe(255);
    expect(restoredLeft.g).toBe(0);
    expect(restoredRight.g).toBe(255);
    expect(restoredRight.r).toBe(0);
  });
});
