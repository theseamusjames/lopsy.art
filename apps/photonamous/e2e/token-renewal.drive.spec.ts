import { expect, test, type Page } from '@playwright/test';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * Google's token lasts an hour and can only be renewed through its popup,
 * which a browser opens from a click. Once the token is 45 minutes old the
 * next ordinary click renews it, so a long session never meets Reconnect.
 * Against the fake Drive and the sign-in stub, with the page's clock moved.
 */

/** The prompt of every token request the page has made of Google's sign-in. */
async function prompts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stub: unknown = Reflect.get(window, '__lopsyGisStub');
    const requests: unknown = typeof stub === 'object' && stub !== null ? Reflect.get(stub, 'requests') : [];
    if (!Array.isArray(requests)) return [];
    return requests.map((request: unknown) => {
      const prompt: unknown = typeof request === 'object' && request !== null ? Reflect.get(request, 'prompt') : undefined;
      return typeof prompt === 'string' ? prompt : '';
    });
  });
}

test('a click renews a Google token that is 45 minutes old, and not before', async ({ page }) => {
  await page.clock.install();
  await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
  const atSignIn = await prompts(page);
  expect(atSignIn).toHaveLength(1);

  // A young token: clicks are only clicks.
  const spare = page.getByText('Your library is empty');
  await spare.click();
  await page.clock.runFor(100);
  expect(await prompts(page)).toHaveLength(1);

  // 46 minutes on, the next click asks Google again, without showing anything.
  await page.clock.setSystemTime(new Date(Date.now() + 46 * 60 * 1000));
  await spare.click();
  await expect.poll(() => prompts(page)).toEqual([...atSignIn, 'none']);

  // The new token is young: the click after it asks for nothing.
  await page.clock.runFor(100);
  await spare.click();
  await page.clock.runFor(100);
  expect(await prompts(page)).toHaveLength(2);

  // And the library goes on working with it.
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 190) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1, { timeout: 30_000 });
});
