import { test, expect } from './fixtures';

test.describe('Open a tutorial project from its page', () => {
  test('the Follow along button opens the project in a new editor tab', async ({ page, context }) => {
    await page.goto('/tutorials/neubrutalist-party-invitation/');

    const box = page.locator('.follow-along');
    await expect(box).toContainText('Follow along with this tutorial');
    const button = box.getByRole('link', { name: 'Open Project in Lopsy' });
    await expect(button).toHaveAttribute('target', '_blank');

    const [editor] = await Promise.all([context.waitForEvent('page'), button.click()]);
    await editor.waitForLoadState();

    await expect(editor.getByText('Dot Grid', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByText('Pink Blob', { exact: true }).first()).toBeVisible();
    await expect(editor.getByRole('dialog', { name: 'New Document' })).toBeHidden();

    // The parameter is stripped so a reload doesn't reopen the file over the user's work.
    expect(new URL(editor.url()).search).toBe('');
  });

  test('tutorials without a project file have no Follow along box', async ({ page }) => {
    await page.goto('/tutorials/neon-glow-text-effect/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make a Neon Glow Text Effect');
    await expect(page.locator('.follow-along')).toHaveCount(0);
  });

  test.describe('with a URL that is not a project', () => {
    test.use({ allowConsoleErrors: [/404|Failed to load resource/] });

    test('shows an error and leaves the New Document dialog up', async ({ page }) => {
      await page.goto('/?open=%2Ftutorials%2Fneon-glow-text-effect%2Fmissing.lopsy');
      await expect(page.getByRole('status')).toContainText(/Couldn't download the project|Failed to load project/, {
        timeout: 15_000,
      });
      await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();
      expect(new URL(page.url()).search).toBe('');
    });
  });
});
