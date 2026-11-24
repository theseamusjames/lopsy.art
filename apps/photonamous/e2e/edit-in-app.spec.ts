import { expect, test, type Page } from '@playwright/test';
import { waitForReady } from './harness';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * The Edit view inside the app, on the real library ("This browser"):
 * History, Versions, Presets, Copy and Paste edits and the filmstrip,
 * through EditSlot and the session.
 */
async function setValue(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByTestId('edit-view').getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}

test('Edit in the library: history, versions, presets, copy and paste, filmstrip', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'alpha.jpg', buffer: await generatedJpeg(page, 20) },
    { name: 'beta.jpg', buffer: await generatedJpeg(page, 200) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(2);

  // A tile's own Edit button is there only under the pointer; it selects the tile and opens it.
  const firstTile = tiles(page).first();
  await expect(firstTile.getByRole('button', { name: /^Edit / })).toHaveCSS('opacity', '0');
  await firstTile.hover();
  await expect(firstTile.getByRole('button', { name: /^Edit / })).toHaveCSS('opacity', '1');
  await firstTile.getByRole('button', { name: /^Edit / }).click();
  await waitForReady(page, 60_000);
  await expect(firstTile).toHaveAttribute('aria-selected', 'true');
  const edit = page.getByTestId('edit-view');
  const firstName = (await edit.getByTitle(/\.jpg$/).first().textContent()) ?? '';

  // History: three steps, then back to the first by clicking it.
  await setValue(page, 'Exposure', '1');
  await setValue(page, 'Contrast', '20');
  await setValue(page, 'Vibrance', '30');
  const history = edit.getByTestId('history-list');
  await expect(history.getByRole('button', { name: 'Vibrance +30' })).toBeVisible();
  await history.getByRole('button', { name: 'Exposure +1.00' }).click();
  await expect(edit.getByLabel('Contrast value', { exact: true })).toHaveValue('0');
  await expect(edit.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.00');
  await expect(history.getByRole('button', { name: 'Vibrance +30' })).toBeVisible();

  // Presets: one step.
  await edit.getByRole('list', { name: 'Presets' }).getByRole('button', { name: 'Punchy', exact: true }).click();
  await expect(edit.getByLabel('Contrast value', { exact: true })).toHaveValue('+25');
  await expect(history.getByRole('button', { name: 'Preset: Punchy' })).toBeVisible();
  // The presets a library starts with are the user's to delete, like any they save.
  const presetList = edit.getByRole('list', { name: 'Presets' });
  await presetList.getByRole('button', { name: 'Delete preset Warm' }).click();
  await expect(presetList.getByRole('button', { name: 'Warm', exact: true })).toHaveCount(0);
  await expect(presetList.getByRole('button', { name: 'Cool', exact: true })).toBeVisible();

  // Versions: a new one carries the edit and becomes the one shown.
  const versions = edit.getByRole('list', { name: 'Versions' });
  await edit.getByRole('button', { name: 'New version' }).click();
  await edit.getByLabel('New version name').fill('Bright');
  await edit.getByLabel('New version name').press('Enter');
  await expect(versions.getByRole('button', { name: 'Bright', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(edit.getByLabel('Contrast value', { exact: true })).toHaveValue('+25');
  await setValue(page, 'Exposure', '2');
  await versions.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(edit.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.00');
  // Deleting the version on show moves to another first.
  await versions.getByRole('button', { name: 'Bright', exact: true }).click();
  await expect(edit.getByLabel('Exposure value', { exact: true })).toHaveValue('+2.00');
  await edit.getByRole('button', { name: 'Delete Bright' }).click();
  await versions.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(versions.getByRole('button', { name: 'Bright', exact: true })).toHaveCount(0);
  await expect(versions.getByRole('button', { name: 'Original', exact: true })).toHaveAttribute('aria-current', 'true');

  // Copy edits, then the filmstrip's next photo, and paste.
  await page.keyboard.press('ControlOrMeta+Shift+c');
  await page.getByRole('dialog', { name: /^Copy edits from/ }).getByRole('button', { name: 'Copy', exact: true }).click();
  const strip = edit.getByRole('navigation', { name: 'Filmstrip' });
  await expect(strip.getByRole('button')).toHaveCount(2);
  // In the zoom field Up and Down zoom, and Left and Right move the caret rather than along the filmstrip.
  const readout = edit.getByTestId('zoom-readout');
  await readout.focus();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(readout).toHaveValue('100%');
  await page.keyboard.press('ArrowUp');
  await expect(readout).toHaveValue('110%');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  await expect(edit.getByTitle(/\.jpg$/).first()).toHaveText(firstName);
  await readout.blur();
  await page.locator('body').press('ArrowRight');
  await waitForReady(page, 60_000);
  await expect(edit.getByTitle(/\.jpg$/).first()).not.toHaveText(firstName);
  await expect(edit.getByLabel('Exposure value', { exact: true })).toHaveValue('0.00');
  await edit.getByRole('button', { name: 'Paste edits' }).click();
  await expect(edit.getByLabel('Exposure value', { exact: true })).toHaveValue('+1.00');
  await expect(edit.getByLabel('Contrast value', { exact: true })).toHaveValue('+25');

  // Export is the header's alone, and here it takes the photo being edited: not the one selected in the grid under it.
  await expect(edit.getByRole('button', { name: /^Export/ })).toHaveCount(0);
  const secondName = ((await edit.getByTitle(/\.jpg$/).first().textContent()) ?? '').replace(/\.jpg$/, '');
  await page.getByRole('banner').getByRole('button', { name: 'Export 1 photo' }).click();
  const exporting = page.getByRole('dialog', { name: 'Export 1 photo' });
  await expect(exporting.getByText(new RegExp(`· ${secondName}\\.`))).toBeVisible();
  await exporting.getByRole('button', { name: 'Cancel' }).click();
  await expect(exporting).toHaveCount(0);

  await page.getByTestId('edit-view').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(tiles(page)).toHaveCount(2);
});

test('opening a photo shows its stored preview with "Loading…" before the engine render', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'large.jpg', buffer: await generatedJpeg(page, 120, 6000, 4000) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  // The import's previews are in place before Edit opens.
  await expect(tiles(page).first()).toHaveAttribute('data-preview-hash', /.+/, { timeout: 60_000 });

  await tiles(page).first().click();
  await page.keyboard.press('Enter');
  const edit = page.getByTestId('edit-view');
  await expect(edit.getByTestId('stored-preview')).toBeVisible({ timeout: 10_000 });
  await expect(edit.getByTestId('loading-badge')).toHaveText('Loading…');
  await waitForReady(page, 120_000);
  await expect(edit.getByTestId('stored-preview')).toHaveCount(0);
});
