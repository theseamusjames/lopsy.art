import { expect, test, type Page } from '@playwright/test';
import { imageStats, openFlatImage, openHarness, settledPreview, waitForPreview, waitForReady } from './harness';

async function setMaskValue(page: Page, mask: string, label: string, value: string): Promise<void> {
  const readout = page.getByRole('group', { name: `${mask} adjustments` }).getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}

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

    await page.getByRole('button', { name: 'Masks', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Masks' });
    await panel.getByRole('button', { name: 'Linear' }).click();
    await expect(panel.getByRole('list', { name: 'Mask list' }).getByRole('button', { name: /^Linear\s*Mask 1$/ })).toHaveAttribute('aria-current', 'true');
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
    await expect(panel.getByRole('list', { name: 'Mask list' }).getByRole('button')).toHaveCount(0);
  });

  test('an inverted radial mask leaves its centre alone and changes the corners', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen', half: 'centre' });

    await page.getByRole('button', { name: 'Masks', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Masks' });
    await panel.getByRole('button', { name: 'Radial' }).click();
    await panel.getByRole('button', { name: 'Invert Mask 1' }).click();
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
    await page.getByRole('button', { name: 'Masks', exact: true }).click();
    await page.getByRole('region', { name: 'Masks' }).getByRole('button', { name: 'Radial' }).click();
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

  test('M adds a linear mask, Shift+M a radial one, and R toggles Crop', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await page.locator('body').press('m');
    await page.locator('body').press('Shift+M');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Add linear mask', 'Add radial mask']);
    await expect(page.getByRole('list', { name: 'Mask list' }).getByRole('button', { name: /^(Linear|Radial)/ })).toHaveCount(2);
    await page.locator('body').press('r');
    await expect(page.getByTestId('crop-tool')).toBeVisible();
    await page.locator('body').press('r');
    await expect(page.getByTestId('crop-tool')).toHaveCount(0);
  });

  test('a newly added mask is selected and shows red on screen, never in an export', async ({ page }) => {
    await openHarness(page);
    await openFlatImage(page);
    await waitForReady(page);
    await waitForPreview(page, 0);

    const steps = [
      ['m', /^Linear\s*Mask 1$/],
      ['Shift+M', /^Radial\s*Mask 2$/],
    ] as const;
    for (const [key, name] of steps) {
      await page.locator('body').press(key);
      await expect(page.getByRole('list', { name: 'Mask list' }).getByRole('button', { name })).toHaveAttribute('aria-current', 'true');
      // The photo is grey: only the selected mask's red overlay makes the screen redder than green.
      await expect.poll(() => canvasRedness(page), { timeout: 30_000 }).toBeGreaterThan(0.02);
      // Still there once the histogram has been read and the previews rendered.
      await page.waitForTimeout(2500);
      expect(await canvasRedness(page)).toBeGreaterThan(0.02);
    }

    const index = await exportJpeg(page);
    const exported = await imageStats(page, { kind: 'export', index });
    expect(Math.abs(exported.red - exported.green)).toBeLessThan(3);
    // And back on screen after the export.
    await expect.poll(() => canvasRedness(page), { timeout: 30_000 }).toBeGreaterThan(0.02);
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
