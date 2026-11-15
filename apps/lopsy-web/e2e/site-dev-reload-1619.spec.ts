import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './fixtures';
import { waitForStore } from './helpers';

// In the dev server, editing tutorial or blog content live-reloads the site
// pages only. The editor tab must not reload (that would drop a clean
// document, or raise "Leave site?" for a dirty one).

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function setMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__reloadMarker = true;
  });
}

async function hasMarker(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as Record<string, unknown>).__reloadMarker === true);
}

test.describe('dev server content reload (#1619)', () => {
  test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'file-watching behaviour is browser-independent');

  test('a tutorial content change reloads site pages but not the editor', async ({ page, context }) => {
    const touched = join(repoRoot, 'tutorials', `_reload-check-${Date.now()}.md`);

    await page.goto('/');
    await waitForStore(page);
    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Create' }).click();
    let editorDialogs = 0;
    page.on('dialog', (d) => {
      editorDialogs++;
      void d.dismiss();
    });
    await setMarker(page);

    const sitePage = await context.newPage();
    await sitePage.goto('/blog/');
    await sitePage.waitForLoadState('load');
    // Give the HMR socket a moment to connect before the change.
    await sitePage.waitForFunction(() => document.querySelector('script[type="module"]') !== null);
    await sitePage.waitForTimeout(1000);
    await setMarker(sitePage);

    const siteReloaded = sitePage.waitForEvent('load', { timeout: 30_000 });
    try {
      writeFileSync(touched, 'x\n');
      await siteReloaded;
    } finally {
      rmSync(touched, { force: true });
    }

    expect(await hasMarker(sitePage)).toBe(false);
    // The delete fires a second event; let both settle before checking the editor.
    await page.waitForTimeout(1500);
    expect(await hasMarker(page)).toBe(true);
    expect(editorDialogs).toBe(0);
  });
});
