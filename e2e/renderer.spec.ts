import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, getPixelAt, paintRect, addLayer } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 200, 200);
});

test.describe('Renderer', () => {
  test('status bar displays renderer type', async ({ page }) => {
    const statusBar = page.locator('[class*="bar"]').last();
    await expect(statusBar).toContainText(/CPU|GPU/);
  });

  test('renderer does not affect pixel data integrity', async ({ page }) => {
    await paintRect(page, 10, 10, 50, 50, { r: 255, g: 0, b: 0, a: 255 });
    const pixel = await getPixelAt(page, 25, 25);
    expect(pixel.r).toBe(255);
    expect(pixel.g).toBe(0);
    expect(pixel.b).toBe(0);
    expect(pixel.a).toBe(255);
  });

  test('renderer status resolves after init', async ({ page }) => {
    await expect(page.locator('text=CPU').or(page.locator('text=GPU')).first()).toBeVisible({ timeout: 10000 });
  });

  test('layer operations work regardless of renderer', async ({ page }) => {
    await addLayer(page);
    await paintRect(page, 0, 0, 10, 10, { r: 0, g: 255, b: 0, a: 255 });
    const pixel = await getPixelAt(page, 5, 5);
    expect(pixel.g).toBe(255);
  });

  test('CanvasKit loads and GPU renderer activates', async ({ page: _page, browser }) => {
    // Create a fresh page with console listener attached BEFORE navigation
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on('console', (msg) => {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      logs.push(`[pageerror] ${err.message}`);
    });

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200);

    // Wait for renderer init to complete
    await page.waitForTimeout(5000);

    const statusText = await page.locator('[class*="bar"]').last().textContent();

    // Dump logs if GPU isn't active
    if (!statusText?.includes('GPU')) {
      console.log(`All ${logs.length} logs:`, JSON.stringify(logs.slice(0, 30)));
    }

    await page.close();
    expect(statusText).toContain('GPU');
  });
});
