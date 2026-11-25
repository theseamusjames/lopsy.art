import { expect, test, type Page } from './test';
import { imageStats, openFlatImage, openHarness, settledPreview, waitForPreview, waitForReady } from './harness';
import { maskHeading, newMask, setMaskValue } from './masks';

/** The share of the canvas, as shown on screen, that is clearly red (a screenshot, decoded by the browser). */
async function canvasRedness(page: Page): Promise<number> {
  const png = await page.getByTestId('edit-canvas').screenshot();
  return page.evaluate(async (base64) => {
    const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 64 });
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) - (data[i + 1] ?? 0) > 40) red += 1;
    return red / (data.length / 4);
  }, png.toString('base64'));
}

/** How much darker the top half of the canvas is than the bottom half, as shown on screen (0..255). */
async function topDarkerBy(page: Page): Promise<number> {
  const png = await page.getByTestId('edit-canvas').screenshot();
  return page.evaluate(async (base64) => {
    const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 64 });
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const mean = (y: number) => {
      const data = ctx.getImageData(0, y, 64, 32).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      return sum / (data.length / 4);
    };
    return mean(32) - mean(0);
  }, png.toString('base64'));
}

/** The photo is grey: only the selected mask's red overlay makes the screen redder than green. */
async function expectMaskShown(page: Page): Promise<void> {
  await expect.poll(() => canvasRedness(page), { timeout: 30_000 }).toBeGreaterThan(0.02);
}

async function expectMaskHidden(page: Page): Promise<void> {
  await expect.poll(() => canvasRedness(page), { timeout: 30_000 }).toBeLessThan(0.005);
}

async function exportJpeg(page: Page): Promise<number> {
  const count = await page.evaluate(() => window.__photosHarness?.exports.length ?? 0);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction((n) => (window.__photosHarness?.exports.length ?? 0) > n, count);
  return count;
}

test.describe('Masks', () => {
  test('a linear mask darkens the top, in the render and the export; undo removes it', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);

    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    await newMask(page, 'Linear');
    // The new mask is the open one, with its handles on the photo.
    await expect(maskHeading(page, 'Mask 1')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('area-handles')).toBeVisible();
    await setMaskValue(page, 'Mask 1', 'Exposure', '-1');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add linear mask', 'Mask 1 exposure −1.00']);

    const last = await settledPreview(page, 1);
    const top = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'top' });
    const bottom = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'bottom' });
    expect(top.mean).toBeLessThan(bottom.mean - 15);

    const index = await exportJpeg(page);
    const exportTop = await imageStats(page, { kind: 'export', index, half: 'top' });
    const exportBottom = await imageStats(page, { kind: 'export', index, half: 'bottom' });
    expect(exportTop.mean).toBeLessThan(exportBottom.mean - 15);

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(panel.getByRole('button', { name: /^Mask \d+$/ })).toHaveCount(0);
  });

  test('an inverted radial mask leaves its centre alone and changes the corners', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen', half: 'centre' });

    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    await newMask(page, 'Radial');
    // A toggle that says what it does, in words.
    const invert = panel.getByRole('button', { name: 'Invert Mask 1' });
    await expect(invert).toHaveText('Invert');
    await expect(invert).toHaveAttribute('aria-pressed', 'false');
    await invert.click();
    await expect(invert).toHaveAttribute('aria-pressed', 'true');
    await setMaskValue(page, 'Mask 1', 'Exposure', '-2');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add radial mask', 'Mask 1 inverted', 'Mask 1 exposure −2.00']);

    const last = await settledPreview(page, 1);
    const centre = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'centre' });
    const whole = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
    expect(Math.abs(centre.mean - before.mean)).toBeLessThan(3);
    expect(whole.mean).toBeLessThan(before.mean - 10);
  });

  test('dragging the centre handle moves a radial mask as one step', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    await newMask(page, 'Radial');
    const handle = page.locator('[data-handle="move"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error('no handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add radial mask', 'Mask: move']);
    const recipe = await page.evaluate(() => window.__photosHarness?.recipe);
    const area = Object.values((recipe as { areas: Record<string, { geometry: { cx: number } }> }).areas)[0];
    expect(area?.geometry.cx).toBeGreaterThan(0.55);
  });

  test('a mask has Amount and the seven adjustments, and the shape under Position, closed', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    await newMask(page, 'Radial');

    // Amount, then the seven adjustments; nothing of the shape yet.
    const sliders = panel.getByRole('slider');
    await expect(sliders).toHaveCount(8);
    await expect(sliders.nth(0)).toHaveAccessibleName('Amount');
    await expect(sliders.nth(1)).toHaveAccessibleName('Exposure');
    await expect(sliders.nth(7)).toHaveAccessibleName('Saturation');
    const position = panel.getByRole('button', { name: 'Position', exact: true });
    await expect(position).toHaveAttribute('aria-expanded', 'false');
    const adjustments = await panel.getByRole('group', { name: 'Mask 1 adjustments' }).boundingBox();
    const closed = await position.boundingBox();
    if (!adjustments || !closed) throw new Error('no adjustments or Position');
    expect(closed.y).toBeGreaterThanOrEqual(adjustments.y + adjustments.height);

    await position.click();
    await expect(position).toHaveAttribute('aria-expanded', 'true');
    const shape = panel.getByRole('group', { name: 'Mask 1 position' });
    await expect(shape).toHaveAttribute('id', (await position.getAttribute('aria-controls')) ?? 'none');
    await expect(sliders).toHaveCount(14);
    await expect(sliders.nth(8)).toHaveAccessibleName('Center X');

    // Its sliders move the mask as its handles do, one history step each.
    const centreX = shape.getByLabel('Center X value', { exact: true });
    await centreX.fill('30');
    await centreX.press('Enter');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add radial mask', 'Mask: move']);
    const recipe = await page.evaluate(() => window.__photosHarness?.recipe);
    const mask = Object.values((recipe as { areas: Record<string, { geometry: { cx: number } }> }).areas)[0];
    expect(mask?.geometry.cx).toBeCloseTo(0.3, 2);

    await position.click();
    await expect(position).toHaveAttribute('aria-expanded', 'false');
    await expect(sliders).toHaveCount(8);
  });

  test('Add adjustment gives a mask colour grading of its own: inside the mask only, in the render and the export', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    // A linear mask: all of its effect at the top of the photo, none at the bottom.
    await newMask(page, 'Linear');
    const steps = () => page.evaluate(() => window.__photosHarness?.steps ?? []);
    /** How much bluer than red a half of an image is. */
    const blueness = (stats: { blue: number; red: number }) => stats.blue - stats.red;

    // Add adjustment is the last thing in the mask, under Position, and lists what the mask can still be given.
    const add = panel.getByRole('button', { name: 'Add adjustment', exact: true });
    const [addBox, positionBox] = await Promise.all([add.boundingBox(), panel.getByRole('button', { name: 'Position', exact: true }).boundingBox()]);
    if (!addBox || !positionBox) throw new Error('no Add adjustment or Position');
    expect(addBox.y).toBeGreaterThanOrEqual(positionBox.y + positionBox.height);
    await add.click();
    const menu = page.getByRole('menu', { name: 'Adjustments' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Whites & blacks',
      'Curves',
      'Vibrance',
      'Color by hue',
      'Color grading',
      'Local contrast',
      'Sharpness & noise',
      'Vignette & grain',
    ]);
    await menu.getByRole('menuitem', { name: 'Color grading', exact: true }).click();

    // The mask has its own colour grading: the Edit panel's tabs, colour field and sliders. Adding it changes nothing yet.
    const grading = panel.getByRole('group', { name: 'Mask 1 color grading', exact: true });
    await expect(grading.getByRole('tab')).toHaveText(['Shadows', 'Midtones', 'Highlights', 'Global']);
    await expect(grading.getByRole('tab', { name: 'Shadows' })).toBeFocused();
    await add.click();
    await expect(menu.getByRole('menuitem', { name: 'Color grading', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(await steps()).toEqual(['Add linear mask']);

    await grading.getByRole('tab', { name: 'Global' }).click();
    const field = grading.getByRole('slider', { name: 'Global color', exact: true });
    await field.scrollIntoViewIfNeeded();
    const box = await field.boundingBox();
    if (!box) throw new Error('no colour field');
    // 61 % across is a blue (hue 220), 20 % down is saturation 80: both at once, as one step.
    await page.mouse.click(box.x + box.width * 0.61, box.y + box.height * 0.2);
    await expect.poll(async () => Math.abs(Number(await grading.getByLabel('Hue value').inputValue()) - 220)).toBeLessThan(3);
    expect(await steps()).toEqual(['Add linear mask', 'Mask 1 global color']);

    // The top of the photo, under the mask, is tinted; the bottom, outside it, is as it was.
    const last = await settledPreview(page, 1);
    const top = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'top' });
    const bottom = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'bottom' });
    expect(blueness(top)).toBeGreaterThan(blueness(bottom) + 10);
    const index = await exportJpeg(page);
    const exportTop = await imageStats(page, { kind: 'export', index, half: 'top' });
    const exportBottom = await imageStats(page, { kind: 'export', index, half: 'bottom' });
    expect(blueness(exportTop)).toBeGreaterThan(blueness(exportBottom) + 10);
    // The mask is in use on the strength of its grade, and its eye takes the grade off the screen with it.
    await expect(panel.getByRole('region', { name: 'Mask 1', exact: true }).getByRole('heading', { level: 2 })).toHaveText('Mask 1, in use');

    // Taken off: back to neutral as one step, the tint gone, and Add adjustment back with focus.
    await grading.getByRole('button', { name: 'Remove Color grading', exact: true }).click();
    await expect(grading).toHaveCount(0);
    await expect(add).toBeFocused();
    expect((await steps()).at(-1)).toBe('Mask 1: remove color grading');
    const after = await settledPreview(page, last + 1);
    const plainTop = await imageStats(page, { kind: 'preview', index: after, which: 'screen', half: 'top' });
    const plainBottom = await imageStats(page, { kind: 'preview', index: after, which: 'screen', half: 'bottom' });
    expect(Math.abs(blueness(plainTop) - blueness(plainBottom))).toBeLessThan(3);

    // Undo brings the grade back, and with it the block, though this panel did not add it.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(grading).toBeVisible();
  });

  test('a mask takes the other effects too: a vignette of its own darkens under the mask only, and each is taken off by itself', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    // All of the mask's effect at the top of the photo, none at the bottom.
    await newMask(page, 'Linear');
    const add = panel.getByRole('button', { name: 'Add adjustment', exact: true });
    const choose = async (name: string) => {
      await add.click();
      await page.getByRole('menu', { name: 'Adjustments' }).getByRole('menuitem', { name, exact: true }).click();
    };
    const value = async (group: string, label: string, text: string) => {
      const box = panel.getByRole('group', { name: group, exact: true }).getByLabel(`${label} value`, { exact: true });
      await box.fill(text);
      await box.press('Enter');
    };

    // Sliders of the mask's own, in the Edit panel's order whatever order they are added in.
    await choose('Vignette & grain');
    await expect(panel.getByRole('group', { name: 'Mask 1 vignette & grain', exact: true }).getByRole('slider', { name: 'Vignette', exact: true })).toBeFocused();
    await choose('Whites & blacks');
    await choose('Curves');
    await expect(panel.getByRole('group', { name: 'Mask 1 curves', exact: true }).getByRole('tablist', { name: 'Curve channel' })).toBeVisible();
    await expect(panel.locator('[data-extra]')).toHaveCount(3);
    expect(await panel.locator('[data-extra]').evaluateAll((blocks) => blocks.map((b) => b.getAttribute('data-extra')))).toEqual(['tone', 'curves', 'finish']);

    // The mask's own vignette darkens the corners under the mask: the top of a flat photo, not the bottom.
    await value('Mask 1 vignette & grain', 'Vignette', '100');
    await value('Mask 1 whites & blacks', 'Blacks', '-40');
    const steps = () => page.evaluate(() => window.__photosHarness?.steps ?? []);
    expect(await steps()).toEqual(['Add linear mask', 'Mask 1 vignette +100', 'Mask 1 blacks −40']);
    const last = await settledPreview(page, 1);
    const top = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'top' });
    const bottom = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'bottom' });
    expect(top.mean).toBeLessThan(bottom.mean - 4);
    const index = await exportJpeg(page);
    const exportTop = await imageStats(page, { kind: 'export', index, half: 'top' });
    const exportBottom = await imageStats(page, { kind: 'export', index, half: 'bottom' });
    expect(exportTop.mean).toBeLessThan(exportBottom.mean - 4);
    // The photo's own Finish and Tone are untouched: these are the mask's.
    const recipe = (await page.evaluate(() => window.__photosHarness?.recipe)) as { finish: { vignette: number }; tone: { blacks: number } };
    expect(recipe.finish.vignette).toBe(0);
    expect(recipe.tone.blacks).toBe(0);

    // One taken off leaves the others.
    await panel.getByRole('button', { name: 'Remove Vignette & grain', exact: true }).click();
    expect((await steps()).at(-1)).toBe('Mask 1: remove vignette & grain');
    await expect(panel.locator('[data-extra]')).toHaveCount(2);
    await expect(panel.getByRole('group', { name: 'Mask 1 whites & blacks', exact: true }).getByLabel('Blacks value', { exact: true })).toHaveValue('−40');
  });

  test('masks are sections, one open at a time; the open one is duplicated, and one deleted leaves the rest', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    const duplicate = panel.getByRole('button', { name: 'Duplicate mask', exact: true });
    await expect(duplicate).toBeDisabled();

    // With no mask yet, one button in the middle of the panel adds the first.
    const first = panel.getByRole('button', { name: 'Add a mask', exact: true });
    const [column, firstBox] = await Promise.all([page.getByTestId('edit-panel').boundingBox(), first.boundingBox()]);
    if (!column || !firstBox) throw new Error('no column or Add a mask');
    expect(Math.abs(firstBox.x + firstBox.width / 2 - (column.x + column.width / 2))).toBeLessThan(3);
    expect(firstBox.y).toBeGreaterThan(column.y + column.height * 0.3);
    expect(firstBox.y).toBeLessThan(column.y + column.height * 0.75);
    await first.click();
    await page.getByRole('menu', { name: 'New mask' }).getByRole('menuitem', { name: /^Radial/ }).click();
    await expect(first).toHaveCount(0);
    await setMaskValue(page, 'Mask 1', 'Exposure', '-1');
    await panel.getByRole('button', { name: 'Invert Mask 1' }).click();
    // The heading: the name, a pencil beside it, then Delete and the eye at the right.
    const [name, pencil, trash, eye] = await Promise.all(
      ['Mask 1', 'Rename Mask 1', 'Delete Mask 1', 'Hide Mask 1'].map((label) => panel.getByRole('button', { name: label, exact: true }).boundingBox()),
    );
    if (!name || !pencil || !trash || !eye) throw new Error('no heading buttons');
    expect(pencil.x - (name.x + name.width)).toBeLessThan(12);
    expect(trash.x).toBeGreaterThan(pencil.x + 60);
    expect(eye.x).toBeGreaterThan(trash.x);

    // The copy is the open mask: the same kind, adjustments and Invert, over the same part of the photo.
    await duplicate.click();
    await expect(maskHeading(page, 'Mask 2')).toHaveAttribute('aria-expanded', 'true');
    await expect(maskHeading(page, 'Mask 2')).toBeFocused();
    await expect(maskHeading(page, 'Mask 1')).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('button', { name: 'Invert Mask 2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('group', { name: 'Mask 2 adjustments' }).getByLabel('Exposure value', { exact: true })).toHaveValue('−1.00');
    expect((await page.evaluate(() => window.__photosHarness?.steps))?.at(-1)).toBe('Duplicate Mask 1');
    const areas = await page.evaluate(() => Object.values((window.__photosHarness?.recipe as { areas: Record<string, { kind: string; geometry: unknown }> }).areas));
    expect(areas).toHaveLength(2);
    expect(areas[1]?.kind).toBe('radial');
    expect(areas[1]?.geometry).toEqual(areas[0]?.geometry);

    // Opening one folds the other; the bar stays at the foot of the column.
    await maskHeading(page, 'Mask 1').click();
    await expect(maskHeading(page, 'Mask 1')).toHaveAttribute('aria-expanded', 'true');
    await expect(maskHeading(page, 'Mask 2')).toHaveAttribute('aria-expanded', 'false');
    const foot = await panel.getByRole('group', { name: 'Masks', exact: true }).boundingBox();
    if (!foot) throw new Error('no foot');
    expect(Math.abs(foot.y + foot.height - (column.y + column.height))).toBeLessThan(2);

    await panel.getByRole('button', { name: 'Delete Mask 1', exact: true }).click();
    await expect(panel.getByRole('button', { name: /^Mask \d+$/ })).toHaveCount(1);
    await expect(maskHeading(page, 'Mask 1')).toBeFocused();
  });

  test("a mask's eye shows the photo without that mask, and the edit keeps it", async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    await newMask(page, 'Linear');
    await setMaskValue(page, 'Mask 1', 'Exposure', '-2');
    await settledPreview(page, 1);
    await expect.poll(() => topDarkerBy(page), { timeout: 30_000 }).toBeGreaterThan(15);

    const eye = panel.getByRole('button', { name: 'Hide Mask 1', exact: true });
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('hidden-badge')).toHaveText('Without Mask 1');
    await expect(panel.getByRole('region', { name: 'Mask 1', exact: true }).getByRole('heading', { level: 2 })).toHaveText('Mask 1, in use, hidden');
    await expect(panel.getByRole('slider', { name: 'Exposure', exact: true })).toBeDisabled();
    await expect.poll(() => topDarkerBy(page), { timeout: 30_000 }).toBeLessThan(3);
    // Nothing of the edit changed: no step, and the export still has the mask.
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add linear mask', 'Mask 1 exposure −2.00']);
    const index = await exportJpeg(page);
    const exportTop = await imageStats(page, { kind: 'export', index, half: 'top' });
    const exportBottom = await imageStats(page, { kind: 'export', index, half: 'bottom' });
    expect(exportTop.mean).toBeLessThan(exportBottom.mean - 15);

    await eye.click();
    await expect(page.getByTestId('hidden-badge')).toHaveCount(0);
    await expect.poll(() => topDarkerBy(page), { timeout: 30_000 }).toBeGreaterThan(15);
  });

  test('M adds a linear mask, Shift+M a radial one, and R toggles Crop', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await page.locator('body').press('m');
    await page.locator('body').press('Shift+M');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add linear mask', 'Add radial mask']);
    await expect(page.getByRole('region', { name: 'Mask', exact: true }).getByRole('button', { name: /^Mask \d+$/ })).toHaveCount(2);
    await page.locator('body').press('r');
    await expect(page.getByTestId('crop-tool')).toBeVisible();
    await page.locator('body').press('r');
    await expect(page.getByTestId('crop-tool')).toHaveCount(0);
  });

  test('with Show mask on, each new mask is selected and shows red on screen, never in an export', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);

    // M opens the Mask panel with a new linear mask, and O there turns Show mask on.
    await page.locator('body').press('m');
    await page.keyboard.press('o');
    await expect(maskHeading(page, 'Mask 1')).toHaveAttribute('aria-expanded', 'true');
    await expectMaskShown(page);
    // Still there long after the moment a new mask shows for, the histogram and the previews.
    await page.waitForTimeout(2500);
    expect(await canvasRedness(page)).toBeGreaterThan(0.02);

    await page.keyboard.press('Shift+M');
    await expect(maskHeading(page, 'Mask 2')).toHaveAttribute('aria-expanded', 'true');
    await expectMaskShown(page);
    await page.waitForTimeout(2500);
    expect(await canvasRedness(page)).toBeGreaterThan(0.02);

    const index = await exportJpeg(page);
    const exported = await imageStats(page, { kind: 'export', index });
    expect(Math.abs(exported.red - exported.green)).toBeLessThan(3);
    // And back on screen after the export.
    await expectMaskShown(page);
  });

  test('a mask shows for a moment when it is new or its eye is turned back on; O keeps it shown', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);

    const masks = page.getByRole('button', { name: 'Mask', exact: true });
    await masks.click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    // The bar at the foot has no Show mask: the eye and O do it.
    await expect(panel.getByRole('button', { name: 'Show mask' })).toHaveCount(0);
    await newMask(page, 'Radial');
    // Out of the way of the adjustments once the moment that shows what it covers is over.
    await expectMaskHidden(page);

    // Its eye off and on again shows it for that moment once more.
    const eye = panel.getByRole('button', { name: 'Hide Mask 1', exact: true });
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await expectMaskShown(page);
    await expectMaskHidden(page);

    await page.getByRole('group', { name: 'Photo' }).focus();
    await page.keyboard.press('o');
    await expectMaskShown(page);
    await page.waitForTimeout(2500);
    expect(await canvasRedness(page)).toBeGreaterThan(0.02);

    await page.keyboard.press('o');
    await expectMaskHidden(page);
    await page.keyboard.press('o');
    await expectMaskShown(page);

    // O is the Mask panel's: with the panel closed, no mask shows and the key changes nothing.
    await masks.click();
    await expect(panel).toHaveCount(0);
    await expectMaskHidden(page);
    await page.keyboard.press('o');
    await masks.click();
    await expectMaskShown(page);
    await page.waitForTimeout(2500);
    expect(await canvasRedness(page)).toBeGreaterThan(0.02);
  });

  test('a mask shows while a handle drags it and a moment after, and hides while its Exposure is dragged', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mask', exact: true });
    await newMask(page, 'Radial');
    await expectMaskHidden(page);

    const handle = await page.locator('[data-handle="move"]').boundingBox();
    if (!handle) throw new Error('no handle');
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 10, { steps: 5 });
    await expectMaskShown(page);
    // Held still for longer than the moment: still shown, as the drag goes on.
    await page.waitForTimeout(2000);
    expect(await canvasRedness(page)).toBeGreaterThan(0.02);
    await page.mouse.up();
    await expectMaskHidden(page);
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add radial mask', 'Mask: move']);

    // Show mask (O) shows it, but not while the mask's own Exposure is dragged.
    await page.getByRole('group', { name: 'Photo' }).focus();
    await page.keyboard.press('o');
    await expectMaskShown(page);
    const exposure = panel.getByRole('group', { name: 'Mask 1 adjustments' }).getByRole('slider', { name: 'Exposure', exact: true });
    await exposure.scrollIntoViewIfNeeded();
    const track = await exposure.boundingBox();
    if (!track) throw new Error('no Exposure slider');
    // Exposure is 0 of −4..4: its thumb is in the middle.
    await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width / 2 + 30, track.y + track.height / 2, { steps: 5 });
    await expectMaskHidden(page);
    await page.mouse.up();
    await expectMaskShown(page);
    const steps = await page.evaluate(() => window.__photosHarness?.steps ?? []);
    expect(steps[steps.length - 1]).toMatch(/^Mask 1 exposure \+/);
  });

  test('the pixel readout shows the colour under the pointer', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page, '#3c78b4');
    await waitForReady(page);
    const canvas = page.getByTestId('edit-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 2);
    const readout = page.getByTestId('pixel-readout');
    await expect(readout).toBeVisible();
    const [r, g, b] = ((await readout.textContent()) ?? '').match(/\d+/g)?.map(Number) ?? [];
    expect(Math.abs((r ?? 0) - 0x3c)).toBeLessThan(8);
    expect(Math.abs((g ?? 0) - 0x78)).toBeLessThan(8);
    expect(Math.abs((b ?? 0) - 0xb4)).toBeLessThan(8);
    await page.mouse.move(box.x + 2, box.y + 2);
    await expect(readout).toHaveCount(0);
  });
});
