import { expect, test } from './test';
import { settledPreview, imageStats, openGeneratedImage, openHarness, previewCount, raiseExposure, waitForPreview, waitForReady } from './harness';

test.describe('Edit view on a JPEG', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
  });

  test('renders previews of the opened photo', async ({ page }) => {
    await waitForPreview(page, 0);
    const thumb = await imageStats(page, { kind: 'preview', index: 0, which: 'thumb' });
    const screen = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    expect(thumb.type).toBe('image/jpeg');
    expect([thumb.width, thumb.height]).toEqual([512, 384]);
    expect([screen.width, screen.height]).toEqual([640, 480]);
    expect(screen.spread).toBeGreaterThan(10);
  });

  test('moving Exposure brightens the render, as one history step', async ({ page }) => {
    const firstHash = await waitForPreview(page, 0);
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });

    await raiseExposure(page, 5);
    await expect(page.getByLabel('Exposure value')).toHaveValue('+0.50');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Exposure +0.50']);

    const secondHash = await waitForPreview(page, 1);
    expect(secondHash).not.toBe(firstHash);
    const after = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect(after.mean).toBeGreaterThan(before.mean + 15);
  });

  test('a typed value commits, undo and redo follow the keyboard', async ({ page }) => {
    await waitForPreview(page, 0);
    const readout = page.getByLabel('Contrast value');
    await readout.fill('25');
    await readout.press('Enter');
    await expect(readout).toHaveValue('+25');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Contrast +25']);

    await page.getByRole('slider', { name: 'Contrast' }).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(readout).toHaveValue('0');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(readout).toHaveValue('+25');

    // On the label: a press on the track would first move the value to where it landed.
    await page.getByRole('region', { name: 'Tone' }).getByText('Contrast', { exact: true }).dblclick();
    await expect(readout).toHaveValue('0');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Contrast +25', 'Contrast 0']);
  });

  test('a group reset puts its sliders back', async ({ page }) => {
    const readout = page.getByLabel('Vibrance value');
    await readout.fill('40');
    await readout.press('Enter');
    await expect(readout).toHaveValue('+40');
    await page.getByRole('button', { name: 'Reset Color', exact: true }).click();
    await expect(readout).toHaveValue('0');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Vibrance +40', 'Reset Color']);
  });

  test('Before shows the photo without its edits', async ({ page }) => {
    await waitForPreview(page, 0);
    const readout = page.getByLabel('Exposure value');
    await readout.fill('2');
    await readout.press('Enter');
    await waitForPreview(page, 1);
    const before = page.getByRole('button', { name: 'Before' });
    await before.click();
    await expect(before).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('slider', { name: 'Exposure' })).toBeDisabled();
    await before.click();
    await expect(before).toHaveAttribute('aria-pressed', 'false');
  });

  test('the bar under the photo: a zoom level to type in, Fit and Full', async ({ page }) => {
    const bar = page.getByRole('group', { name: 'View' });
    const zoom = bar.getByRole('textbox', { name: 'Zoom', exact: true });
    const fit = bar.getByRole('button', { name: 'Fit', exact: true });
    // Before and Split are icons only, named for screen readers.
    await expect(bar.getByRole('button', { name: 'Before', exact: true })).toHaveText('');
    await expect(bar.getByRole('button', { name: 'Split', exact: true })).toHaveText('');
    // The bar sits under the photo.
    const stage = (await page.getByRole('group', { name: 'Photo' }).boundingBox())!;
    expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    // The zoom level leads the bar, with Fit and Full after it.
    expect((await zoom.boundingBox())!.x).toBeLessThan((await fit.boundingBox())!.x);

    await bar.getByRole('button', { name: 'Full', exact: true }).click();
    await expect(zoom).toHaveValue('100%');
    await expect(bar.getByTestId('zoom-readout')).toHaveValue('100%');

    // A click selects the level, so typing replaces it; Enter takes it and keeps the field.
    await zoom.click();
    await page.keyboard.type('70');
    await page.keyboard.press('Enter');
    await expect(zoom).toHaveValue('70%');
    await expect(zoom).toBeFocused();
    await expect(fit).toHaveAttribute('aria-pressed', 'false');

    // Up and Down step to the next 10 %.
    await page.keyboard.press('ArrowUp');
    await expect(zoom).toHaveValue('80%');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(zoom).toHaveValue('60%');

    // The sign is optional, and a level outside the range is held to it.
    await page.keyboard.type('1000 %');
    await page.keyboard.press('Enter');
    await expect(zoom).toHaveValue('400%');

    // What is not a number puts the level back, and Escape drops what was typed without leaving the photo.
    await page.keyboard.type('big');
    await page.keyboard.press('Enter');
    await expect(zoom).toHaveValue('400%');
    await page.keyboard.type('25');
    await page.keyboard.press('Escape');
    await expect(zoom).toHaveValue('400%');
    await expect(page.getByTestId('edit-view')).toBeVisible();

    // Leaving the field takes what was typed.
    await page.keyboard.type('150');
    await fit.focus();
    await expect(zoom).toHaveValue('150%');

    await fit.click();
    await expect(fit).toHaveAttribute('aria-pressed', 'true');
  });

  test('undo and redo sit after the tools, not beside rotate', async ({ page }) => {
    const undo = (await page.getByRole('button', { name: 'Undo', exact: true }).boundingBox())!;
    const redo = (await page.getByRole('button', { name: 'Redo', exact: true }).boundingBox())!;
    const rotate = (await page.getByRole('button', { name: 'Rotate right', exact: true }).boundingBox())!;
    const crop = (await page.getByRole('button', { name: 'Crop', exact: true }).boundingBox())!;
    expect(undo.x).toBeGreaterThan(crop.x);
    expect(undo.x).toBeGreaterThan(rotate.x);
    expect(redo.x).toBeGreaterThan(undo.x);
  });

  test('exports a full-size JPEG of the edit', async ({ page }) => {
    const readout = page.getByLabel('Exposure value');
    await readout.fill('1');
    await readout.press('Enter');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    expect((await download).suggestedFilename()).toBe('generated.jpg');
    const stats = await imageStats(page, { kind: 'export', index: 0 });
    expect(stats.type).toBe('image/jpeg');
    expect(stats.head.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
    expect([stats.width, stats.height]).toEqual([640, 480]);
    expect(stats.spread).toBeGreaterThan(10);
  });

  test('Edit in Lopsy hands over a full-size 16-bit PNG', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit in Lopsy' }).click();
    await page.waitForFunction(() => (window.__photosHarness?.lopsyPngs.length ?? 0) > 0);
    const header = await page.evaluate(() => {
      const png = window.__photosHarness?.lopsyPngs[0];
      if (!png) throw new Error('no PNG');
      const view = new DataView(png);
      return {
        signature: Array.from(new Uint8Array(png, 0, 8)),
        chunk: String.fromCharCode(...new Uint8Array(png, 12, 4)),
        width: view.getUint32(16),
        height: view.getUint32(20),
        bitDepth: view.getUint8(24),
      };
    });
    expect(header.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(header.chunk).toBe('IHDR');
    expect([header.width, header.height]).toEqual([640, 480]);
    expect(header.bitDepth).toBe(16);
  });

  test('previews are not rendered again for an unchanged edit', async ({ page }) => {
    await waitForPreview(page, 0);
    await page.waitForTimeout(2500);
    expect(await previewCount(page)).toBe(1);
  });

  test('Temperature warms the render', async ({ page }) => {
    await waitForPreview(page, 0);
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    const readout = page.getByLabel('Temperature value');
    await readout.fill('60');
    await readout.press('Enter');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Temperature +60']);
    await waitForPreview(page, 1);
    const after = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect(after.red - after.blue).toBeGreaterThan(before.red - before.blue + 10);
  });

  test('rotating turns the image a quarter turn', async ({ page }) => {
    await waitForPreview(page, 0);
    await page.getByRole('button', { name: 'Rotate right' }).click();
    await waitForPreview(page, 1);
    const rotated = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect([rotated.width, rotated.height]).toEqual([480, 640]);
    await page.getByRole('button', { name: 'Flip', exact: true }).click();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Rotate right', 'Flip']);
    await waitForPreview(page, 2);
    const restored = await imageStats(page, { kind: 'preview', index: 2, which: 'screen' });
    expect([restored.width, restored.height]).toEqual([640, 480]);
  });
});

for (const type of ['image/png', 'image/webp'] as const) {
  test(`opens a ${type.slice(6).toUpperCase()} and renders it`, async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page, 320, 200, type);
    await waitForReady(page);
    await waitForPreview(page, 0);
    const screen = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    expect([screen.width, screen.height]).toEqual([320, 200]);
    expect(screen.spread).toBeGreaterThan(10);
  });
}

test.describe('Histogram, Auto and Profile on a JPEG', () => {
  test('the histogram appears and Auto brightens a dark photo as one step', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page, 640, 480, 'image/jpeg', ['#0a0c10', '#302418', '#1a1a1a']);
    await waitForReady(page);
    await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('clip-shadows')).toBeAttached();

    await page.getByRole('button', { name: 'Auto Tone' }).click();
    await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Auto tone']);
    const exposure = Number((await page.getByLabel('Exposure value').inputValue()).replace('\u2212', '-'));
    expect(exposure).toBeGreaterThan(0.5);
  });

  test('offers Standard and Monochrome, and no Auto white balance', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    const profile = page.getByRole('combobox', { name: 'Profile' });
    await expect(profile.locator('option')).toHaveText(['Standard', 'Monochrome']);
    await expect(page.getByRole('button', { name: 'Auto White balance' })).toHaveCount(0);

    await waitForPreview(page, 0);
    await profile.selectOption('monochrome');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Profile: Monochrome']);
    await waitForPreview(page, 1);
    const mono = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect(Math.abs(mono.red - mono.blue)).toBeLessThan(4);
  });
});

test.describe('Crop', () => {
  test('crops to 1:1, and the export and previews are square', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);

    await page.getByTitle('Crop (R)', { exact: true }).click();
    await expect(page.getByTestId('crop-tool')).toBeVisible();
    await page.getByRole('combobox', { name: 'Aspect' }).selectOption('1:1');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('crop-tool')).toHaveCount(0);
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Crop']);

    await waitForPreview(page, 1);
    const preview = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect([preview.width, preview.height]).toEqual([480, 480]);

    await page.getByRole('button', { name: 'Export' }).click();
    await page.waitForFunction(() => (window.__photosHarness?.exports.length ?? 0) > 0);
    const exported = await imageStats(page, { kind: 'export', index: 0 });
    expect([exported.width, exported.height]).toEqual([480, 480]);
  });

  test('a crop turns with the photo and Esc cancels the tool', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    await page.getByTitle('Crop (R)', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Aspect' }).selectOption('3:2');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('crop-tool')).toHaveCount(0);
    await page.getByRole('button', { name: 'Rotate right' }).click();
    await waitForPreview(page, 1);
    const turned = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    // 640x480 cropped to 3:2 is 640x427; turned, 427x640.
    expect(turned.height).toBe(640);
    expect(Math.abs(turned.width - 427)).toBeLessThanOrEqual(1);

    await page.getByTitle('Crop (R)', { exact: true }).click();
    await expect(page.getByTestId('crop-tool')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('crop-tool')).toHaveCount(0);
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Crop', 'Rotate right']);
  });
});

test.describe('Colour controls', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
  });

  test('raising the luminance curve brightens the render, as one step', async ({ page }) => {
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    const curve = page.getByRole('group', { name: 'Luminance curve' });
    await curve.scrollIntoViewIfNeeded();
    const box = await curve.boundingBox();
    if (!box) throw new Error('no curve editor');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Curves: Luminance']);
    const last = await settledPreview(page, 1);
    const after = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
    expect(after.mean).toBeGreaterThan(before.mean + 10);
  });

  test('desaturating the orange band takes the colour out of orange tones', async ({ page }) => {
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    const group = page.getByRole('region', { name: 'Color by hue' });
    await group.getByRole('tab', { name: 'Saturation' }).click();
    for (const band of ['Red', 'Orange']) {
      const readout = group.getByLabel(`${band} value`);
      await readout.fill('-100');
      await readout.press('Enter');
    }
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Red saturation \u2212100', 'Orange saturation \u2212100']);
    const last = await settledPreview(page, 1);
    const after = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
    expect(after.red - after.blue).toBeLessThan(before.red - before.blue - 10);
  });

  test('a global colour grade tints the image', async ({ page }) => {
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    const group = page.getByRole('region', { name: 'Color Grading' });
    await group.getByRole('tab', { name: 'Global' }).click();
    const hue = group.getByLabel('Hue value');
    await hue.fill('220');
    await hue.press('Enter');
    const saturation = group.getByLabel('Saturation value');
    await saturation.fill('80');
    await saturation.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps.length)).toBe(2);
    const last = await settledPreview(page, 1);
    const after = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
    expect(after.blue - after.red).toBeGreaterThan(before.blue - before.red + 10);
  });

  test('the colour field sets hue and saturation together, and is enlarged for finer control', async ({ page }) => {
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    const group = page.getByRole('region', { name: 'Color Grading' });
    await group.getByRole('tab', { name: 'Global' }).click();
    const field = group.getByRole('slider', { name: 'Global color', exact: true });
    const enlarge = group.getByRole('button', { name: 'Enlarge Global color', exact: true });
    const hue = group.getByLabel('Hue value');
    const saturation = group.getByLabel('Saturation value');
    /** How far the typed value of `box` is from `wanted`. */
    const offBy = async (box: typeof hue, wanted: number) => Math.abs(Number(await box.inputValue()) - wanted);
    const steps = () => page.evaluate(() => window.__photosHarness?.steps);

    // A square as wide as the tabs above it, with Enlarge in its bottom left corner.
    await field.scrollIntoViewIfNeeded();
    const [small, tabs, button] = await Promise.all([field.boundingBox(), group.getByRole('tablist').boundingBox(), enlarge.boundingBox()]);
    if (!small || !tabs || !button) throw new Error('no field, tabs or Enlarge');
    expect(Math.abs(small.width - small.height)).toBeLessThan(1);
    expect(Math.abs(small.width - tabs.width)).toBeLessThan(1);
    expect(button.x - small.x).toBeLessThan(8);
    expect(small.y + small.height - (button.y + button.height)).toBeLessThan(8);

    // A click picks both at once: 60 % across is hue 216, 20 % down is saturation 80. One step.
    await page.mouse.click(small.x + small.width * 0.6, small.y + small.height * 0.2);
    await expect.poll(() => offBy(hue, 216)).toBeLessThan(3);
    await expect.poll(() => offBy(saturation, 80)).toBeLessThan(3);
    expect(await steps()).toEqual(['Global color']);
    const last = await settledPreview(page, 1);
    const after = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
    expect(after.blue - after.red).toBeGreaterThan(before.blue - before.red + 10);

    // Over the field the pointer is a ring of the colour under it: here, the one just picked, as the marker is.
    const ring = field.getByTestId('color-pointer');
    const fill = (testId: string) => field.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(ring).toBeVisible();
    expect(await field.evaluate((el) => getComputedStyle(el).cursor)).toBe('none');
    const picked = await fill('color-marker');
    expect(await fill('color-pointer')).toBe(picked);
    // Moved, it shows another colour, and the picked one stays; off the field it is gone.
    await page.mouse.move(small.x + small.width * 0.1, small.y + small.height * 0.1);
    await expect.poll(() => fill('color-pointer')).not.toBe(picked);
    expect(await fill('color-marker')).toBe(picked);
    await page.mouse.move(small.x - 40, small.y + 20);
    await expect(ring).toHaveCount(0);

    // Enlarged: about 500 px, out of the panel over the photo, its right edge where the small one's is.
    await enlarge.click();
    await expect(enlarge).toHaveAttribute('aria-expanded', 'true');
    await expect(field).toBeFocused();
    await expect.poll(async () => (await field.boundingBox())?.width ?? 0).toBeGreaterThan(499);
    const now = await group.getByRole('tablist').boundingBox();
    const big = await field.boundingBox();
    if (!big || !now) throw new Error('no enlarged field');
    expect(big.width).toBeLessThan(501);
    expect(Math.abs(big.height - big.width)).toBeLessThan(1);
    expect(Math.abs(big.x + big.width - (now.x + now.width))).toBeLessThan(1);

    // A click in it picks, as one more step, and puts it back. A pixel of it is 0.72° of hue and 0.2 of
    // saturation, kept to a tenth: 126 px across is 90.7°, 251 px down is 49.8.
    await page.mouse.click(big.x + 126, big.y + 251);
    await expect(enlarge).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => offBy(hue, 90.7)).toBeLessThan(0.8);
    await expect.poll(() => offBy(saturation, 49.8)).toBeLessThan(0.3);
    // The boxes show the tenth, so going into one and out again changes nothing.
    const kept = await hue.inputValue();
    await hue.focus();
    await hue.press('Enter');
    await expect(hue).toHaveValue(kept);
    await saturation.focus();
    await saturation.press('Enter');
    const stored = await page.evaluate(() => (window.__photosHarness?.recipe as { colorGrading: { global: { hue: number; saturation: number } } }).colorGrading.global);
    expect(String(stored.hue)).toBe(kept);
    expect(Math.abs(stored.saturation - 49.8)).toBeLessThan(0.3);
    await expect.poll(async () => (await field.boundingBox())?.width ?? 0).toBeLessThan(small.width + 1);
    expect(await steps()).toEqual(['Global color', 'Global color']);

    // The wheel puts it back too, and a click elsewhere, picking nothing.
    await enlarge.click();
    await expect(enlarge).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.wheel(0, 40);
    await expect(enlarge).toHaveAttribute('aria-expanded', 'false');
    await enlarge.click();
    await expect(enlarge).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('group', { name: 'Photo' }).click({ position: { x: 10, y: 10 } });
    await expect(enlarge).toHaveAttribute('aria-expanded', 'false');

    // Escape is the field's while it is enlarged: the Edit view stays. The arrow keys move the marker.
    await enlarge.click();
    await page.keyboard.press('Escape');
    await expect(enlarge).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('edit-view')).toBeVisible();
    await expect(field).toBeFocused();
    const was = Number(await saturation.inputValue());
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => offBy(saturation, was + 1)).toBeLessThan(0.05);
    // Alt is the fine step, a tenth.
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => offBy(saturation, was + 1.1)).toBeLessThan(0.05);
    expect(await steps()).toEqual(['Global color', 'Global color', 'Global color', 'Global color']);
  });
});

test.describe('Working image and keys', () => {
  test('a large photo is edited at working size and exports at full size', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page, 4000, 3000);
    await waitForReady(page);
    // Fit is far below the full image's size; the readout says so against the full image.
    const fit = Number((await page.getByTestId('zoom-readout').inputValue()).replace('%', ''));
    expect(fit).toBeLessThan(40);
    await waitForPreview(page, 0);
    const preview = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    expect(Math.max(preview.width, preview.height)).toBe(2048);

    await page.getByRole('button', { name: 'Export' }).click();
    await page.waitForFunction(() => (window.__photosHarness?.exports.length ?? 0) > 0, null, { timeout: 120_000 });
    const size = await page.evaluate(async () => {
      const blob = window.__photosHarness?.exports[0]?.blob;
      if (!blob) throw new Error('no export');
      const bitmap = await createImageBitmap(blob);
      return [bitmap.width, bitmap.height];
    });
    expect(size).toEqual([4000, 3000]);
  });

  test('100 % on a large photo loads its full resolution', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page, 4000, 3000);
    await waitForReady(page);
    await page.getByRole('button', { name: 'Full', exact: true }).click();
    await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
    await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
  });

  test('? lists the shortcuts and Escape goes back, unless a tool is open', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await page.locator('body').press('?');
    const help = page.getByRole('dialog', { name: 'Edit shortcuts' });
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(page.getByTestId('edit-view')).toBeVisible();

    await page.getByTitle('Crop (R)', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('crop-tool')).toHaveCount(0);
    await expect(page.getByTestId('edit-view')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('edit-view')).toHaveCount(0);
  });
});
