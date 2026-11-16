import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

/**
 * #1677 — toggle icon buttons (Symmetry, Radial Symmetry, the panel
 * toggles) showed their state only through a CSS class. They now expose it
 * as `aria-pressed`; plain action buttons carry no `aria-pressed` at all.
 */
test.describe('Icon button toggle state (#1677)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'needs the desktop options bar');
  });

  test('Symmetry and Radial Symmetry report aria-pressed as they toggle', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');

    for (const label of ['Symmetry Vertical', 'Symmetry Horizontal', 'Radial Symmetry']) {
      const button = page.locator(`button[aria-label="${label}"]`);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('plain action icon buttons carry no aria-pressed', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const addLayer = page.locator('button[aria-label="Add Layer"]');
    await expect(addLayer).toBeVisible();
    expect(await addLayer.getAttribute('aria-pressed')).toBeNull();
  });
});
