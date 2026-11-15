import { test, expect } from './fixtures';
import { waitForStore } from './helpers';

// isMobile is only supported by Chromium — Firefox throws at context creation.
test.describe('Mobile first-visit welcome @chromium', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'isMobile requires Chromium');

  test.use({
    ...({ isMobile: true, hasTouch: true } as Record<string, unknown>),
    viewport: { width: 390, height: 844 },
  });

  test('a phone lands on the tutorials with the welcome modal once', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/tutorials\/$/);

    const dialog = page.getByRole('dialog', { name: 'Welcome!' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('really made for bigger screens');

    await dialog.getByRole('button', { name: "Let's go" }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/');
    await waitForStore(page);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('tapping the backdrop dismisses the welcome modal', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Welcome!' });
    await expect(dialog).toBeVisible();

    await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden();
  });

  test('the tutorials index shows no modal without the redirect', async ({ page }) => {
    await page.goto('/tutorials/');
    await expect(page.getByRole('heading', { name: 'Tutorials', level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome!' })).toBeHidden();
  });

  test('a link that opens a project goes to the editor, not the tutorials', async ({ page }) => {
    await page.goto('/?open=%2Ftutorials%2Fneubrutalist-party-invitation%2Fneubrutalist-party-invitation.lopsy');
    await waitForStore(page);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('dialog', { name: 'Welcome!' })).toHaveCount(0);
  });
});

test.describe('Desktop first visit @chromium', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'desktop-only check');
  test.skip(({ hasTouch }) => hasTouch, 'desktop projects only');

  test('a desktop browser opens the editor, not the tutorials', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
