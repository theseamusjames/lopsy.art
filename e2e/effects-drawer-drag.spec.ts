import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Effects drawer drag', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects drawer requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('dragging the effects drawer header moves the panel', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();

    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + 14;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    const boxAfter = await drawer.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(boxAfter!.x).toBeCloseTo(box!.x - 100, -1);
    expect(boxAfter!.y).toBeCloseTo(box!.y + 50, -1);
  });

  test('dragging on a non-header area (effect list) also moves the panel', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();

    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + 60;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY - 30, { steps: 10 });
    await page.mouse.up();

    const boxAfter = await drawer.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(boxAfter!.x).toBeCloseTo(box!.x + 80, -1);
    expect(boxAfter!.y).toBeCloseTo(box!.y - 30, -1);
  });

  test('clicking a checkbox does not start a drag', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();

    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();

    const checkbox = page.locator('[aria-label="Enable Drop Shadow"]');
    await checkbox.click();

    const boxAfter = await drawer.boundingBox();
    expect(boxAfter!.x).toBeCloseTo(box!.x, 0);
    expect(boxAfter!.y).toBeCloseTo(box!.y, 0);
  });

  test('drawer position resets when closed and reopened', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();

    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + 14;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 50, startY + 50, { steps: 5 });
    await page.mouse.up();

    await page.locator('[aria-label="Close effects"]').click();
    await expect(drawer).not.toBeVisible();

    await page.locator('button[title="Layer effects"]').first().click();
    await expect(drawer).toBeVisible();

    const boxReopened = await drawer.boundingBox();
    expect(boxReopened!.x).toBeCloseTo(box!.x, 0);
    expect(boxReopened!.y).toBeCloseTo(box!.y, 0);
  });
});
