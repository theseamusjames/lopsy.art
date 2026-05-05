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

  test('File > Export As… opens the Export dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
    await page.waitForTimeout(200);

    // The dialog should be visible with its heading
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-open.png' });
  });

  test('dialog shows format buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByRole('button', { name: 'PNG' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'JPEG' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'WebP' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'BMP' })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-png.png' });
  });

  test('quality slider is hidden when PNG is selected', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });

    // PNG is the default format — quality slider should not be present
    // The Slider component renders a label "Quality" only for lossy formats
    await expect(dialog.getByText('Quality')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-png-no-quality.png' });
  });

  test('quality slider appears when JPEG is selected', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });

    // Switch to JPEG
    await dialog.getByRole('button', { name: 'JPEG' }).click();
    await page.waitForTimeout(100);

    // Quality slider label should now be visible
    await expect(dialog.getByText('Quality')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-jpeg-quality.png' });
  });

  test('dimensions display updates when scale changes', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });

    // At 1x, document is 200×150
    await expect(dialog.getByText('200 × 150 px')).toBeVisible();

    // Switch to 2x — dimensions should double
    await dialog.getByRole('button', { name: '2×' }).click();
    await page.waitForTimeout(100);

    await expect(dialog.getByText('400 × 300 px')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-scale-2x.png' });
  });

  test('Cancel button closes the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
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
    await page.getByRole('menuitem', { name: 'Export As…' }).click();
    await page.waitForTimeout(200);

    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByRole('button', { name: 'Export' }).click();

    const download = await downloadPromise;
    // Default format is PNG, filename defaults to document name 'Untitled'
    expect(download.suggestedFilename()).toBe('Untitled.png');

    await page.screenshot({ path: 'e2e/screenshots/export-dialog-downloaded.png' });
  });
});
