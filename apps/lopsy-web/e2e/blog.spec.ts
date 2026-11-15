import { test, expect, type Page } from './fixtures';

/**
 * Firefox logs "Image corrupt or truncated" when navigation cancels a
 * half-downloaded progressive JPEG, so let the list thumbnails finish first.
 */
async function waitForListImages(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('.post-summary-image img').evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete)))
    .toBe(true);
}

test.describe('Blog', () => {
  test('the Blog link sits next to Tutorials and opens the blog in a new tab', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();

    const tutorialsLink = page.getByRole('link', { name: 'Tutorials', exact: true });
    const blogLink = page.getByRole('link', { name: 'Blog', exact: true });
    const tutorialsBox = await tutorialsLink.boundingBox();
    const blogBox = await blogLink.boundingBox();
    expect(blogBox?.x).toBeGreaterThan((tutorialsBox?.x ?? 0) + (tutorialsBox?.width ?? 0) - 1);
    expect(Math.abs((blogBox?.y ?? 0) - (tutorialsBox?.y ?? -100))).toBeLessThan(2);

    const [blog] = await Promise.all([context.waitForEvent('page'), blogLink.click()]);
    await blog.waitForLoadState();
    expect(new URL(blog.url()).pathname).toBe('/blog/');
    await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();
  });

  test('the list page opens a post with its article, byline and structured data', async ({ page }) => {
    await page.goto('/blog/');
    await waitForListImages(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Blog');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://lopsy.art/blog/');
    await expect(page.locator('link[rel="alternate"][type="application/atom+xml"]')).toHaveAttribute('href', '/blog/feed.xml');

    const firstPost = page.locator('.post-summary h2 a').first();
    const title = (await firstPost.textContent()) ?? '';
    expect(title.length).toBeGreaterThan(0);
    await firstPost.click();
    await page.waitForURL(/\/blog\/[a-z0-9-]+\/$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('.post-byline').first()).toContainText('min read');
    await expect(page.locator('.prose > *').first()).toBeVisible();

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    const graph = JSON.parse(jsonLd ?? '{}')['@graph'] as Array<{ '@type': string; headline?: string }>;
    expect(graph.find((node) => node['@type'] === 'BlogPosting')?.headline).toBe(title);

    const images = page.locator('.prose img');
    for (let i = 0; i < (await images.count()); i += 1) {
      const image = images.nth(i);
      await expect(image).toHaveAttribute('width', /\d+/);
      await image.scrollIntoViewIfNeeded();
      // Firefox rejects decode() on a lazy image that hasn't started loading, so poll instead.
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0);
    }

    await page.locator('.site-nav').getByRole('link', { name: 'Blog', exact: true }).click();
    await page.waitForURL('**/blog/');
  });

  test('a post with a hero shows it under the header, and its share image on the list and in previews', async ({ page }) => {
    await page.goto('/blog/');
    await waitForListImages(page);
    const summary = page.locator('.post-summary.has-image').first();
    const thumbnailSrc = await summary.locator('.post-summary-image img').getAttribute('src');
    await summary.locator('h2 a').click();
    await page.waitForURL(/\/blog\/[a-z0-9-]+\/$/);

    // The list shows the post's share image (its hero when it has none), the same one link previews use.
    const hero = page.locator('.post-hero img');
    await expect(hero).toHaveAttribute('src', /\/blog\/[a-z0-9-]+\/[^/]+\.(jpe?g|png|webp)$/);
    await expect.poll(() => hero.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', `https://lopsy.art${thumbnailSrc}`);

    // Landscape heroes run wider than the text; square and portrait ones match it.
    const heroBox = await hero.boundingBox();
    const proseBox = await page.locator('.prose').boundingBox();
    expect(heroBox?.width).toBeGreaterThanOrEqual((proseBox?.width ?? Infinity) - 1);
  });

  test('a gallery scrolls sideways with the next and previous buttons', async ({ page }) => {
    await page.goto('/blog/');
    await waitForListImages(page);
    await page.locator('.post-summary h2 a').first().click();
    await page.waitForURL(/\/blog\/[a-z0-9-]+\/$/);

    const gallery = page.locator('.post-gallery').first();
    await gallery.scrollIntoViewIfNeeded();
    expect(await gallery.locator('li img').count()).toBeGreaterThan(1);
    const scroller = gallery.locator('.post-gallery-scroller');
    const scrollLeft = () => scroller.evaluate((el) => el.scrollLeft);

    const prev = gallery.getByRole('button', { name: 'Previous images' });
    const next = gallery.getByRole('button', { name: 'Next images' });
    await expect(prev).toBeHidden();
    await next.click();
    await expect.poll(scrollLeft).toBeGreaterThan(100);
    await expect(prev).toBeVisible();
    await prev.click();
    await expect.poll(scrollLeft).toBe(0);
    await expect(prev).toBeHidden();
  });

  test('on a phone the hero runs edge to edge and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/blog/');
    await waitForListImages(page);
    await page.locator('.post-summary.has-image h2 a').first().click();
    await page.waitForURL(/\/blog\/[a-z0-9-]+\/$/);

    const heroBox = await page.locator('.post-hero img').boundingBox();
    expect(Math.round(heroBox?.x ?? -1)).toBe(0);
    expect(Math.round(heroBox?.width ?? 0)).toBe(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  });

  test('the footer links to the RSS feed and the GitHub profile on every site page', async ({ page, request }) => {
    for (const path of ['/blog/', '/tutorials/']) {
      await page.goto(path);
      await waitForListImages(page);
      const footer = page.locator('footer.site-footer');
      await expect(footer.getByRole('link', { name: 'Subscribe via RSS' })).toHaveAttribute('href', '/blog/feed.xml');
      await expect(footer).toContainText('© 2026');
      await expect(footer.getByRole('link', { name: 'Seamus James', exact: true })).toHaveAttribute('href', 'https://github.com/theseamusjames');
    }
    const feedHref = await page.locator('footer.site-footer').getByRole('link', { name: 'Subscribe via RSS' }).getAttribute('href');
    const feed = await request.get(feedHref ?? '');
    expect(feed.ok()).toBe(true);
    expect(await feed.text()).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
  });

  test('the footer sits at the bottom of the window on a short page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto('/blog/');
    await waitForListImages(page);
    const footerBottom = await page.locator('footer.site-footer').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(Math.round(footerBottom)).toBe(1400);
  });

  test('each card on the list ends with a Read more link to its post', async ({ page }) => {
    await page.goto('/blog/');
    await waitForListImages(page);
    const card = page.locator('.post-summary').first();
    const title = (await card.locator('h2 a').textContent()) ?? '';
    const readMore = card.getByRole('link', { name: `Read more: ${title}` });
    await expect(readMore).toHaveText('Read more...');
    await readMore.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  });

  test('a long code block is capped and scrolls, and Copy still copies all of it', async ({ page, browserName }) => {
    await page.goto('/blog/');
    await waitForListImages(page);
    await page.locator('.post-summary h2 a').first().click();
    await page.waitForURL(/\/blog\/[a-z0-9-]+\/$/);

    const pre = page.locator('.code-block pre').first();
    await pre.scrollIntoViewIfNeeded();
    const { clientHeight, scrollHeight, fullText } = await pre.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      fullText: el.textContent ?? '',
    }));
    test.skip(scrollHeight <= clientHeight, 'The first code block is short enough not to need a cap.');
    expect(clientHeight).toBeLessThanOrEqual(500);

    await pre.focus();
    await page.keyboard.press('End');
    await expect.poll(() => pre.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Firefox has no clipboard-read permission to grant, so the copy check runs in Chromium.
    if (browserName === 'chromium') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.locator('.code-block').first().getByRole('button', { name: 'Copy' }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullText);
    }
  });

  test('the Atom feed and sitemap list the posts', async ({ page, request }) => {
    await page.goto('/blog/');
    await waitForListImages(page);
    const postPaths = await page.locator('.post-summary h2 a').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
    expect(postPaths.length).toBeGreaterThan(0);

    const feed = await request.get('/blog/feed.xml');
    expect(feed.headers()['content-type']).toContain('application/xml');
    const feedXml = await feed.text();
    expect(feedXml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');

    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>https://lopsy.art/blog/</loc>');
    expect(sitemap).toContain('<loc>https://lopsy.art/tutorials/</loc>');
    for (const path of postPaths) {
      expect(feedXml).toContain(`<id>https://lopsy.art${path}</id>`);
      expect(sitemap).toContain(`<loc>https://lopsy.art${path}</loc>`);
    }
  });

  test('blog URLs without a trailing slash redirect to the canonical form', async ({ page }) => {
    await page.goto('/blog');
    expect(new URL(page.url()).pathname).toBe('/blog/');
  });
});
