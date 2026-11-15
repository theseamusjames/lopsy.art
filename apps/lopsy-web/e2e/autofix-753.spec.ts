import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, getEditorState } from './helpers';

// Coverage for the nightly autofix batch:
// - #753 (Canvas Size and Image Size dialogs now accept inches with a
//   DPI setting, matching the New Document flow, so a doc created in
//   inches can be resized in inches without hand-converting to pixels)

async function openImageMenuItem(page: Page, itemLabel: string): Promise<void> {
  await page.locator('button:has-text("Image")').first().click();
  await page.locator(`[role="menuitem"]:has-text("${itemLabel}")`).click();
  await page.waitForTimeout(200);
}

test.describe('#753 — Canvas/Image Size support inches and DPI', () => {
  test('Canvas Size accepts inches at a chosen DPI and resizes to the pixel equivalent', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar requires desktop layout');
    await page.goto('/');
    await waitForStore(page);

    // 300 x 300 px canvas so we can pick clean inch values.
    await createDocument(page, 300, 300, false);

    await openImageMenuItem(page, 'Canvas Size');

    const dialog = page.getByRole('dialog', { name: 'Canvas Size' });
    await expect(dialog).toBeVisible();

    // Switch to inches — the field values should re-express as inches, and
    // a DPI input should appear (it does not exist in pixel mode).
    const unitSelect = dialog.getByLabel('Unit');
    await unitSelect.selectOption('in');

    const dpiInput = dialog.locator('input[type="number"]').nth(2);
    await dpiInput.fill('300');

    // Ask for a 2 x 3 inch canvas at 300 DPI → 600 x 900 px.
    const widthInput = dialog.locator('input[type="number"]').first();
    const heightInput = dialog.locator('input[type="number"]').nth(1);
    await widthInput.fill('2');
    await heightInput.fill('3');

    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(200);

    const state = await getEditorState(page);
    expect(state.document.width).toBe(600);
    expect(state.document.height).toBe(900);
  });

  test('Image Size accepts inches at a chosen DPI and resamples the document', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar requires desktop layout');
    await page.goto('/');
    await waitForStore(page);

    // 400 x 200 px canvas — a clean 2:1 ratio so constrain-proportions
    // does the right thing when we type only the width in inches.
    await createDocument(page, 400, 200, false);

    await openImageMenuItem(page, 'Image Size');

    const dialog = page.getByRole('dialog', { name: 'Image Size' });
    await expect(dialog).toBeVisible();

    const unitSelect = dialog.getByLabel('Unit');
    await unitSelect.selectOption('in');

    const dpiInput = dialog.locator('input[type="number"]').nth(2);
    await dpiInput.fill('72');

    // Type only width — constrain proportions should update height in
    // inches too. 5 in × 72 DPI = 360 px, and the linked height at 2:1
    // is 180 px.
    const widthInput = dialog.locator('input[type="number"]').first();
    await widthInput.fill('5');

    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(200);

    const state = await getEditorState(page);
    expect(state.document.width).toBe(360);
    expect(state.document.height).toBe(180);
  });
});
