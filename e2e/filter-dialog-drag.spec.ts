import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Filter dialog drag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('dragging the filter dialog header moves it', async ({ page }) => {
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Halftone...');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + 20;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY - 60, { steps: 10 });
    await page.mouse.up();

    const boxAfter = await dialog.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(boxAfter!.x).toBeCloseTo(box!.x + 120, -1);
    expect(boxAfter!.y).toBeCloseTo(box!.y - 60, -1);
  });

  test('dragging the filter dialog body moves it', async ({ page }) => {
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Halftone...');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY + 40, { steps: 10 });
    await page.mouse.up();

    const boxAfter = await dialog.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(boxAfter!.x).toBeCloseTo(box!.x - 80, -1);
    expect(boxAfter!.y).toBeCloseTo(box!.y + 40, -1);
  });

  test('clicking Apply does not trigger a drag', async ({ page }) => {
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Halftone...');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();

    await page.locator('button:has-text("Apply")').click();

    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });
});
