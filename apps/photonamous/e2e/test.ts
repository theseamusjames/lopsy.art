import { test as base, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { suiteBrowser } from './gpu-args';

export { expect } from '@playwright/test';
export type { BrowserContext, Download, Locator, Page } from '@playwright/test';

/**
 * The `test` every spec imports. In Chromium and Firefox it is
 * Playwright's own, unchanged.
 *
 * In Playwright's WebKit each test's context is a persistent one, in a
 * profile under the test's output directory. Playwright's WebKit makes its
 * ordinary contexts ephemeral, like Safari's Private Browsing, and there
 * the browser's private file system refuses to open
 * (`navigator.storage.getDirectory()` fails with "UnknownError"), so the
 * "This browser" library every library spec uses could not open at all.
 * Safari outside a private window opens it, as a persistent context does.
 * The context is given the options the project and the spec set (viewport,
 * base URL, the stored Edit sections), as Playwright's own would be.
 *
 * WebKit keeps the private file system of every persistent context in one
 * place of its own (`~/Library/WebKit/org.webkit.Playwright` on macOS),
 * not in the profile, so each test empties it for its origins first, and
 * the WebKit suite runs on one worker: two at once would share a library.
 */
export const test =
  suiteBrowser === 'webkit'
    ? base.extend({
        context: async ({ playwright, headless, launchOptions, viewport, baseURL, storageState, acceptDownloads, deviceScaleFactor, userAgent, permissions }, use, testInfo) => {
          if (testInfo.config.workers > 1) throw new Error('The WebKit suite shares one private file system: run it with one worker');
          const context: BrowserContext = await playwright.webkit.launchPersistentContext(testInfo.outputPath('webkit-profile'), {
            ...launchOptions,
            headless,
            viewport,
            baseURL,
            acceptDownloads,
            deviceScaleFactor,
            userAgent,
            permissions,
          });
          await seedStorage(context, storageState, baseURL);
          await use(context);
          await context.close();
        },
      })
    : base;

type StorageStateOption = BrowserContextOptions['storageState'];

/**
 * Empties the private file system of the base URL's origin and of every
 * origin in the storage state, and writes the storage state's localStorage,
 * one origin at a time, on a blank document served in place of the app so
 * its startup does not run; then closes every page this left open.
 */
async function seedStorage(context: BrowserContext, storageState: StorageStateOption, baseURL: string | undefined): Promise<void> {
  const seeded = typeof storageState === 'object' ? storageState.origins : [];
  const origins = new Map(seeded.map(({ origin, localStorage }) => [origin, localStorage]));
  if (baseURL && !origins.has(new URL(baseURL).origin)) origins.set(new URL(baseURL).origin, []);
  for (const [origin, localStorage] of origins) {
    const page = await context.newPage();
    await page.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto(`${origin}/`);
    await page.evaluate(async (entries) => {
      const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> };
      const names: string[] = [];
      for await (const name of root.keys()) names.push(name);
      for (const name of names) await root.removeEntry(name, { recursive: true });
      for (const { name, value } of entries) window.localStorage.setItem(name, value);
    }, localStorage);
    await page.unroute(`${origin}/**`);
    await page.close();
  }
  for (const page of context.pages()) await page.close();
}
