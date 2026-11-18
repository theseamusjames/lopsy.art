import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test of the assembled lopsy.art site (playwright.site.config.ts):
 * both apps load from their paths with no CSP violation, failed request or
 * console error, and Photos' SPA rule wins under /photos/.
 */

interface Problems {
  readonly list: string[];
}

function watch(page: Page): Problems {
  const problems: Problems = { list: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') problems.list.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.list.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => problems.list.push(`failed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && ['localhost', '127.0.0.1'].includes(new URL(response.url()).hostname)) {
      problems.list.push(`${response.status()}: ${response.url()}`);
    }
  });
  return problems;
}

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (Reflect.get(window, '__cspViolations') as string[] | undefined) ?? []);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Reflect.set(window, '__cspViolations', seen);
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
});

test('Lopsy loads at /', async ({ page }) => {
  const problems = watch(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Lopsy/);
  await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await cspViolations(page)).toEqual([]);
  expect(problems.list).toEqual([]);
});

test('Photos loads at /photos/ with its CSP and no COOP', async ({ page }) => {
  const problems = watch(page);
  const response = await page.goto('/photos/');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Lopsy Photos' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await cspViolations(page)).toEqual([]);
  expect(problems.list).toEqual([]);
});

test('a deep link under /photos/ serves Photos, not Lopsy', async ({ page }) => {
  const problems = watch(page);
  const response = await page.goto('/photos/some/deep/link');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Lopsy Photos');
  await expect(page.getByRole('heading', { name: 'Lopsy Photos' })).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(problems.list).toEqual([]);
});

test("Lopsy's handoff default points at the served Photos", async ({ page }) => {
  // The production build has no VITE_PHOTOS_URL, so Lopsy hands off to the default.
  const assets = join(import.meta.dirname, '../../../dist/assets');
  const bundles = readdirSync(assets).filter((name) => name.endsWith('.js'));
  const withDefault = bundles.filter((name) => readFileSync(join(assets, name), 'utf8').includes('"/photos/"'));
  expect(withDefault.length).toBeGreaterThan(0);

  await page.goto('/');
  const photosUrl = await page.evaluate(() => new URL('/photos/', window.location.href).href);
  const photos = await page.request.get(photosUrl);
  expect(photos.status()).toBe(200);
  expect(await photos.text()).toContain('<title>Lopsy Photos</title>');
});

test("a first Photos visit under Lopsy's root worker neither reloads nor offers an update", async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  // Lopsy registers its own worker at /sw.js, scope /, and it claims the origin's pages.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state ?? null))
    .toBe('activated');

  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto('/photos/');
  await expect(page.getByRole('heading', { name: 'Lopsy Photos' })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, '__firstVisit', true));
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/photos/'))?.active?.state ?? null))
    .toBe('activated');
  // Photos' worker takes over the page (clients.claim); that must not reload it.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toContain('/photos/sw.js');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Reflect.get(window, '__firstVisit'))).toBe(true);
  expect(loads).toBe(1);
  await expect(page.getByText('New version ready')).toHaveCount(0);
  expect(await cspViolations(page)).toEqual([]);
  expect(problems.list).toEqual([]);
});
