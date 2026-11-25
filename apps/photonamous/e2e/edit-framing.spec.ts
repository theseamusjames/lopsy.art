import { expect, test, type Page } from '@playwright/test';
import { imageStats, openGeneratedImage, openHarness, openTopBottomImage, settledPreview, waitForPreview, waitForReady } from './harness';

async function setValue(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}

async function exportJpeg(page: Page): Promise<number> {
  const count = await page.evaluate(() => window.__photosHarness?.exports.length ?? 0);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction((n) => (window.__photosHarness?.exports.length ?? 0) > n, count);
  return count;
}

test.describe('Straighten, flip vertical, presets and detail', () => {
  test('straightening shrinks the export to the inscribed crop', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await setValue(page, 'Angle', '10');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Straighten +10.0']);
    const index = await exportJpeg(page);
    const out = await imageStats(page, { kind: 'export', index });
    // 640×480 turned by 10° keeps 82.2 % of each side.
    expect(Math.abs(out.width - 526)).toBeLessThanOrEqual(2);
    expect(Math.abs(out.height - 394)).toBeLessThanOrEqual(2);
    expect(out.spread).toBeGreaterThan(10);

    await setValue(page, 'Angle', '0');
    const back = await exportJpeg(page);
    const full = await imageStats(page, { kind: 'export', index: back });
    expect([full.width, full.height]).toEqual([640, 480]);
  });

  test('the Level tool sets the angle from a drawn line', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await page.getByRole('button', { name: 'Level Straighten' }).click();
    const tool = page.getByTestId('level-tool');
    const box = await tool.boundingBox();
    if (!box) throw new Error('no level tool');
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 330, { steps: 5 });
    await page.mouse.up();
    await expect(tool).toHaveCount(0);
    const angle = Number((await page.getByLabel('Angle value', { exact: true }).inputValue()).replace('−', '-'));
    expect(angle).toBeCloseTo(-5.7, 0);
  });

  test('Flip vertical turns the photo upside down', async ({ page }) => {
    await openHarness(page);
    await openTopBottomImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    const top = await imageStats(page, { kind: 'preview', index: 0, which: 'screen', half: 'top' });
    expect(top.red).toBeGreaterThan(top.blue + 50);
    await page.getByRole('button', { name: 'Flip vertical' }).click();
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Flip vertical']);
    await waitForPreview(page, 1);
    const flipped = await imageStats(page, { kind: 'preview', index: 1, which: 'screen', half: 'top' });
    expect(flipped.blue).toBeGreaterThan(flipped.red + 50);
    const size = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect([size.width, size.height]).toEqual([400, 300]);
  });

  test('a preset previews on hover and applies as one step; a saved one lists', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    const presets = page.getByRole('list', { name: 'Presets' });
    await presets.getByRole('button', { name: 'Punchy', exact: true }).hover();
    // Hovering changes nothing in the edit.
    await expect(page.getByLabel('Contrast value', { exact: true })).toHaveValue('0');
    await presets.getByRole('button', { name: 'Punchy', exact: true }).click();
    // Punchy's Contrast, as re-tuned for the linear pipeline (packages/photos-core/src/library/presets.ts).
    await expect(page.getByLabel('Contrast value', { exact: true })).toHaveValue('+45');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Preset: Punchy']);

    await page.getByRole('button', { name: 'Save preset…' }).click();
    await page.getByLabel('Preset name').fill('My look');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(presets.getByRole('button', { name: 'My look', exact: true })).toBeVisible();
  });

  test('sharpening and local contrast change the render', async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    await setValue(page, 'Haze', '80');
    await setValue(page, 'Sharpen', '120');
    const last = await settledPreview(page, 1);
    const after = await imageStats(page, { kind: 'preview', index: last, which: 'screen' });
    expect(Math.abs(after.mean - before.mean) + Math.abs(after.spread - before.spread)).toBeGreaterThan(3);
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Haze +80', 'Sharpen +120']);
  });
});
