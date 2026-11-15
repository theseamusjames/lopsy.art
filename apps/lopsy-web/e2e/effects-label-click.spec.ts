import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Effects panel label click', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects drawer requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('clicking effect label opens that effect form', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const dropShadowLabel = drawer.locator('span:has-text("Drop Shadow")');
    await dropShadowLabel.click();

    await expect(drawer.locator('text=Offset X')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/effects-label-click-drop-shadow.png' });
  });

  test('clicking different effect labels switches the form', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    await drawer.locator('span:has-text("Drop Shadow")').click();
    await expect(drawer.locator('text=Offset X')).toBeVisible();

    await drawer.locator('span:has-text("Stroke")').click();
    await expect(drawer.locator('text=Width')).toBeVisible();
    await expect(drawer.locator('text=Offset X')).not.toBeVisible();

    await drawer.locator('span:has-text("Outer Glow")').click();
    await expect(drawer.locator('text=Spread')).toBeVisible();
    await expect(drawer.locator('text=Width')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/effects-label-click-switch.png' });
  });

  test('clicking label does not move the drawer', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const boxBefore = await drawer.boundingBox();

    await drawer.locator('span:has-text("Stroke")').click();

    const boxAfter = await drawer.boundingBox();
    expect(boxAfter!.x).toBeCloseTo(boxBefore!.x, 0);
    expect(boxAfter!.y).toBeCloseTo(boxBefore!.y, 0);
  });

  test('checkbox still toggles enabled state independently', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    const drawer = page.locator('[data-testid="effects-drawer"]');
    await expect(drawer).toBeVisible();

    const checkbox = drawer.locator('[aria-label="Enable Drop Shadow"]');
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await drawer.locator('span:has-text("Drop Shadow")').click();
    await expect(drawer.locator('text=Offset X')).toBeVisible();
    await expect(checkbox).toBeChecked();
  });
});
