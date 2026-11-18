import { expect, test, type Page } from '@playwright/test';
import { imageStats, openGeneratedImage, openGeneratedImages, openHarness, waitForPreview, waitForReady } from './harness';

/** Types a value into a slider's readout: one history step. */
async function setValue(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}

test.describe('History, versions and the filmstrip', () => {
  test('clicking an earlier step goes back to it without deleting any', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await setValue(page, 'Exposure', '1');
    await setValue(page, 'Contrast', '20');
    await setValue(page, 'Vibrance', '30');

    const history = page.getByTestId('history-list');
    await expect(history.getByRole('button')).toHaveText(['Vibrance +30', 'Contrast +20', 'Exposure +1.00', 'Original']);
    await history.getByRole('button', { name: 'Exposure +1.00' }).click();
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.00');
    await expect(page.getByLabel('Contrast value', { exact: true })).toHaveValue('0');
    await expect(page.getByLabel('Vibrance value', { exact: true })).toHaveValue('0');
    // Nothing was deleted: the later steps are still listed, as undone.
    await expect(history.getByRole('button')).toHaveCount(4);
    await expect(history.getByRole('button', { name: 'Exposure +1.00' })).toHaveAttribute('aria-current', 'step');

    await history.getByRole('button', { name: 'Vibrance +30' }).click();
    await expect(page.getByLabel('Vibrance value', { exact: true })).toHaveValue('+30');
    await expect(page.getByLabel('Contrast value', { exact: true })).toHaveValue('+20');

    await history.getByRole('button', { name: 'Original' }).click();
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('0.00');
  });

  test('New version copies the edit and versions keep their own', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await setValue(page, 'Exposure', '1');

    const versions = page.getByRole('list', { name: 'Versions' });
    await page.getByRole('button', { name: 'New version' }).click();
    const name = page.getByLabel('New version name');
    await name.fill('Bright');
    await name.press('Enter');
    await expect(versions.getByRole('button', { name: 'Bright', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.00');

    await setValue(page, 'Exposure', '2');
    await versions.getByRole('button', { name: 'Original', exact: true }).click();
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.00');
    await versions.getByRole('button', { name: 'Bright', exact: true }).click();
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('+2.00');

    await page.getByRole('button', { name: 'Rename Bright' }).click();
    const rename = page.getByLabel('Version name');
    await rename.fill('Brighter');
    await rename.press('Enter');
    await expect(versions.getByRole('button', { name: 'Brighter', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Brighter' }).click();
    await versions.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(versions.getByRole('button', { name: 'Brighter', exact: true })).toHaveCount(0);
  });

  test('the filmstrip opens the next photo, by click and by arrow key', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImages(page, ['#c03030', '#3050c0', '#30a040']);
    await waitForReady(page);
    const strip = page.getByRole('navigation', { name: 'Filmstrip' });
    await expect(strip.getByRole('button')).toHaveCount(3);
    await expect(strip.getByRole('button', { name: 'photo-1.jpg' })).toHaveAttribute('aria-current', 'true');

    await page.locator('body').press('ArrowRight');
    await expect(strip.getByRole('button', { name: 'photo-2.jpg' })).toHaveAttribute('aria-current', 'true');
    await waitForReady(page);
    await waitForPreview(page, 0);
    const blue = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    expect(blue.blue).toBeGreaterThan(blue.red + 30);

    await strip.getByRole('button', { name: 'photo-3.jpg' }).click();
    await expect(strip.getByRole('button', { name: 'photo-3.jpg' })).toHaveAttribute('aria-current', 'true');
    await waitForReady(page);
  });

  test('Copy edits and Paste edits carry an edit to another photo', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImages(page, ['#c03030', '#3050c0']);
    await waitForReady(page);
    await setValue(page, 'Exposure', '1.5');
    await page.keyboard.press('ControlOrMeta+Shift+c');
    const dialog = page.getByRole('dialog', { name: 'Copy edits from photo-1.jpg' });
    await expect(dialog.getByRole('checkbox', { name: 'Framing' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Tone' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Filmstrip' }).getByRole('button', { name: 'photo-2.jpg' }).click();
    await waitForReady(page);
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('0.00');
    await page.getByRole('button', { name: 'Paste edits' }).click();
    await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.50');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Exposure +1.50', 'Copy edits', 'Paste edits']);
  });
});

test.describe('Split before and after', () => {
  test('shows the uncorrected photo left of a draggable divider, cropped like the edit', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await setValue(page, 'Exposure', '2');
    await page.getByTitle('Crop', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Aspect' }).selectOption('1:1');
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Split' }).click();
    const before = page.getByTestId('split-before');
    await expect(before).toBeAttached();
    await expect.poll(() => before.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const size = await before.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(size[0]).toBe(size[1]);

    const divider = page.getByTestId('split-divider');
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    const box = await divider.boundingBox();
    if (!box) throw new Error('no divider');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(45);

    await page.getByRole('button', { name: 'Split' }).click();
    await expect(divider).toHaveCount(0);
  });
});
