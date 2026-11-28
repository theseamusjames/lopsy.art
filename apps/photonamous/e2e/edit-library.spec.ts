import { expect, test, type Page } from './test';
import { harnessSteps, imageStats, openFlatImage, openGeneratedImage, openGeneratedImages, openHarness, settledPreview, waitForPreview, waitForReady } from './harness';

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
    // Photo 1's previews are rendered before the switch; photo 2's come last.
    const last = await settledPreview(page, 1);
    const blue = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
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
    await page.getByTitle('Crop (R)', { exact: true }).click();
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

  test('double-clicking the divider swaps the sides without moving it, and Enter swaps them back', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page, '#505050');
    await waitForReady(page);
    // A flat grey: before is that grey everywhere, after three stops brighter.
    await setValue(page, 'Exposure', '3');
    await page.getByRole('button', { name: 'Split' }).click();
    const before = page.getByTestId('split-before');
    await expect.poll(() => before.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const divider = page.getByRole('slider', { name: 'Before and after divider' });
    const status = page.getByTestId('edit-status');
    const stepsBefore = await harnessSteps(page);

    // Which side shows the brighter picture (the edit), from the page's pixels just either side of the divider.
    const brighterSide = async (): Promise<'left' | 'right' | 'neither'> => {
      const sides = await sidesOfDivider(page);
      if (Math.abs(sides.right - sides.left) < 40) return 'neither';
      return sides.right > sides.left ? 'right' : 'left';
    };
    await expect.poll(brighterSide).toBe('right');
    await expect(page.getByTestId('split-label-left')).toHaveText('Before');
    await expect(divider).toHaveAccessibleDescription('Before on the left, after on the right. Double-click or press Enter to swap.');
    await page.screenshot({ path: test.info().outputPath('split-before-swap.png') });

    // A double-click 7 px off the line, the pointer jittering a pixel or two between and during the clicks.
    const start = await divider.boundingBox();
    if (!start) throw new Error('no divider');
    const x = start.x + start.width / 2 + 7;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ clickCount: 1 });
    await page.mouse.move(x + 1, y);
    await page.mouse.up({ clickCount: 1 });
    await page.mouse.move(x + 2, y + 1);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.move(x + 3, y + 1);
    await page.mouse.up({ clickCount: 2 });

    await expect(page.getByTestId('split-label-left')).toHaveText('After');
    await expect(page.getByTestId('split-label-right')).toHaveText('Before');
    await expect(before).toHaveAttribute('data-side', 'right');
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    await expect(divider).toHaveAttribute('aria-valuetext', '50 % after, 50 % before');
    await expect(divider).toHaveAccessibleDescription('After on the left, before on the right. Double-click or press Enter to swap.');
    expect((await divider.boundingBox())?.x).toBe(start.x);
    await expect(status).toHaveText('After on the left, before on the right');
    await expect.poll(brighterSide).toBe('left');
    await page.screenshot({ path: test.info().outputPath('split-after-swap.png') });

    // Swapped, the before still comes from the divider's right at another position, zoomed in and panned.
    await divider.focus();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expect(divider).toHaveAttribute('aria-valuenow', '30');
    await expect.poll(brighterSide).toBe('left');
    const stage = page.getByRole('group', { name: 'Photo', exact: true });
    await stage.focus();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(brighterSide).toBe('left');

    // A drag right after the swap moves the divider as before.
    const box = await divider.boundingBox();
    if (!box) throw new Error('no divider');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(30);
    await expect(page.getByTestId('split-label-left')).toHaveText('After');

    // Enter on the divider swaps back.
    await divider.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('split-label-left')).toHaveText('Before');
    await expect(before).toHaveAttribute('data-side', 'left');
    await expect(status).toHaveText('Before on the left, after on the right');
    await expect.poll(brighterSide).toBe('right');
    // View state only: no history step.
    expect(await harnessSteps(page)).toEqual(stepsBefore);
  });
});

/**
 * The mean brightness (0..255) of the page just left and just right of the
 * split divider, over the middle of the photo as shown: a screenshot,
 * decoded by the browser.
 */
async function sidesOfDivider(page: Page): Promise<{ left: number; right: number }> {
  const divider = await page.getByTestId('split-divider').boundingBox();
  const stage = await page.getByRole('group', { name: 'Photo', exact: true }).boundingBox();
  if (!divider || !stage) throw new Error('no divider');
  const centre = divider.x + divider.width / 2;
  const top = Math.max(divider.y, stage.y) + 40;
  const bottom = Math.min(divider.y + divider.height, stage.y + stage.height) - 10;
  const clip = { x: Math.round(centre - 60), y: Math.round(top), width: 120, height: Math.round(bottom - top) };
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    // 10..40 px either side of the line, clear of the 24 px handle.
    const mean = (x: number) => {
      const data = ctx.getImageData(x, 0, Math.round((30 * bitmap.width) / 120), bitmap.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      return sum / (data.length / 4);
    };
    return { left: mean(Math.round((20 * bitmap.width) / 120)), right: mean(Math.round((70 * bitmap.width) / 120)) };
  }, png.toString('base64'));
}
