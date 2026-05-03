import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

type SwatchColor = { r: number; g: number; b: number; a: number };

async function openSwatchesPanel(page: import('./fixtures').Page): Promise<void> {
  const btn = page.locator('[aria-label="Swatches"]');
  // The button uses aria-pressed or active class depending on implementation;
  // check visibility of the panel instead.
  const panel = page.locator('[aria-label="Swatches panel"]');
  if (!(await panel.isVisible())) {
    await btn.click();
    await page.waitForTimeout(150);
  }
}

async function ensureColorPanelVisible(page: import('./fixtures').Page): Promise<void> {
  const colorPanel = page.locator('[aria-label="Color panel"]');
  if (!(await colorPanel.isVisible())) {
    await page.locator('[aria-label="Color"]').click();
    await page.waitForTimeout(150);
  }
}

async function getForegroundColor(page: import('./fixtures').Page): Promise<SwatchColor> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { foregroundColor: SwatchColor };
    };
    return store.getState().foregroundColor;
  });
}

test.describe('Swatches Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    // Reset swatches to a known, deterministic set so tests don't depend on localStorage state
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__swatchesStore as {
        setState: (patch: unknown) => void;
      };
      store.setState({
        swatches: [
          { id: 'test-black', name: 'Black', color: { r: 0, g: 0, b: 0, a: 1 } },
          { id: 'test-white', name: 'White', color: { r: 255, g: 255, b: 255, a: 1 } },
          { id: 'test-red', name: 'Red', color: { r: 220, g: 38, b: 38, a: 1 } },
          { id: 'test-blue', name: 'Blue', color: { r: 37, g: 99, b: 235, a: 1 } },
        ],
      });
    });
    await page.waitForTimeout(50);
  });

  test('panel becomes visible after clicking Swatches toolbar button', async ({ page }) => {
    await openSwatchesPanel(page);
    const panel = page.locator('[aria-label="Swatches panel"]');
    await expect(panel).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-open.png' });
  });

  test('swatches grid shows the seeded swatches', async ({ page }) => {
    await openSwatchesPanel(page);
    const grid = page.locator('[data-testid="swatches-grid"]');
    await expect(grid).toBeVisible();
    const swatchButtons = grid.locator('button[data-swatch-id]');
    // We seeded 4 swatches in beforeEach
    await expect(swatchButtons).toHaveCount(4);
    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-grid.png' });
  });

  test('clicking the Black swatch sets foreground color to black', async ({ page }) => {
    await openSwatchesPanel(page);
    // First set foreground to something other than black so the change is detectable
    await ensureColorPanelVisible(page);
    const hexInput = page.locator('[aria-label="Hex color value"]');
    await hexInput.fill('ff6600');
    await hexInput.press('Enter');
    await page.waitForTimeout(100);

    const grid = page.locator('[data-testid="swatches-grid"]');
    const blackSwatch = grid.locator('[data-swatch-id="test-black"]');
    await blackSwatch.click();
    await page.waitForTimeout(100);

    const color = await getForegroundColor(page);
    expect(color.r).toBe(0);
    expect(color.g).toBe(0);
    expect(color.b).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-click-swatch.png' });
  });

  test('clicking the White swatch sets foreground color to white', async ({ page }) => {
    await openSwatchesPanel(page);
    // Set fg to non-white first
    await ensureColorPanelVisible(page);
    const hexInput = page.locator('[aria-label="Hex color value"]');
    await hexInput.fill('000000');
    await hexInput.press('Enter');
    await page.waitForTimeout(100);

    const grid = page.locator('[data-testid="swatches-grid"]');
    const whiteSwatch = grid.locator('[data-swatch-id="test-white"]');
    await whiteSwatch.click();
    await page.waitForTimeout(100);

    const color = await getForegroundColor(page);
    expect(color.r).toBe(255);
    expect(color.g).toBe(255);
    expect(color.b).toBe(255);
  });

  test('add swatch button adds current foreground color', async ({ page }) => {
    await openSwatchesPanel(page);
    // Set a known foreground color
    await ensureColorPanelVisible(page);
    const hexInput = page.locator('[aria-label="Hex color value"]');
    await hexInput.fill('ff6600');
    await hexInput.press('Enter');
    await page.waitForTimeout(100);

    const grid = page.locator('[data-testid="swatches-grid"]');
    const countBefore = await grid.locator('button[data-swatch-id]').count();

    const addBtn = page.locator('[aria-label="Add current foreground color as swatch"]');
    await addBtn.click();
    await page.waitForTimeout(150);

    const countAfter = await grid.locator('button[data-swatch-id]').count();
    expect(countAfter).toBe(countBefore + 1);

    // The last swatch should have an orange background — check its style attribute
    const lastSwatch = grid.locator('button[data-swatch-id]').last();
    const style = await lastSwatch.getAttribute('style');
    // rgba(255, 102, 0, 1) for #ff6600
    expect(style).toContain('255');
    expect(style).toContain('102');

    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-add-swatch.png' });
  });

  test('right-click shows context menu with Rename and Delete', async ({ page }) => {
    await openSwatchesPanel(page);

    const grid = page.locator('[data-testid="swatches-grid"]');
    const firstSwatch = grid.locator('button[data-swatch-id]').first();
    await firstSwatch.click({ button: 'right' });
    await page.waitForTimeout(100);

    const contextMenu = page.locator('[data-testid="swatch-context-menu"]');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.locator('button:has-text("Rename")')).toBeVisible();
    await expect(contextMenu.locator('button:has-text("Delete")')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-context-menu.png' });
  });

  test('delete via context menu removes the swatch', async ({ page }) => {
    await openSwatchesPanel(page);

    const grid = page.locator('[data-testid="swatches-grid"]');
    const countBefore = await grid.locator('button[data-swatch-id]').count();

    const firstSwatch = grid.locator('[data-swatch-id="test-black"]');
    await firstSwatch.click({ button: 'right' });
    await page.waitForTimeout(100);

    const contextMenu = page.locator('[data-testid="swatch-context-menu"]');
    await contextMenu.locator('button:has-text("Delete")').click();
    await page.waitForTimeout(100);

    const countAfter = await grid.locator('button[data-swatch-id]').count();
    expect(countAfter).toBe(countBefore - 1);

    // The black swatch should no longer exist
    await expect(grid.locator('[data-swatch-id="test-black"]')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/swatches-panel-delete-swatch.png' });
  });
});
