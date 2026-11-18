import { expect, test } from '@playwright/test';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * Offline start (spec 5.7) on the production build (playwright.offline.config.ts):
 * the service worker serves the app shell, the library opens from the
 * device, and changes made offline are kept and saved.
 */
test('the app starts offline and keeps working', async ({ page, context }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto('/photos/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'offline.jpg', buffer: await generatedJpeg(page, 120) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  const id = (await tiles(page).first().getAttribute('data-asset-id')) ?? '';
  const tile = page.locator(`[data-asset-id="${id}"]`);
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });

  // The worker has installed and controls the page.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? null))
    .toBe('activated');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(tiles(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(tile.locator('img')).toBeVisible();
  expect(await tile.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // A change made offline is kept on the device.
  await tile.click();
  await page.keyboard.press('3');
  await expect(tile).toHaveAttribute('data-rating', '3');

  // A deep link reloads offline too: the shell serves every path under /photos/.
  await page.goto('/photos/some/deep/link');
  await expect(tiles(page)).toHaveCount(1, { timeout: 30_000 });

  await context.setOffline(false);
  await expect(tile).toHaveAttribute('data-rating', '3');
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(tile).toHaveAttribute('data-rating', '3', { timeout: 30_000 });
  expect(problems).toEqual([]);
});

test('a cached file that another script on the origin changed is not served', async ({ page, context }) => {
  await page.goto('/photos/');
  await expect(page.getByRole('heading', { name: 'Lopsy Photos' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // What a script injected anywhere on the origin could do: replace the app's code in the shell cache.
  const script = await page.evaluate(async () => {
    const src = new URL(document.querySelector<HTMLScriptElement>('script[type="module"]')?.src ?? '').pathname;
    const name = (await caches.keys()).find((key) => key.startsWith('lopsy-photos-shell-')) ?? '';
    const cache = await caches.open(name);
    await cache.put(src, new Response('window.__evil = true;', { headers: { 'Content-Type': 'text/javascript' } }));
    return { src, name };
  });

  // A fresh worker, as after the browser stopped the idle one.
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lopsy Photos' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__evil'))).toBeUndefined();
  const cached = await page.evaluate(async ({ src, name }) => (await (await caches.open(name)).match(src))?.text() ?? '', script);
  expect(cached).not.toContain('__evil');
  expect(cached.length).toBeGreaterThan(1000);
});
