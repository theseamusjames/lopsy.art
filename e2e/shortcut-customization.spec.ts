/**
 * E2E tests for keyboard shortcut customization.
 *
 * Strategy:
 * - Open the Keyboard Shortcuts modal via Help > Keyboard Shortcuts.
 * - Interact with the UI to rebind a tool shortcut.
 * - Close the modal and press the new key; assert the tool becomes active
 *   by reading __uiStore.
 * - Verify the modal reflects custom and reset states visually.
 */
import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

async function openShortcutsModal(page: import('@playwright/test').Page) {
  await page.locator('text=Help').click();
  await page.locator('text=Keyboard Shortcuts').click();
  await expect(page.locator('[aria-label="Keyboard Shortcuts"]')).toBeVisible();
}

async function closeShortcutsModal(page: import('@playwright/test').Page) {
  await page.locator('[aria-label="Keyboard Shortcuts"] >> text=Close').click();
  await expect(page.locator('[aria-label="Keyboard Shortcuts"]')).not.toBeVisible();
}

async function getActiveTool(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

async function resetAllCustomShortcuts(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__shortcutStore as {
      getState: () => { resetAllShortcuts: () => void };
    };
    store.getState().resetAllShortcuts();
  });
}

test.describe('Keyboard Shortcut Customization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    // Always start with no custom shortcuts
    await resetAllCustomShortcuts(page);
  });

  test.afterEach(async ({ page }) => {
    await resetAllCustomShortcuts(page);
  });

  test('modal opens with editable shortcut rows', async ({ page }) => {
    await openShortcutsModal(page);

    // The Brush shortcut button should be visible and clickable
    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await expect(brushButton).toBeVisible();
    await expect(brushButton).toHaveText('B');

    await page.screenshot({ path: 'e2e/screenshots/shortcut-modal-default.png' });
    await closeShortcutsModal(page);
  });

  test('clicking a shortcut key enters listening mode', async ({ page }) => {
    await openShortcutsModal(page);

    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await brushButton.click();

    // Should now show the listening prompt
    await expect(brushButton).toHaveText('Press a key…');

    await page.screenshot({ path: 'e2e/screenshots/shortcut-modal-listening.png' });

    // Escape cancels listening without changing the shortcut
    await page.keyboard.press('Escape');
    await expect(brushButton).toHaveText('B');
    await closeShortcutsModal(page);
  });

  test('rebinding a shortcut and pressing the new key activates the tool', async ({ page }) => {
    // Brush default is 'b'. Rebind it to 'q'.
    await openShortcutsModal(page);

    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await brushButton.click();
    await expect(brushButton).toHaveText('Press a key…');

    // Press 'q' to set the new binding
    await page.keyboard.press('q');
    await expect(brushButton).toHaveText('Q');

    await page.screenshot({ path: 'e2e/screenshots/shortcut-modal-after-rebind.png' });
    await closeShortcutsModal(page);

    // Switch to a known different tool first
    await page.keyboard.press('v'); // move tool
    expect(await getActiveTool(page)).toBe('move');

    // 'b' should no longer activate brush (it's been rebound)
    await page.keyboard.press('b');
    // The tool may have changed — 'b' could now be unbound or map to something else
    // What matters is pressing 'q' activates brush
    const toolAfterB = await getActiveTool(page);

    // Switch away again to make the next assertion meaningful
    await page.keyboard.press('v');
    expect(await getActiveTool(page)).toBe('move');

    // 'q' should now activate brush
    await page.keyboard.press('q');
    expect(await getActiveTool(page)).toBe('brush');

    // 'b' should NOT activate brush now (it was rebound away)
    expect(toolAfterB).not.toBe('brush');
  });

  test('reset button restores the default binding', async ({ page }) => {
    await openShortcutsModal(page);

    // Rebind brush to 'q'
    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await brushButton.click();
    await page.keyboard.press('q');
    await expect(brushButton).toHaveText('Q');

    // A reset button should appear for this row
    const resetButton = page.locator('[aria-label="Reset Brush to default"]');
    await expect(resetButton).toBeVisible();

    await resetButton.click();
    // Should restore to default 'B'
    await expect(brushButton).toHaveText('B');
    // Reset button should disappear once back to default
    await expect(resetButton).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/shortcut-modal-after-reset.png' });
    await closeShortcutsModal(page);

    // Confirm the original key 'b' works again
    await page.keyboard.press('v');
    await page.keyboard.press('b');
    expect(await getActiveTool(page)).toBe('brush');
  });

  test('Reset All button clears all custom bindings', async ({ page }) => {
    await openShortcutsModal(page);

    // Rebind brush to 'q'
    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await brushButton.click();
    await page.keyboard.press('q');
    await expect(brushButton).toHaveText('Q');

    // Click Reset All
    await page.locator('button:has-text("Reset All")').click();

    // Brush should revert to 'B'
    await expect(brushButton).toHaveText('B');

    await page.screenshot({ path: 'e2e/screenshots/shortcut-modal-after-reset-all.png' });
    await closeShortcutsModal(page);
  });

  test('conflict warning appears when rebinding to an already-used key', async ({ page }) => {
    await openShortcutsModal(page);

    // Brush is 'b', Eraser is 'e'. Try to rebind Brush to 'e' (Eraser's key).
    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await brushButton.click();
    await page.keyboard.press('e'); // 'e' belongs to Eraser

    // A conflict warning should appear
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page.locator('[role="alert"]')).toContainText('Eraser');

    await page.screenshot({ path: 'e2e/screenshots/shortcut-modal-conflict.png' });
    await closeShortcutsModal(page);
  });

  test('custom shortcuts survive modal close and reopen', async ({ page }) => {
    await openShortcutsModal(page);

    const brushButton = page.locator('[aria-label*="Brush shortcut"]');
    await brushButton.click();
    await page.keyboard.press('q');
    await expect(brushButton).toHaveText('Q');

    await closeShortcutsModal(page);

    // Reopen
    await openShortcutsModal(page);
    // Should still show 'Q'
    await expect(page.locator('[aria-label*="Brush shortcut"]')).toHaveText('Q');

    await closeShortcutsModal(page);
  });
});
