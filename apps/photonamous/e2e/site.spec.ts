import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * Smoke test of Photonamous' production build at `/` on its own origin, as
 * on photonamous.com (playwright.site.config.ts): it loads with its CSP and
 * no COOP, with no CSP violation, failed request or console error; deep
 * links get the app; and Edit in Lopsy opens lopsy.art, the build's
 * default.
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

test('Photonamous loads with its CSP and no COOP', async ({ page }) => {
  const problems = watch(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  // A COOP header would cut the sign-in popup and Lopsy's tab off from their openers.
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
  await expect(page).toHaveTitle('Photonamous');
  await expect(page.getByRole('heading', { name: 'Photonamous' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await cspViolations(page)).toEqual([]);
  expect(problems.list).toEqual([]);
});

test('search engines may list it', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['x-robots-tag']).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /photo library/);
  // The pages.dev copy names photonamous.com, so it is not listed in its place.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://photonamous.com/');

  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  const rules = await robots.text();
  expect(rules).toContain('Allow: /');
  expect(rules).not.toMatch(/Disallow: \/\s*$/m);
  expect(rules).toContain('Sitemap: https://photonamous.com/sitemap.xml');

  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('<loc>https://photonamous.com/</loc>');
});

test('a deep link gets the app', async ({ page }) => {
  const problems = watch(page);
  const response = await page.goto('/some/deep/link');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Photonamous');
  await expect(page.getByRole('heading', { name: 'Photonamous' })).toBeVisible();
  expect(await cspViolations(page)).toEqual([]);
  expect(problems.list).toEqual([]);
});

test('Edit in Lopsy opens lopsy.art', async ({ page, context }) => {
  // Nothing reaches the real lopsy.art: a blank page stands in for it.
  await context.route(
    (url) => url.origin === 'https://lopsy.art',
    (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lopsy</title>' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'handoff.jpg', buffer: await generatedJpeg(page, 200) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const [lopsy] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Edit in Lopsy/ }).click(),
  ]);
  await lopsy.waitForLoadState();
  const url = new URL(lopsy.url());
  expect(url.origin).toBe('https://lopsy.art');
  expect(url.pathname).toBe('/');
  expect(url.searchParams.get('photos-handoff')).toBeTruthy();
});
