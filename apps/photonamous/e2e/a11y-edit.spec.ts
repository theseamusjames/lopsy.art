import { expect, test, type Page } from '@playwright/test';
import { imageStats, openFlatImage, openGeneratedImage, openHarness, settledPreview, waitForPreview, waitForReady } from './harness';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * The Edit view by keyboard (WCAG 2.1.1, 2.5.7, 4.1.2, 4.1.3, 2.4.2,
 * 2.4.3): crop edges, curve points, the split divider, an area's shape,
 * tabs and folding sections, panning and zooming, what it announces, and
 * the page's title and focus as it opens and closes.
 */

const steps = (page: Page) => page.evaluate(() => window.__photosHarness?.steps ?? []);

async function holdKey(page: Page, key: string, presses: number, modifier?: 'Shift'): Promise<void> {
  if (modifier) await page.keyboard.down(modifier);
  for (let i = 0; i < presses; i++) await page.keyboard.down(key);
  await page.keyboard.up(key);
  if (modifier) await page.keyboard.up(modifier);
}

async function openPhoto(page: Page): Promise<void> {
  await openHarness(page);
  await openGeneratedImage(page);
  await waitForReady(page);
}

test('opening a photo titles the page, focuses its heading and gives it landmarks; closing puts the title back', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 200) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  const libraryTitle = await page.title();

  await tiles(page).first().click();
  await page.keyboard.press('Enter');
  await waitForReady(page, 60_000);
  const edit = page.getByTestId('edit-view');
  await expect(page).toHaveTitle('harbour.jpg – Edit – Photonamous');
  await expect(edit.getByRole('heading', { level: 1, name: 'harbour.jpg' })).toBeFocused();
  // The photo is inside the main landmark, named for what it shows; the panels are labelled.
  const main = edit.getByRole('main');
  await expect(main.getByRole('img', { name: 'harbour.jpg', exact: true })).toBeVisible();
  await expect(edit.getByRole('complementary', { name: 'Edits' })).toBeVisible();
  await expect(edit.getByRole('complementary', { name: 'Presets, versions and history' })).toBeVisible();
  await expect(page.getByTestId('edit-status')).toHaveText('harbour.jpg is ready to edit');

  const contrast = edit.getByLabel('Contrast value', { exact: true });
  await contrast.fill('25');
  await contrast.press('Enter');
  await expect(main.getByRole('img', { name: 'harbour.jpg, edited', exact: true })).toBeVisible();

  await edit.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page).toHaveTitle(libraryTitle);
});

test('crop edges move with the arrow keys, the crop takes typed pixels, and Enter on Cancel cancels', async ({ page }) => {
  await openPhoto(page);
  await waitForPreview(page, 0);

  await page.keyboard.press('r');
  const crop = page.getByRole('group', { name: 'Crop', exact: true });
  const top = crop.getByRole('slider', { name: 'Top edge' });
  await expect(top).toBeFocused();
  await expect(top).toHaveAttribute('aria-valuetext', '0 % in from the top, 0 px');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(top).toHaveAttribute('aria-valuetext', '10 % in from the top, 48 px');
  await expect(crop.getByLabel('Top', { exact: true })).toHaveValue('48');

  await page.keyboard.press('Tab');
  const right = crop.getByRole('slider', { name: 'Right edge' });
  await expect(right).toBeFocused();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(right).toHaveAttribute('aria-valuetext', '10 % in from the right, 64 px');
  await expect(crop.getByLabel('Width', { exact: true })).toHaveValue('576');
  await expect(crop.getByLabel('Height', { exact: true })).toHaveValue('432');

  // A typed width, from the crop's left edge.
  await crop.getByLabel('Width', { exact: true }).fill('320');
  await expect(right).toHaveAttribute('aria-valuetext', '50 % in from the right, 320 px');
  await crop.getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('crop-tool')).toHaveCount(0);
  await expect(page.getByTitle('Crop (R)', { exact: true })).toBeFocused();
  expect(await steps(page)).toEqual(['Crop']);
  await expect(page.getByTestId('edit-status')).toHaveText('Cropped');
  const last = await settledPreview(page, 1);
  const preview = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
  expect([preview.width, preview.height]).toEqual([320, 432]);

  // Enter on Cancel cancels: no second crop.
  await page.keyboard.press('Enter');
  await expect(top).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await crop.getByRole('button', { name: 'Cancel' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('crop-tool')).toHaveCount(0);
  expect(await steps(page)).toEqual(['Crop']);
});

test('curve points are added, moved and removed by keyboard', async ({ page }) => {
  await openPhoto(page);
  await waitForPreview(page, 0);
  const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
  const curves = page.getByRole('region', { name: 'Curves' });
  const curve = curves.getByRole('group', { name: 'Luminance curve' });
  await expect(curve).toHaveAccessibleDescription('Straight: every tone stays as it is.');

  await curves.getByRole('button', { name: 'Add point' }).focus();
  await page.keyboard.press('Enter');
  const point = curve.getByRole('slider', { name: 'Point 1' });
  await expect(point).toBeFocused();
  await expect(point).toHaveAttribute('aria-valuetext', 'input 128, output 128');

  // Held with Shift: ten levels a press, one history step.
  await holdKey(page, 'ArrowUp', 3, 'Shift');
  await expect(point).toHaveAttribute('aria-valuetext', 'input 128, output 158');
  await page.keyboard.press('ArrowLeft');
  await expect(point).toHaveAttribute('aria-valuetext', 'input 127, output 158');
  await expect(curve).toHaveAccessibleDescription('3 points, input to output: 0 to 0, 127 to 158, 255 to 255.');
  expect(await steps(page)).toEqual(['Curves: Luminance', 'Curves: Luminance', 'Curves: Luminance']);
  const last = await settledPreview(page, 1);
  const after = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
  expect(after.mean).toBeGreaterThan(before.mean + 10);

  await page.keyboard.press('Delete');
  await expect(curve.getByRole('slider')).toHaveCount(2);
  await expect(curve.getByRole('slider', { name: 'Black point' })).toBeFocused();
  await expect(curve).toHaveAccessibleDescription('Straight: every tone stays as it is.');
  expect(await steps(page)).toHaveLength(4);
});

test('the split divider moves with the arrow, Page, Home and End keys', async ({ page }) => {
  await openPhoto(page);
  await page.getByRole('button', { name: 'Split' }).focus();
  await page.keyboard.press('Enter');
  const divider = page.getByRole('slider', { name: 'Before and after divider' });
  await expect(divider).toHaveAttribute('aria-valuetext', '50 % before, 50 % after');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '48');
  await page.keyboard.press('PageDown');
  await expect(divider).toHaveAttribute('aria-valuenow', '38');
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuetext', '0 % before, 100 % after');
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuetext', '90 % before, 10 % after');
});

test('a radial area is added, shaped and renamed by keyboard', async ({ page }) => {
  await openHarness(page);
  await openFlatImage(page);
  await waitForReady(page);

  await page.getByRole('button', { name: 'Areas', exact: true }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'Areas' });
  await expect(panel.getByRole('button', { name: 'Linear' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Radial' })).toBeFocused();
  await page.keyboard.press('Enter');
  const row = panel.getByRole('list', { name: 'Area list' }).getByRole('button', { name: /^Radial\s*Area 1$/ });
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('aria-current', 'true');

  const shape = panel.getByRole('group', { name: 'Area 1 shape' });
  const centreX = shape.getByRole('slider', { name: 'Center X' });
  await expect(centreX).toHaveAttribute('aria-valuetext', '50 %');
  await centreX.focus();
  await holdKey(page, 'ArrowRight', 1, 'Shift');
  await expect(centreX).toHaveAttribute('aria-valuetext', '60 %');
  await shape.getByRole('slider', { name: 'Width' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(shape.getByRole('slider', { name: 'Width' })).toHaveAttribute('aria-valuetext', '49 %');
  await shape.getByRole('slider', { name: 'Turn' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(shape.getByRole('slider', { name: 'Turn' })).toHaveAttribute('aria-valuetext', '−1°');
  // −180° is the same turn as 180°, which is how the recipe keeps it.
  await page.keyboard.press('Home');
  await expect(shape.getByRole('slider', { name: 'Turn' })).toHaveAttribute('aria-valuetext', '180°');
  await shape.getByLabel('Feather value').fill('20');
  await shape.getByLabel('Feather value').press('Enter');
  expect(await steps(page)).toEqual(['Add radial area', 'Area: move', 'Area: resize', 'Area: turn', 'Area: turn', 'Area: feather']);
  const geometry = await page.evaluate(() => {
    const recipe = window.__photosHarness?.recipe as { areas: Record<string, { geometry: Record<string, number> }> } | undefined;
    return Object.values(recipe?.areas ?? {})[0]?.geometry;
  });
  expect(geometry?.cx).toBeCloseTo(0.6, 3);
  expect(geometry?.rx).toBeCloseTo(0.245, 3);
  expect(Math.abs(geometry?.angle ?? 0)).toBeCloseTo(180, 3);
  expect(geometry?.feather).toBe(20);

  await panel.getByRole('button', { name: 'Rename Area 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByLabel('Area name')).toBeFocused();
  await page.keyboard.type('Sky');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: /^Radial\s*Sky$/ })).toBeFocused();
});

test('tabs move with the arrow keys and sections fold from their headings', async ({ page }) => {
  await openPhoto(page);
  const group = page.getByRole('region', { name: 'Color by hue' });
  await expect(group.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await group.getByRole('tab', { name: 'Hue' }).focus();
  await page.keyboard.press('ArrowRight');
  const saturation = group.getByRole('tab', { name: 'Saturation' });
  await expect(saturation).toBeFocused();
  await expect(saturation).toHaveAttribute('aria-selected', 'true');
  await expect(group.getByRole('tabpanel', { name: 'Saturation' })).toBeVisible();
  const panelId = await group.getByRole('tabpanel').getAttribute('id');
  await expect(saturation).toHaveAttribute('aria-controls', panelId ?? '');
  await page.keyboard.press('End');
  await expect(group.getByRole('tab', { name: 'Luminance' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('tab', { name: 'Hue' })).toHaveAttribute('aria-selected', 'true');

  const history = page.getByRole('button', { name: 'History', exact: true });
  await expect(history).toHaveAttribute('aria-expanded', 'true');
  const bodyId = await history.getAttribute('aria-controls');
  const body = page.locator(`[id="${bodyId}"]`);
  await expect(body.getByTestId('history-list')).toBeVisible();
  await history.focus();
  await page.keyboard.press('Enter');
  await expect(history).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();
  await page.keyboard.press('Space');
  await expect(history).toHaveAttribute('aria-expanded', 'true');
  await expect(body.getByTestId('history-list')).toBeVisible();
});

test('the focused photo zooms with + and − and pans with the arrow keys', async ({ page }) => {
  await openPhoto(page);
  const readout = page.getByTestId('zoom-readout');
  await expect(readout).toHaveText('100%');
  const stage = page.getByRole('group', { name: 'Photo', exact: true });
  await stage.focus();
  await page.keyboard.press('+');
  await expect(readout).toHaveText('125%');
  await expect(page.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('-');
  await expect(readout).toHaveText('100%');
  await page.keyboard.press('+');

  // The split divider sits on the photo, so it shows where the photo has moved to.
  await page.getByRole('button', { name: 'Split' }).click();
  const divider = page.getByRole('slider', { name: 'Before and after divider' });
  const start = await divider.boundingBox();
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await divider.boundingBox())?.x ?? 0)).toBe(Math.round((start?.x ?? 0) - 80));
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => Math.round((await divider.boundingBox())?.x ?? 0)).toBe(Math.round((start?.x ?? 0) + 120));
  // Fit puts it back.
  await page.keyboard.press('ControlOrMeta+0');
  await expect(page.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true');
});

test('export, undo, the picker and the Level tool say what they do', async ({ page }) => {
  await openPhoto(page);
  const status = page.getByTestId('edit-status');
  const contrast = page.getByLabel('Contrast value', { exact: true });
  await contrast.fill('25');
  await contrast.press('Enter');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(status).toHaveText('Undone: Contrast +25');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(status).toHaveText('Redone: Contrast +25');

  await page.getByRole('button', { name: 'Export' }).focus();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Exported generated.jpg', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Export' })).toBeFocused();

  const picker = page.getByRole('button', { name: 'Pick a neutral grey' });
  await expect(picker).toHaveAccessibleDescription(/Temperature and Tint sliders set the white balance without it/);
  await picker.click();
  await expect(status).toHaveText(/neutral grey, or press Escape/);
  // Escape leaves the picker, not the Edit view.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('white-balance-picker')).toHaveCount(0);
  await expect(page.getByTestId('edit-view')).toBeVisible();

  await page.getByRole('button', { name: 'Level Straighten' }).click();
  await expect(status).toHaveText(/Angle slider straightens by keyboard/);
  await expect(page.getByText('Draw along something level · Esc to cancel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('level-tool')).toHaveCount(0);
});

test('the Grade screen has its own title and heading', async ({ page }) => {
  await page.goto('/?grade=missing');
  await expect(page).toHaveTitle('Grade – Photonamous');
  await expect(page.getByRole('heading', { level: 1, name: 'Grade in Photonamous' })).toBeFocused();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(/Nothing to grade/);
});
