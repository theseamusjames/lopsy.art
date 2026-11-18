/**
 * Areas in the Edit view (spec 5.4): linear and radial areas, added from
 * the Areas panel, adjusted with their own sliders, rendered on screen and
 * in exports, and undone like any edit.
 */
import { expect, test, type Page } from '@playwright/test';
import { imageStats, openGeneratedImage, openHarness, settledPreview, waitForPreview, waitForReady } from './harness';

/** Mean brightness (0..255) of a region of export `index`, as fractions of its size. */
async function exportRegionMean(page: Page, index: number, region: { x: number; y: number; w: number; h: number }): Promise<number> {
  return page.evaluate(
    async ({ index, region }) => {
      const blob = window.__photosHarness?.exports[index]?.blob;
      if (!blob) throw new Error(`no export ${index}`);
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const x = Math.floor(region.x * bitmap.width);
      const y = Math.floor(region.y * bitmap.height);
      const data = ctx.getImageData(x, y, Math.max(1, Math.floor(region.w * bitmap.width)), Math.max(1, Math.floor(region.h * bitmap.height))).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      return sum / (data.length / 4);
    },
    { index, region },
  );
}

async function exportNow(page: Page): Promise<number> {
  const before = await page.evaluate(() => window.__photosHarness?.exports.length ?? 0);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction((n) => (window.__photosHarness?.exports.length ?? 0) > n, before);
  return before;
}

async function setAreaValue(page: Page, area: string, label: string, value: string): Promise<void> {
  const readout = page.getByRole('group', { name: area }).getByLabel(`${label} value`);
  await readout.fill(value);
  await readout.press('Enter');
}

const steps = (page: Page) => page.evaluate(() => window.__photosHarness?.steps ?? []);

test.describe('Areas', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await openGeneratedImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
  });

  test('a linear area darkens the top, on screen and in an export, and undo removes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Areas', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Areas' });
    await panel.getByRole('button', { name: 'Linear' }).click();
    await expect(panel.getByRole('button', { name: 'Area 1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('areas-overlay')).toBeVisible();
    // The new linear area is full at a quarter of the height and gone at three quarters.
    const previewsBefore = await page.evaluate(() => window.__photosHarness?.previews.length ?? 0);
    await setAreaValue(page, 'Area 1', 'Exposure', '-1');
    expect(await steps(page)).toEqual(['Add linear area', 'Area 1 exposure −1.00']);

    const first = await exportNow(page);
    const top = await exportRegionMean(page, first, { x: 0.05, y: 0.02, w: 0.9, h: 0.15 });
    const bottom = await exportRegionMean(page, first, { x: 0.05, y: 0.83, w: 0.9, h: 0.15 });
    expect(top).toBeLessThan(bottom - 20);

    // The previews rendered once the edit settled show it too.
    const last = await settledPreview(page, previewsBefore);
    const screenTop = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'top' });
    const screenBottom = await imageStats(page, { kind: 'preview', index: last, which: 'screen', half: 'bottom' });
    expect(screenTop.mean).toBeLessThan(screenBottom.mean - 10);
    await page.screenshot({ path: 'test-results/areas-linear.png' });

    // Undo twice: the exposure, then the area itself.
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(panel.getByRole('button', { name: 'Area 1' })).toHaveCount(0);
    await expect(page.getByTestId('areas-overlay')).toHaveCount(0);
    const after = await exportNow(page);
    const topAfter = await exportRegionMean(page, after, { x: 0.05, y: 0.02, w: 0.9, h: 0.15 });
    const bottomAfter = await exportRegionMean(page, after, { x: 0.05, y: 0.83, w: 0.9, h: 0.15 });
    expect(Math.abs(topAfter - bottomAfter)).toBeLessThan(3);
  });

  test('an inverted radial area leaves the centre alone and darkens the edges', async ({ page }) => {
    const plain = await exportNow(page);
    const centreBefore = await exportRegionMean(page, plain, { x: 0.45, y: 0.45, w: 0.1, h: 0.1 });
    const cornerBefore = await exportRegionMean(page, plain, { x: 0.01, y: 0.01, w: 0.06, h: 0.06 });

    await page.getByRole('button', { name: 'Areas', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Areas' });
    await panel.getByRole('button', { name: 'Radial' }).click();
    await page.getByRole('group', { name: 'Area 1' }).getByRole('checkbox', { name: 'Invert' }).check();
    await setAreaValue(page, 'Area 1', 'Exposure', '-2');
    expect(await steps(page)).toEqual(['Add radial area', 'Area 1 invert', 'Area 1 exposure −2.00']);
    await expect(page.getByRole('slider', { name: 'Rotate' })).toBeVisible();

    const graded = await exportNow(page);
    const centre = await exportRegionMean(page, graded, { x: 0.45, y: 0.45, w: 0.1, h: 0.1 });
    const corner = await exportRegionMean(page, graded, { x: 0.01, y: 0.01, w: 0.06, h: 0.06 });
    expect(Math.abs(centre - centreBefore)).toBeLessThan(2);
    expect(corner).toBeLessThan(cornerBefore - 10);
    await page.screenshot({ path: 'test-results/areas-radial.png' });
  });

  test('dragging a handle moves the area as one step', async ({ page }) => {
    await page.getByRole('button', { name: 'Areas', exact: true }).click();
    await page.getByRole('region', { name: 'Areas' }).getByRole('button', { name: 'Radial' }).click();
    const knob = page.getByRole('slider', { name: 'Width' });
    const box = await knob.boundingBox();
    if (!box) throw new Error('no handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await steps(page)).toEqual(['Add radial area', 'Area: resize']);
    const geometry = await page.evaluate(() => {
      const recipe = window.__photosHarness?.recipe as { areas: Record<string, { geometry: { rx: number } }> } | null;
      return Object.values(recipe?.areas ?? {})[0]?.geometry;
    });
    expect(geometry?.rx).toBeGreaterThan(0.25);
  });
});
