import { expect, test } from '@playwright/test';
import { imageStats, openGeneratedImage, openHarness, previewCount, raiseExposure, waitForPreview, waitForReady } from './harness';

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

    await page.getByRole('slider', { name: 'Contrast' }).dblclick();
    await expect(readout).toHaveValue('0');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Contrast +25', 'Contrast 0']);
  });

  test('a group reset puts its sliders back', async ({ page }) => {
    const readout = page.getByLabel('Vibrance value');
    await readout.fill('40');
    await readout.press('Enter');
    await expect(readout).toHaveValue('+40');
    await page.getByRole('button', { name: 'Reset Color' }).click();
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
    await expect(page.getByRole('slider', { name: 'Exposure' })).toHaveAttribute('aria-disabled', 'true');
    await before.click();
    await expect(before).toHaveAttribute('aria-pressed', 'false');
  });

  test('zooms to 100% and back to fit', async ({ page }) => {
    const readout = page.getByTestId('zoom-readout');
    await page.getByRole('button', { name: '100%' }).click();
    await expect(readout).toHaveText('100%');
    await page.getByRole('button', { name: 'Fit' }).click();
    await expect(page.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true');
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
    await page.getByRole('button', { name: 'Flip' }).click();
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
