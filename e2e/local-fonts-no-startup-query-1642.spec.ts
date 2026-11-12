import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

// #1642: the editor enumerated installed fonts (queryLocalFonts) as soon as a
// document opened, which raised the font-access prompt at start-up and, on
// machines with many fonts, froze the page. Fonts are now enumerated only
// from the font list: on their own when access is already granted, otherwise
// from the Load local fonts button.

async function countQueries(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __localFontQueries: number }).__localFontQueries);
}

async function openFontPicker(page: Page): Promise<void> {
  const trigger = page.locator('button[aria-haspopup="listbox"]').first();
  const search = page.locator('input[aria-label="Search fonts"]');
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(search).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

test.describe('#1642 installed fonts are not enumerated at start-up', () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'Local Font Access API is Chromium desktop only');
    await page.addInitScript(() => {
      const w = window as unknown as {
        __localFontQueries: number;
        queryLocalFonts?: () => Promise<Array<{ family: string; fullName: string; postscriptName: string; style: string; blob: () => Promise<Blob> }>>;
      };
      w.__localFontQueries = 0;
      w.queryLocalFonts = async () => {
        w.__localFontQueries++;
        return [{
          family: 'Lopsy Test Local',
          fullName: 'Lopsy Test Local Regular',
          postscriptName: 'LopsyTestLocal-Regular',
          style: 'Regular',
          blob: async () => new Blob([]),
        }];
      };
    });
  });

  test('without granted access, only the button queries', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(1000);
    expect(await countQueries(page)).toBe(0);

    await page.keyboard.press('t');
    await openFontPicker(page);
    await page.waitForTimeout(500);
    expect(await countQueries(page)).toBe(0);

    await page.getByRole('button', { name: 'Load local fonts' }).click();
    await expect(page.locator('[role="option"]').filter({ hasText: /^Lopsy Test Local$/ })).toHaveCount(1);
    expect(await countQueries(page)).toBe(1);
    await page.screenshot({ path: 'e2e/screenshots/local-fonts-no-startup-query-1642.png' });
  });

  test('with granted access, opening the font list loads them without a click', async ({ page, context }) => {
    await context.grantPermissions(['local-fonts']);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(1000);
    expect(await countQueries(page)).toBe(0);

    await page.keyboard.press('t');
    await openFontPicker(page);
    await expect(page.locator('[role="option"]').filter({ hasText: /^Lopsy Test Local$/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Load local fonts' })).toHaveCount(0);
    expect(await countQueries(page)).toBe(1);
  });
});
