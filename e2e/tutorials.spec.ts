import { test, expect } from './fixtures';

test.describe('Tutorials', () => {
  test('Help → Tutorials opens the list, and a card opens the tutorial', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await page.getByText('Help', { exact: true }).click();
    const [tutorials] = await Promise.all([
      context.waitForEvent('page'),
      page.getByText('Tutorials', { exact: true }).click(),
    ]);
    await tutorials.waitForLoadState();

    expect(new URL(tutorials.url()).pathname).toBe('/tutorials/');
    await expect(tutorials.getByRole('heading', { level: 1 })).toHaveText('Tutorials');
    await expect(tutorials.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://lopsy.art/tutorials/');

    const card = tutorials.locator('.card').filter({ hasText: 'Make a Neon Glow Text Effect' });
    await card.click();
    await tutorials.waitForURL('**/tutorials/neon-glow-text-effect/');

    await expect(tutorials.getByRole('heading', { level: 1 })).toHaveText('Make a Neon Glow Text Effect');
    const steps = tutorials.locator('ol.steps > li');
    await expect(steps).toHaveCount(8);

    const firstImage = steps.first().locator('img');
    await expect(firstImage).toHaveAttribute('width', /\d+/);
    expect(await firstImage.evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth))).toBeGreaterThan(0);

    const jsonLd = await tutorials.locator('script[type="application/ld+json"]').textContent();
    const graph = JSON.parse(jsonLd ?? '{}')['@graph'] as Array<{ '@type': string; step?: unknown[] }>;
    expect(graph.find((node) => node['@type'] === 'HowTo')?.step).toHaveLength(8);

    await tutorials.getByRole('link', { name: 'Tutorials', exact: true }).first().click();
    await tutorials.waitForURL('**/tutorials/');
  });

  test('tutorial URLs without a trailing slash redirect to the canonical form', async ({ page }) => {
    await page.goto('/tutorials/neon-glow-text-effect');
    expect(new URL(page.url()).pathname).toBe('/tutorials/neon-glow-text-effect/');
  });
});
