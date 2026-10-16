// #1233 — The options-bar colour popovers (Text color, Shape fill/stroke)
// ignored Escape. Mid-edit, Escape reached the Text tool and cancelled the
// text while the picker stayed open. Escape now closes the open popover
// first and leaves the text edit alone.

import { test, expect, type Page } from '@playwright/test';
import { createDocument, docToScreen, selectTool, setToolOption, waitForStore } from './helpers';

function picker(page: Page) {
  return page.getByRole('dialog', { name: 'Text color picker' });
}

function colorButton(page: Page) {
  return page.getByRole('toolbar', { name: 'Text options' }).locator('[aria-label="Text color"]');
}

async function editingText(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as {
    __uiStore: { getState: () => { textEditing: { text: string } | null } };
  }).__uiStore.getState().textEditing?.text ?? null);
}

test.describe('#1233 Escape closes options-bar colour popovers', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
  });

  test('mid-edit: Escape closes the text colour picker and keeps the text', async ({ page }) => {
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 48);
    const at = await docToScreen(page, 60, 80);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('HELLO');
    await page.waitForTimeout(150);

    await colorButton(page).click();
    await expect(picker(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(picker(page)).toBeHidden();
    expect(await editingText(page)).toBe('HELLO');

    // A second Escape, with no popover open, cancels the edit as before.
    await page.keyboard.press('Escape');
    await expect.poll(() => editingText(page)).toBeNull();
  });

  test('committed layer: Escape from the hex field closes the picker', async ({ page }) => {
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 48);
    const at = await docToScreen(page, 60, 80);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('HELLO');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    await colorButton(page).click();
    const hex = picker(page).locator('[aria-label="Hex color"]');
    await hex.fill('E03030');
    await hex.press('Enter');
    await expect(picker(page)).toBeVisible();

    await hex.press('Escape');
    await expect(picker(page)).toBeHidden();
  });

  test('shape fill popover closes on Escape', async ({ page }) => {
    await selectTool(page, 'shape');
    const options = page.getByRole('toolbar', { name: 'Shape options' });
    const addFill = options.getByRole('button', { name: 'Add fill color' });
    if (await addFill.isVisible()) {
      await addFill.click();
    } else {
      await options.locator('[aria-label^="Color: rgb("]').first().click();
    }
    const hex = page.locator('[aria-label="Hex color"]');
    await expect(hex).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hex).toBeHidden();
  });
});
