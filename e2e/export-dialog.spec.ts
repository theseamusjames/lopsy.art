import { test, expect } from './fixtures';
import { waitForStore, createDocument, drawRect } from './helpers';

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 150, false);
    await page.waitForTimeout(300);
    await drawRect(page, 20, 20, 80, 60, { r: 0, g: 120, b: 255 });
    await page.waitForTimeout(200);
  });

  test('File > Export… opens the Export dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    // The dialog should be visible with its heading
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-open.png' });
  });

  test('dialog shows format buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByRole('button', { name: 'PNG' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'JPEG' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'WebP' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'BMP' })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-png.png' });
  });

  test('PNG shows quality toggle (Regular/High) instead of quality slider', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });

    // PNG has a Regular/High quality toggle instead of a quality slider
    await expect(dialog.getByRole('button', { name: 'Regular' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'High' })).toBeVisible();
    // The lossy quality slider (range input with aria-label "Quality") should NOT be present
    await expect(dialog.locator('[aria-label="Quality"]')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-png-quality-toggle.png' });
  });

  test('quality slider appears when JPEG is selected', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });

    // Switch to JPEG
    await dialog.getByRole('button', { name: 'JPEG' }).click();
    await page.waitForTimeout(100);

    // Quality slider should be visible for lossy formats
    await expect(dialog.locator('[aria-label="Quality"]')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-jpeg-quality.png' });
  });

  test('dimensions display shows document size', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });

    // Document is 200×150
    await expect(dialog.getByText('200 × 150 px')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-dimensions.png' });
  });

  test('Cancel button closes the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(100);

    await expect(dialog).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-closed.png' });
  });

  test('Export button triggers file download', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByRole('button', { name: 'Export' }).click();

    const download = await downloadPromise;
    // Default format is PNG, filename defaults to document name 'Untitled'
    expect(download.suggestedFilename()).toBe('lopsy.png');

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-downloaded.png' });
  });
});
