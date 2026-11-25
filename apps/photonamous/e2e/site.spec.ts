import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * Smoke test of Photonamous' production build at `/` on its own origin, as
 * on photonamous.com (playwright.site.config.ts): it loads with its CSP and
 * no COOP, with no CSP violation, failed request or console error; deep
 * links get the app; Edit in Lopsy opens lopsy.art, the build's default;
 * and the Privacy Policy and Terms are pages of their own, readable
 * without script, accessible, and left alone by the service worker.
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** The pages that are documents, not the app (vite.config.ts, DOCUMENT_PAGES). */
const DOCUMENTS = [
  { path: '/privacy', title: 'Privacy Policy · Photonamous', heading: 'Privacy Policy', other: { name: 'Terms', href: '/terms' } },
  { path: '/terms', title: 'Terms of Service · Photonamous', heading: 'Terms of Service', other: { name: 'Privacy', href: '/privacy' } },
] as const;

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
  const listed = await sitemap.text();
  expect(listed).toContain('<loc>https://photonamous.com/</loc>');
  for (const { path } of DOCUMENTS) expect(listed).toContain(`<loc>https://photonamous.com${path}</loc>`);
});

test('a shared link shows the preview image', async ({ page }) => {
  await page.goto('/');
  const meta = (key: string) => page.locator(`meta[property="${key}"], meta[name="${key}"]`);
  const image = await meta('og:image').getAttribute('content');
  // Link previews need an absolute URL, on the one address the site is listed under.
  expect(image).toBe('https://photonamous.com/og-image.jpg');
  await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image');
  await expect(meta('twitter:image')).toHaveAttribute('content', image ?? '');
  await expect(meta('og:image:alt')).toHaveAttribute('content', /\S/);
  await expect(meta('twitter:image:alt')).toHaveAttribute('content', /\S/);
  await expect(meta('og:image:width')).toHaveAttribute('content', '1200');
  await expect(meta('og:image:height')).toHaveAttribute('content', '630');

  // This build serves it, as the type the page says it is.
  const path = new URL(image ?? '').pathname;
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe(await meta('og:image:type').getAttribute('content'));
  expect(response.headers()['content-type']).toMatch(/^image\//);
  const size = await page.evaluate(async (path) => {
    const bitmap = await createImageBitmap(await (await fetch(path)).blob());
    return { width: bitmap.width, height: bitmap.height };
  }, path);
  expect(size).toEqual({ width: 1200, height: 630 });

  // The app never shows it, so the service worker leaves it to the network.
  const manifest = await (await page.request.get('/sw.js')).text();
  expect(manifest).toContain('"/manifest.webmanifest"');
  expect(manifest).not.toContain(`"${path}"`);
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

/**
 * axe-core's WCAG 2.2 AA rules on the page as it stands. The source is
 * evaluated from here, not added as a script element, which the site's
 * CSP would refuse.
 */
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async (tags) => {
    const axe = Reflect.get(window, 'axe') as {
      run: (context: Document, options: object) => Promise<{
        passes: unknown[];
        violations: { id: string; help: string; nodes: { target: string[] }[] }[];
      }>;
    };
    const result = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    // A scan that checked nothing would pass too.
    if (result.passes.length === 0) return ['axe-core ran no rule on this page'];
    return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  }, AXE_TAGS);
}

for (const { path, title, heading, other } of DOCUMENTS) {
  test(`${path} is a page of its own, readable without script`, async ({ page }) => {
    const problems = watch(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(response?.headers()['x-robots-tag']).toBeUndefined();
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://photonamous.com${path}`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);

    // The words are in the HTML itself: nothing has to run for a reader, or Google's review, to see them.
    await expect(page.locator('script')).toHaveCount(0);
    // Styled by the shared tokens and fonts.
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(30, 30, 30)');
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Inter');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px Inter'))).toBe(true);

    // The way back to the app, and across to the other document.
    const nav = page.getByRole('navigation', { name: 'Photonamous' });
    await expect(nav.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/');
    await expect(nav.getByRole('link', { name: other.name })).toHaveAttribute('href', other.href);
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', path);

    // Asked for by its file name, Pages sends the reader to the one address.
    const byFile = await page.request.get(`${path}.html`, { maxRedirects: 0 });
    expect(byFile.status()).toBe(308);
    expect(byFile.headers()['location']).toBe(path);

    await page.waitForLoadState('networkidle');
    expect(await cspViolations(page)).toEqual([]);
    expect(problems.list).toEqual([]);
  });

  test(`${path} meets WCAG 2.2 AA, on a desktop and on a phone`, async ({ page }) => {
    await page.goto(path);
    expect(await axeViolations(page)).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(path);
    // Reflow (1.4.10): no sideways scrolling at 320 CSS px.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);

    // The keyboard reaches the skip link first, and it shows.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /^Skip to the/ });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
  });
}

test('the start screen links to the Privacy Policy and the Terms', async ({ page }) => {
  // Google's review wants the policy linked from the home page, at the address given on the consent screen.
  for (const { path, heading, other } of DOCUMENTS) {
    await page.goto('/');
    const name = other.name === 'Terms' ? 'Privacy' : 'Terms';
    const link = page.getByRole('navigation', { name: 'About Photonamous' }).getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    // And back to the app.
    await page.getByRole('navigation', { name: 'Photonamous' }).getByRole('link', { name: 'Open the app' }).click();
    await expect(page.getByRole('navigation', { name: 'About Photonamous' })).toBeVisible();
  }
});

test('the Privacy Policy says what Google asks an app using Drive to say', async ({ page }) => {
  await page.goto('/privacy');
  const policy = page.getByRole('main');
  // How the app accesses, uses, stores and shares Google user data, each under its own heading.
  for (const name of ['What it can access', 'What it does with it', 'Where it is stored', 'Who it is shared with']) {
    await expect(policy.getByRole('heading', { name })).toBeVisible();
  }
  await expect(policy).toContainText('See, edit, create and delete only the specific Google Drive files you use with this app');
  await expect(policy).toContainText('including the Limited Use requirements');
  await expect(policy.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute(
    'href',
    'https://developers.google.com/terms/api-services-user-data-policy',
  );
  await expect(policy.getByRole('heading', { name: 'Keeping and deleting your data' })).toBeVisible();
});

test('the service worker leaves the Privacy Policy and Terms to the network', async ({ page, context }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // They are not part of the offline shell.
  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cached).toContain('/');
  expect(cached.filter((path) => /privacy|terms/.test(path))).toEqual([]);

  // With the worker in control, each is still its own page, not the app.
  for (const { path, heading } of DOCUMENTS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }

  // Offline, the app's own paths get the shell, and a document fails as any page does: the app never stands in for it.
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Photonamous' })).toBeVisible();
  await expect(page.goto('/privacy')).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  await context.setOffline(false);
});

test('the app loads no analytics of its own: Cloudflare adds it, as on lopsy.art', async ({ page }) => {
  // Zaraz and Web Analytics are injected at Cloudflare's edge (public/_headers says how the policy allows them),
  // so the files this build serves ask nothing of Google's or Cloudflare's analytics hosts.
  const asked: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (/googletagmanager\.com$|google-analytics\.com$|analytics\.google\.com$|cloudflareinsights\.com$/.test(host)) asked.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'About Photonamous' })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'dataLayer'))).toBeUndefined();
  expect(asked).toEqual([]);
});
