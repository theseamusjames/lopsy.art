import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect, getPixelAt } from './helpers';

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

test.describe('Pixelate / Mosaic Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies pixelate filter via menu and renders mosaic blocks', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    // Paint alternating 1px-wide vertical stripes: red at even x, blue at odd x.
    // Use a single paintRect per stripe — 100 stripes total.
    for (let x = 0; x < 100; x++) {
      const color = x % 2 === 0 ? RED : BLUE;
      await paintRect(page, x, 0, 1, 100, color);
    }

    // Verify initial stripe pattern: adjacent columns should differ.
    const beforeEven = await getPixelAt(page, 0, 50);
    const beforeOdd = await getPixelAt(page, 1, 50);
    expect(beforeEven.r).toBe(255);
    expect(beforeEven.b).toBe(0);
    expect(beforeOdd.r).toBe(0);
    expect(beforeOdd.b).toBe(255);

    // Open Filter menu and click Pixelate
    await page.click('text=Filter');
    await page.click('text=Pixelate...');

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Pixelate")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Set block size to 10 via the range slider
    const slider = page.locator('input[type="range"]');
    await slider.fill('10');

    // Click Apply button
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // After pixelation with block size 10, every pixel within a single 10px
    // block should have the same color. Sample two pixels within the first
    // block (x=0..9) that were different colors before.
    const afterA = await getPixelAt(page, 0, 50);
    const afterB = await getPixelAt(page, 1, 50);
    const afterC = await getPixelAt(page, 5, 50);
    const afterD = await getPixelAt(page, 9, 50);

    // All four pixels within the same 10px block must now be identical.
    expect(afterA.r).toBe(afterB.r);
    expect(afterA.g).toBe(afterB.g);
    expect(afterA.b).toBe(afterB.b);

    expect(afterA.r).toBe(afterC.r);
    expect(afterA.g).toBe(afterC.g);
    expect(afterA.b).toBe(afterC.b);

    expect(afterA.r).toBe(afterD.r);
    expect(afterA.g).toBe(afterD.g);
    expect(afterA.b).toBe(afterD.b);

    // The uniform color should be a blend of red and blue (roughly half each).
    // Allow tolerance for rounding. Equal red/blue stripes averaged: r≈127, b≈127.
    expect(afterA.r).toBeGreaterThan(90);
    expect(afterA.r).toBeLessThan(170);
    expect(afterA.b).toBeGreaterThan(90);
    expect(afterA.b).toBeLessThan(170);
    // Green should remain near zero.
    expect(afterA.g).toBeLessThan(30);
  });

  test('pixelate filter can be undone', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    // Paint alternating 1px stripes so we have varied content.
    for (let x = 0; x < 100; x++) {
      const color = x % 2 === 0 ? RED : BLUE;
      await paintRect(page, x, 0, 1, 100, color);
    }

    // Read a pixel before filter — should be pure red.
    const beforePixel = await getPixelAt(page, 0, 50);
    expect(beforePixel.r).toBe(255);
    expect(beforePixel.b).toBe(0);

    // Apply pixelate via the Filter menu UI.
    await page.click('text=Filter');
    await page.click('text=Pixelate...');
    await expect(page.locator('h2:has-text("Pixelate")')).toBeVisible({ timeout: 3000 });
    const slider = page.locator('input[type="range"]');
    await slider.fill('10');
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // After pixelation the pixel should have changed — no longer pure red.
    const afterPixel = await getPixelAt(page, 0, 50);
    expect(afterPixel.r).not.toBe(255);
    expect(afterPixel.b).toBeGreaterThan(0);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // After undo the pixel should be back to pure red.
    const undonePixel = await getPixelAt(page, 0, 50);
    expect(undonePixel.r).toBe(255);
    expect(undonePixel.b).toBe(0);
  });
});
