import { test, expect } from './fixtures';

test.describe('Tutorial colour swatches', () => {
  test('the intro palette renders as a swatch panel', async ({ page }) => {
    await page.goto('/tutorials/americana-strawberry-festival-flier/');
    const palette = page.getByRole('list', { name: 'Palette' });
    await expect(palette).toBeVisible();
    await expect(palette.locator('.palette-label').first()).toHaveText('Paper');
    await expect(palette.getByRole('button', { name: '#F3C65A' })).toBeVisible();
    await expect(palette.locator('.swatch-tile')).toHaveCount(9);
  });

  test('clicking a swatch copies its code and flashes Copied', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/tutorials/americana-strawberry-festival-flier/');

    const swatch = page.locator('.step').first().getByRole('button', { name: '#F2E4C6' });
    await expect(swatch).toHaveCSS('--swatch', '#F2E4C6');
    await swatch.click();

    await expect(swatch).toHaveClass(/is-copied/);
    const bubble = await swatch.evaluate((el) => getComputedStyle(el, '::after').content);
    expect(bubble).toBe('"Copied"');
    await expect(page.getByRole('status').filter({ hasText: 'Copied #F2E4C6' })).toHaveCount(1);
    if (browserName === 'chromium') {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#F2E4C6');
    }

    // Visible for 0.5 s, faded out by 1 s, then the class is cleared for the next click.
    await expect(swatch).not.toHaveClass(/is-copied/, { timeout: 3_000 });
  });
});
