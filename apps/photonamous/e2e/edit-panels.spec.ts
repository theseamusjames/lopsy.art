import { expect, test, type Page } from '@playwright/test';
import { imageStats, openGeneratedImage, openHarness, waitForReady } from './harness';

/**
 * The Edit view's toolbar (icons down the right edge) and the panels it
 * opens, and the Edit panel's sections, which start folded. The other
 * specs run with every section already open (playwright.config.ts); this
 * one starts as a new user does, with nothing stored.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('the Edit panel’s sections start folded, open one at a time, mark the ones in use and the open one is remembered', async ({ page }) => {
  await openHarness(page);
  await openGeneratedImage(page);
  await waitForReady(page);
  const edits = page.getByRole('complementary', { name: 'Edits' });

  const titles = ['Straighten', 'White balance', 'Tone', 'Curves', 'Color', 'Color by hue', 'Color Grading', 'Local contrast', 'Sharpness & noise', 'Finish'];
  for (const title of titles) await expect(edits.getByRole('button', { name: title, exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(edits.getByRole('slider')).toHaveCount(0);

  // One is open at a time, as a group's effects are in Lopsy: opening Finish folds Tone.
  const tone = edits.getByRole('button', { name: 'Tone', exact: true });
  const finish = edits.getByRole('button', { name: 'Finish', exact: true });
  await tone.click();
  await expect(tone).toHaveAttribute('aria-expanded', 'true');
  await expect(edits.getByLabel('Exposure value', { exact: true })).toBeVisible();
  await expect(edits.getByLabel('Contrast value', { exact: true })).toBeVisible();
  await finish.click();
  await expect(finish).toHaveAttribute('aria-expanded', 'true');
  await expect(tone).toHaveAttribute('aria-expanded', 'false');
  await expect(edits.getByLabel('Exposure value', { exact: true })).toHaveCount(0);
  await expect(edits.getByRole('region', { name: 'Finish' }).getByRole('slider').first()).toBeVisible();
  await expect(edits.getByRole('button', { expanded: true })).toHaveCount(1);
  await tone.click();
  await expect(finish).toHaveAttribute('aria-expanded', 'false');

  // A section in use says so beside its name, folded or open; Reset is in the heading either way.
  const toneSection = edits.getByRole('region', { name: 'Tone', exact: true });
  await expect(toneSection).toHaveAttribute('data-in-use', 'false');
  await expect(toneSection.getByRole('button', { name: 'Reset Tone' })).toBeDisabled();
  const exposure = edits.getByLabel('Exposure value', { exact: true });
  await exposure.fill('1');
  await exposure.press('Enter');
  await expect(toneSection).toHaveAttribute('data-in-use', 'true');
  await expect(toneSection.getByRole('heading')).toHaveText('Tone, in use');
  await tone.click();
  await expect(edits.getByLabel('Exposure value', { exact: true })).toHaveCount(0);
  await expect(toneSection).toHaveAttribute('data-in-use', 'true');
  await toneSection.getByRole('button', { name: 'Reset Tone' }).click();
  await expect(toneSection).toHaveAttribute('data-in-use', 'false');
  await expect(toneSection.getByRole('heading')).toHaveText('Tone');
  await expect(edits.getByRole('button', { expanded: true })).toHaveCount(0);

  // The one open is kept on this device.
  await finish.click();
  await page.reload();
  await openGeneratedImage(page);
  await waitForReady(page);
  await expect(edits.getByRole('button', { name: 'Finish', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(edits.getByRole('button', { name: 'Tone', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

/** The mean brightness of the photo as the Edit view shows it, 0..255, from a screenshot decoded in the page. */
async function shownMean(page: Page): Promise<number> {
  const shot = await page.getByTestId('edit-view').locator('canvas').first().screenshot();
  return page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
    return sum / ((data.length / 4) * 3);
  }, shot.toString('base64'));
}

test('a section’s eye shows the photo without that section, and the edit keeps it', async ({ page }) => {
  await openHarness(page);
  await openGeneratedImage(page);
  await waitForReady(page);
  const edits = page.getByRole('complementary', { name: 'Edits' });
  const badge = page.getByTestId('hidden-badge');

  // Every section that changes how the photo looks has an eye; Straighten is framing and has none.
  for (const title of ['White balance', 'Tone', 'Curves', 'Color', 'Color by hue', 'Color Grading', 'Local contrast', 'Sharpness & noise', 'Finish']) {
    await expect(edits.getByRole('button', { name: `Hide ${title}`, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(edits.getByRole('button', { name: 'Hide Straighten' })).toHaveCount(0);

  const unedited = await shownMean(page);
  await edits.getByRole('button', { name: 'Tone', exact: true }).click();
  const exposure = edits.getByLabel('Exposure value', { exact: true });
  await exposure.fill('2');
  await exposure.press('Enter');
  await expect.poll(() => shownMean(page)).toBeGreaterThan(unedited + 40);
  const edited = await shownMean(page);

  // The eye: the photo without Tone, said on the photo and in the heading; Tone's controls wait.
  const eye = edits.getByRole('button', { name: 'Hide Tone', exact: true });
  const toneSection = edits.getByRole('region', { name: 'Tone', exact: true });
  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'true');
  await expect(eye).toBeFocused();
  await expect(badge).toHaveText('Without Tone');
  await expect(toneSection.getByRole('heading')).toHaveText('Tone, in use, hidden');
  await expect.poll(() => shownMean(page)).toBeLessThan(unedited + 10);
  await expect(edits.getByRole('slider', { name: 'Exposure' })).toBeDisabled();
  await expect(toneSection.getByRole('button', { name: 'Reset Tone' })).toBeDisabled();
  await expect(toneSection.getByRole('button', { name: 'Auto Tone' })).toBeDisabled();

  // The other sections work as before, and Tone stays hidden while it is folded.
  await edits.getByRole('button', { name: 'Color', exact: true }).click();
  await expect(edits.getByRole('slider', { name: 'Vibrance' })).toBeEnabled();
  await expect(toneSection).toHaveAttribute('data-hidden', 'true');
  await expect(badge).toHaveText('Without Tone');
  await edits.getByRole('button', { name: 'Hide Color', exact: true }).click();
  await expect(badge).toHaveText('Without Tone and Color');
  await edits.getByRole('button', { name: 'Hide Color', exact: true }).click();

  // Only what is shown changed: the edit, its history and an export keep Tone.
  expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Exposure +2.00']);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction(() => (window.__photosHarness?.exports.length ?? 0) > 0, undefined, { timeout: 60_000 });
  const exported = await imageStats(page, { kind: 'export', index: 0 });
  expect(exported.mean).toBeGreaterThan(unedited + 40);

  await eye.click();
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expect(badge).toHaveCount(0);
  await expect(toneSection.getByRole('heading')).toHaveText('Tone, in use');
  await expect.poll(() => shownMean(page)).toBeGreaterThan(edited - 5);
});

test('the toolbar opens the Edit and Mask panels one at a time, closes the open one, and has Edit in Lopsy under them', async ({ page }) => {
  await openHarness(page);
  await openGeneratedImage(page);
  await waitForReady(page);
  const toolbar = page.getByRole('toolbar', { name: 'Tools' });
  const edit = toolbar.getByRole('button', { name: 'Edit', exact: true });
  const mask = toolbar.getByRole('button', { name: 'Mask', exact: true });
  const panel = page.getByRole('complementary', { name: 'Edits' });

  // The toolbar is the last thing at the right edge, its buttons one above the other.
  const [bar, editBox, maskBox, lopsyBox] = await Promise.all([
    toolbar.boundingBox(),
    edit.boundingBox(),
    mask.boundingBox(),
    toolbar.getByRole('button', { name: 'Edit in Lopsy' }).boundingBox(),
  ]);
  const width = page.viewportSize()?.width ?? 0;
  expect(Math.round((bar?.x ?? 0) + (bar?.width ?? 0))).toBe(width);
  expect(maskBox?.y ?? 0).toBeGreaterThan(editBox?.y ?? 0);
  // Edit in Lopsy is the next button down, with the others at the top.
  expect((lopsyBox?.y ?? 0) - (maskBox?.y ?? 0)).toBeGreaterThan(0);
  expect((lopsyBox?.y ?? 0) - (maskBox?.y ?? 0)).toBeLessThan(40);
  expect((lopsyBox?.y ?? 0) - (bar?.y ?? 0)).toBeLessThan(120);

  // Edit is open at first.
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  await expect(mask).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('button', { name: 'Tone', exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Mask', exact: true })).toHaveCount(0);

  // Mask takes its place, with focus on Add a mask, the one button of a panel with no mask yet.
  await mask.click();
  await expect(mask).toHaveAttribute('aria-pressed', 'true');
  await expect(edit).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('region', { name: 'Mask', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Tone', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Add a mask', exact: true })).toBeFocused();

  // Pressing the open one closes the panel: the photo gets the room.
  const before = await page.getByTestId('edit-canvas').boundingBox();
  await mask.click();
  await expect(page.getByTestId('edit-panel')).toHaveCount(0);
  await expect(mask).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await page.getByTestId('edit-canvas').boundingBox())?.width ?? 0).toBeGreaterThan((before?.width ?? 0) + 200);

  await edit.click();
  await expect(panel.getByRole('button', { name: 'Tone', exact: true })).toBeVisible();

  // M opens the Mask panel from wherever, with a new mask.
  await page.getByRole('group', { name: 'Photo' }).focus();
  await page.keyboard.press('m');
  await expect(mask).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Mask 1', exact: true })).toHaveAttribute('aria-expanded', 'true');
});
