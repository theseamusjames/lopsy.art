import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './test';
import { imageStats, openGeneratedImage, openHarness, previewCount, settledPreview, waitForPreview, waitForReady } from './harness';
import { maskPanel, newMask, setMaskValue } from './masks';

/**
 * Sliders that run to 150 where 100 was only a cap (docs/photonamous-linear-plan.md,
 * decision 58): typed or dragged to 150, the picture keeps changing past 100;
 * Temperature and Tint run on to 200;
 * a slider whose end is a real one still stops there; and a camera preset
 * that ±100 used to cut off applies its own values on a real RAF (needs
 * LOPSY_RAF_SAMPLES, github.com/theseamusjames/sample-raf-images).
 */

function panel(page: Page): Locator {
  return page.getByTestId('edit-panel');
}

/** The value box of the Edit panel's slider `label` in its section `section`. */
function readout(page: Page, section: string, label: string): Locator {
  return panel(page).getByRole('region', { name: section, exact: true }).getByLabel(`${label} value`, { exact: true });
}

function slider(page: Page, section: string, label: string): Locator {
  return panel(page).getByRole('region', { name: section, exact: true }).getByRole('slider', { name: label, exact: true });
}

async function type(page: Page, section: string, label: string, value: string): Promise<void> {
  const box = readout(page, section, label);
  await box.fill(value);
  await box.press('Enter');
}

/** Opens a generated JPEG and waits for its first preview. */
async function openPicture(page: Page, colors?: readonly [string, string, string]): Promise<void> {
  await openHarness(page);
  await openGeneratedImage(page, 640, 480, 'image/jpeg', colors);
  await waitForReady(page);
  await waitForPreview(page, 0);
}

/** Sets a slider by typing and answers the settled preview's index. */
async function settleAt(page: Page, section: string, label: string, value: string): Promise<number> {
  const count = await previewCount(page);
  await type(page, section, label, value);
  return settledPreview(page, count);
}

/** The mean of max(|R−G|, |G−B|, |R−B|) over a recorded preview: how far it is from grey. */
async function previewChroma(page: Page, index: number): Promise<number> {
  return page.evaluate(async (n) => {
    const blob = window.__photosHarness?.previews[n]?.screen;
    if (!blob) throw new Error(`no preview ${n}`);
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      sum += Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    }
    return sum / (data.length / 4);
  }, index);
}

async function recipeValue(page: Page, path: string): Promise<unknown> {
  return page.evaluate((p) => {
    let at: unknown = window.__photosHarness?.recipe;
    for (const key of p.split('.')) at = (at as Record<string, unknown> | undefined)?.[key];
    return at;
  }, path);
}

test.describe('Sliders past 100', () => {
  test('Contrast runs to 150 by typing, dragging and End, and the picture keeps spreading past 100', async ({ page }) => {
    await openPicture(page);
    const contrast = slider(page, 'Tone', 'Contrast');
    await expect(contrast).toHaveAttribute('min', '-150');
    await expect(contrast).toHaveAttribute('max', '150');

    const at100 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'Tone', 'Contrast', '100'), which: 'screen' });
    const at150 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'Tone', 'Contrast', '150'), which: 'screen' });
    console.log(`Contrast: spread ${at100.spread.toFixed(2)} at 100, ${at150.spread.toFixed(2)} at 150`);
    await expect(readout(page, 'Tone', 'Contrast')).toHaveValue('+150');
    expect(await recipeValue(page, 'tone.contrast')).toBe(150);
    expect(at150.spread).toBeGreaterThan(at100.spread + 1);

    // Beyond the end it is held there, as 100 used to be.
    await type(page, 'Tone', 'Contrast', '400');
    await expect(readout(page, 'Tone', 'Contrast')).toHaveValue('+150');
    await type(page, 'Tone', 'Contrast', '-400');
    await expect(readout(page, 'Tone', 'Contrast')).toHaveValue('−150');

    // Double-clicking the name resets to 0; End and Home go to the ends.
    await type(page, 'Tone', 'Contrast', '0');
    await contrast.focus();
    await page.keyboard.press('End');
    await expect(readout(page, 'Tone', 'Contrast')).toHaveValue('+150');
    await page.keyboard.press('Home');
    await expect(readout(page, 'Tone', 'Contrast')).toHaveValue('−150');

    // A drag past the track's right end stops at 150; the track's middle is still 0.
    const box = await contrast.boundingBox();
    if (!box) throw new Error('no Contrast slider');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(readout(page, 'Tone', 'Contrast')).toHaveValue('+150');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const middle = Number((await readout(page, 'Tone', 'Contrast').inputValue()).replace('−', '-'));
    expect(Math.abs(middle)).toBeLessThanOrEqual(3);

    // "−150" fits its box.
    await type(page, 'Tone', 'Contrast', '-150');
    const fits = await readout(page, 'Tone', 'Contrast').evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth);
    expect(fits).toBe(true);
  });

  test('Highlights at 150 brightens the highlights more than at 100', async ({ page }) => {
    await openPicture(page, ['#000000', '#ffffff', '#c0c0c0']);
    const at100 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'Tone', 'Highlights', '-100'), which: 'screen' });
    const at150 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'Tone', 'Highlights', '-150'), which: 'screen' });
    console.log(`Highlights: mean ${at100.mean.toFixed(2)} at −100, ${at150.mean.toFixed(2)} at −150`);
    expect(await recipeValue(page, 'tone.highlights')).toBe(-150);
    expect(at150.mean).toBeLessThan(at100.mean - 0.5);
  });

  test('Temperature runs to 200, warming more at each step past 100, and Tint to 200', async ({ page }) => {
    await openPicture(page, ['#606060', '#a0a0a0', '#808080']);
    const temperature = slider(page, 'White balance', 'Temperature');
    await expect(temperature).toHaveAttribute('min', '-200');
    await expect(temperature).toHaveAttribute('max', '200');
    const at100 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'White balance', 'Temperature', '100'), which: 'screen' });
    const at150 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'White balance', 'Temperature', '150'), which: 'screen' });
    const at200 = await imageStats(page, { kind: 'preview', index: await settleAt(page, 'White balance', 'Temperature', '200'), which: 'screen' });
    const warmth = (s: { red: number; blue: number }) => s.red - s.blue;
    console.log(`Temperature: red − blue ${warmth(at100).toFixed(2)} at 100, ${warmth(at150).toFixed(2)} at 150, ${warmth(at200).toFixed(2)} at 200`);
    expect(await recipeValue(page, 'whiteBalance.temperature')).toBe(200);
    expect(warmth(at150)).toBeGreaterThan(warmth(at100) + 3);
    expect(warmth(at200)).toBeGreaterThan(warmth(at150) + 1);
    // Past the end a typed value is held to it, and "−200" fits its box.
    await type(page, 'White balance', 'Temperature', '-999');
    const box = readout(page, 'White balance', 'Temperature');
    await expect(box).toHaveValue('−200');
    expect(await box.evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth)).toBe(true);
    await expect(slider(page, 'White balance', 'Tint')).toHaveAttribute('max', '200');
    await type(page, 'White balance', 'Tint', '260');
    await expect(readout(page, 'White balance', 'Tint')).toHaveValue('+200');
    expect(await recipeValue(page, 'whiteBalance.tint')).toBe(200);
  });

  test('Saturation at 150 saturates more than at 100, and stops at −100 below', async ({ page }) => {
    await openPicture(page);
    const saturation = slider(page, 'Color', 'Saturation');
    await expect(saturation).toHaveAttribute('min', '-100');
    await expect(saturation).toHaveAttribute('max', '150');
    const at100 = await previewChroma(page, await settleAt(page, 'Color', 'Saturation', '100'));
    const at150 = await previewChroma(page, await settleAt(page, 'Color', 'Saturation', '150'));
    console.log(`Saturation: chroma ${at100.toFixed(2)} at 100, ${at150.toFixed(2)} at 150`);
    expect(at150).toBeGreaterThan(at100 + 2);
    await type(page, 'Color', 'Saturation', '-150');
    await expect(readout(page, 'Color', 'Saturation')).toHaveValue('−100');
    expect(await recipeValue(page, 'color.saturation')).toBe(-100);
  });

  test('sliders whose end is a real one still stop at 100', async ({ page }) => {
    await openPicture(page);
    for (const [section, label] of [
      ['Finish', 'Vignette'],
      ['Finish', 'Feather'],
      ['Finish', 'Roughness'],
      ['Local contrast', 'Haze'],
      ['Sharpness & noise', 'Color noise'],
      ['Sharpness & noise', 'Keep detail'],
    ] as const) {
      await expect(slider(page, section, label), label).toHaveAttribute('max', '100');
      await type(page, section, label, '150');
      await expect(readout(page, section, label), label).toHaveValue(/^\+?100$/);
    }
    await expect(slider(page, 'Finish', 'Vignette')).toHaveAttribute('min', '-100');
    await type(page, 'Finish', 'Vignette', '-150');
    await expect(readout(page, 'Finish', 'Vignette')).toHaveValue('−100');
    // Haze adds to −150; Grain and Large details run to 150.
    await type(page, 'Local contrast', 'Haze', '-150');
    await expect(readout(page, 'Local contrast', 'Haze')).toHaveValue('−150');
    await expect(slider(page, 'Finish', 'Grain')).toHaveAttribute('max', '150');
    await expect(slider(page, 'Local contrast', 'Large details')).toHaveAttribute('min', '-100');
    await expect(slider(page, 'Local contrast', 'Large details')).toHaveAttribute('max', '150');
  });

  test("a mask's sliders run to 150, its Temperature and Tint to 200, and fit their boxes in a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openPicture(page);
    await page.getByRole('button', { name: 'Mask', exact: true }).click();
    await newMask(page, 'Radial');
    const group = page.getByRole('group', { name: 'Mask 1 adjustments' });
    await expect(group.getByRole('slider', { name: 'Contrast', exact: true })).toHaveAttribute('max', '150');
    await expect(group.getByRole('slider', { name: 'Saturation', exact: true })).toHaveAttribute('min', '-100');
    await expect(group.getByRole('slider', { name: 'Temperature', exact: true })).toHaveAttribute('max', '200');
    await expect(group.getByRole('slider', { name: 'Tint', exact: true })).toHaveAttribute('min', '-200');
    await setMaskValue(page, 'Mask 1', 'Temperature', '-200');
    const box = group.getByLabel('Temperature value', { exact: true });
    await expect(box).toHaveValue('−200');
    expect(await box.evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth)).toBe(true);
    await setMaskValue(page, 'Mask 1', 'Exposure', '9');
    await expect(group.getByLabel('Exposure value', { exact: true })).toHaveValue('+4.00');
    await expect(maskPanel(page)).toBeVisible();
  });

  test("the Edit panel's boxes fit three digits and a sign in a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openPicture(page);
    for (const [section, label] of [
      ['Tone', 'Shadows'],
      ['White balance', 'Tint'],
      ['Color', 'Vibrance'],
    ] as const) {
      await type(page, section, label, '-150');
      const box = readout(page, section, label);
      await expect(box).toHaveValue(label === 'Vibrance' ? '−100' : '−150');
      expect(await box.evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth), label).toBe(true);
    }
    // A click in a box selects the whole of a three-digit value, as it does a shorter one.
    const shadows = readout(page, 'Tone', 'Shadows');
    await shadows.click();
    await expect.poll(() => shadows.evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([0, 4]);
    await page.keyboard.type('120');
    await page.keyboard.press('Enter');
    await expect(shadows).toHaveValue('+120');
  });
});

const samples = process.env.LOPSY_RAF_SAMPLES;
/**
 * An X-E5 frame whose camera Tungsten preset is Temperature −124 from as
 * shot (measured with core/tests/raf_wb_presets.rs): ±100 cut it to −100.
 */
const TUNGSTEN_SAMPLE = 'DSCF8078.RAF';

/** An X-E5 frame shot under warm light (see the test that uses it). */
const WARM_SAMPLE = 'DSCF8169.RAF';

function tungstenSample(): string | null {
  if (!samples) return null;
  const path = join(samples, TUNGSTEN_SAMPLE);
  return existsSync(path) ? path : null;
}

test.describe('White balance presets past 100 on a RAF', () => {
  const sample = tungstenSample();
  test.skip(!sample, `Set LOPSY_RAF_SAMPLES to a directory holding ${TUNGSTEN_SAMPLE} to run this test`);
  test.setTimeout(10 * 60_000);

  test('Tungsten applies the camera’s own Temperature, past −100', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');
    await waitForReady(page, 120_000);
    const mode = page.getByLabel('White balance mode');
    await mode.selectOption({ label: 'Tungsten' });
    await expect(mode).toHaveValue('preset:tungsten');
    const wb = (await page.evaluate(() => window.__photosHarness?.recipe?.whiteBalance)) as { temperature: number; tint: number } | undefined;
    console.log(`${TUNGSTEN_SAMPLE} Tungsten: ${JSON.stringify(wb)}`);
    expect(wb?.temperature).toBeLessThan(-110);
    expect(wb?.temperature).toBeGreaterThan(-200);
    // The readout shows the preset's Kelvin, not the slider's end.
    await expect(page.getByLabel('Temperature value')).toHaveValue(/ K$/);
  });

  /**
   * A frame shot under warm light, whose Cloudy and Daylight Fluorescent
   * presets are Temperature +173 and +191 from as shot: ±150 cut both off.
   */
  test('presets past 150 apply the camera’s own Temperature, short of the end', async ({ page }) => {
    const warm = join(samples ?? '', WARM_SAMPLE);
    test.skip(!existsSync(warm), `Needs ${WARM_SAMPLE} in LOPSY_RAF_SAMPLES`);
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(warm);
    await waitForReady(page, 120_000);
    const mode = page.getByLabel('White balance mode');
    const chosen: number[] = [];
    for (const label of ['Cloudy', 'Fluorescent (daylight)']) {
      await mode.selectOption({ label });
      // The menu names the preset it applied: its values were not cut to another's.
      await expect.poll(() => mode.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.label)).toBe(label);
      const wb = (await page.evaluate(() => window.__photosHarness?.recipe?.whiteBalance)) as { temperature: number; tint: number } | undefined;
      console.log(`${WARM_SAMPLE} ${label}: ${JSON.stringify(wb)}`);
      expect(wb?.temperature).toBeGreaterThan(150);
      expect(wb?.temperature).toBeLessThan(200);
      chosen.push(wb?.temperature ?? 0);
    }
    expect(chosen[0]).not.toBe(chosen[1]);
  });
});
