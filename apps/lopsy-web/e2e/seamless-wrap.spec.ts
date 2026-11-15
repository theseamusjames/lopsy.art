import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readSeamlessState(page: Page): Promise<{
  showSeamlessPattern: boolean;
  dimSeamlessPattern: boolean;
  wrapSeamlessPattern: boolean;
}> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        showSeamlessPattern: boolean;
        dimSeamlessPattern: boolean;
        wrapSeamlessPattern: boolean;
      };
    };
    const s = ui.getState();
    return {
      showSeamlessPattern: s.showSeamlessPattern,
      dimSeamlessPattern: s.dimSeamlessPattern,
      wrapSeamlessPattern: s.wrapSeamlessPattern,
    };
  });
}

async function enableSeamlessPattern(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { showSeamlessPattern: boolean; toggleSeamlessPattern: () => void };
    };
    if (!ui.getState().showSeamlessPattern) ui.getState().toggleSeamlessPattern();
  });
  await page.waitForTimeout(50);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Seamless "Wrap" option (#349)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 100, false);
    await page.waitForTimeout(150);
  });

  test('wrapSeamlessPattern defaults to false and dimSeamlessPattern defaults to true', async ({ page }) => {
    const s = await readSeamlessState(page);
    expect(s.showSeamlessPattern).toBe(false);
    expect(s.dimSeamlessPattern).toBe(true);
    expect(s.wrapSeamlessPattern).toBe(false);
  });

  test('Wrap checkbox is hidden when seamless preview is off', async ({ page }) => {
    // With seamless off, neither the "Dim pattern" nor "Wrap" checkbox
    // should be reachable in the options bar.
    const wrap = page.locator('label:has-text("Wrap") input[type="checkbox"]');
    await expect(wrap).toHaveCount(0);
  });

  test('Wrap checkbox appears next to "Dim pattern" when seamless is on', async ({ page }) => {
    await enableSeamlessPattern(page);

    const dim = page.locator('label:has-text("Dim pattern") input[type="checkbox"]');
    const wrap = page.locator('label:has-text("Wrap") input[type="checkbox"]');
    await expect(dim).toBeVisible();
    await expect(wrap).toBeVisible();

    // Default checkbox states reflect the store defaults.
    expect(await dim.isChecked()).toBe(true);
    expect(await wrap.isChecked()).toBe(false);
  });

  test('clicking Wrap flips wrapSeamlessPattern in the store; unclicking flips it back', async ({ page }) => {
    await enableSeamlessPattern(page);

    const wrap = page.locator('label:has-text("Wrap") input[type="checkbox"]');
    await expect(wrap).toBeVisible();

    // Toggle on.
    await wrap.click();
    await page.waitForTimeout(50);
    expect(await wrap.isChecked()).toBe(true);
    expect((await readSeamlessState(page)).wrapSeamlessPattern).toBe(true);

    // Toggle off.
    await wrap.click();
    await page.waitForTimeout(50);
    expect(await wrap.isChecked()).toBe(false);
    expect((await readSeamlessState(page)).wrapSeamlessPattern).toBe(false);
  });

  test('turning seamless off hides the Wrap checkbox but preserves its stored value', async ({ page }) => {
    // The Wrap flag persists so that turning seamless back on restores the
    // user's previous choice. This is the same shape as "Dim pattern".
    await enableSeamlessPattern(page);
    const wrap = page.locator('label:has-text("Wrap") input[type="checkbox"]');
    await wrap.click();
    await page.waitForTimeout(50);
    expect((await readSeamlessState(page)).wrapSeamlessPattern).toBe(true);

    // Turn seamless off.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleSeamlessPattern: () => void };
      };
      ui.getState().toggleSeamlessPattern();
    });
    await page.waitForTimeout(50);

    // Checkbox is gone from the DOM, but the store retains wrap=true.
    await expect(wrap).toHaveCount(0);
    expect((await readSeamlessState(page)).wrapSeamlessPattern).toBe(true);
  });
});
