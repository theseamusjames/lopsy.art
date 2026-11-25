import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './test';
import { imageStats, openGeneratedImage, openHarness, settledPreview, waitForPreview, waitForReady } from './harness';

/**
 * Tone, colour and curves in the engine's linear working space
 * (docs/photonamous-linear-plan.md, Phases 3 to 5): each slider moves the
 * picture the way its name says, in the screen preview and in the 8-bit
 * export, and Highlights brings a region at white back below it on a real
 * RAF. The RAF test needs LOPSY_RAF_SAMPLES (github.com/theseamusjames/sample-raf-images).
 */

type Source = { readonly kind: 'preview'; readonly index: number } | { readonly kind: 'export'; readonly index: number };

/** The 5th, 25th, 50th, 75th and 95th percentiles of luminance (0..255) of a recorded preview or export, decoded in the page. */
async function lumaPercentiles(page: Page, source: Source): Promise<{ p5: number; p25: number; p50: number; p75: number; p95: number }> {
  return page.evaluate(async (src) => {
    const record = window.__photosHarness;
    const blob = src.kind === 'preview' ? record?.previews[src.index]?.screen : record?.exports[src.index]?.blob;
    if (!blob) throw new Error(`no ${src.kind} ${src.index}`);
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const bins = new Array<number>(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const y = Math.round(0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0));
      bins[y] = (bins[y] ?? 0) + 1;
    }
    const total = data.length / 4;
    const at = (q: number) => {
      let seen = 0;
      for (let v = 0; v < 256; v++) {
        seen += bins[v] ?? 0;
        if (seen >= q * total) return v;
      }
      return 255;
    };
    return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
  }, source);
}

/** How far the pixels are from grey: the mean of max(|R−G|, |G−B|, |R−B|) over every pixel. */
async function meanChroma(page: Page, exportIndex: number): Promise<number> {
  return page.evaluate(async (index) => {
    const blob = window.__photosHarness?.exports[index]?.blob;
    if (!blob) throw new Error(`no export ${index}`);
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
  }, exportIndex);
}

/**
 * Mean luminance (0..255) of each cell of a `cols` × `rows` grid of a
 * recorded preview or export, row by row. The browser resamples the decode
 * down to the grid, so a full-size export is never held as pixels.
 */
async function cellMeans(page: Page, source: Source, cols: number, rows: number): Promise<number[]> {
  return page.evaluate(
    async ({ src, cols, rows }) => {
      const record = window.__photosHarness;
      const blob = src.kind === 'preview' ? record?.previews[src.index]?.screen : record?.exports[src.index]?.blob;
      if (!blob) throw new Error(`no ${src.kind} ${src.index}`);
      // Down in steps of at most 4× so each grid pixel is an average of its cell.
      const full = await createImageBitmap(blob);
      let w = full.width;
      let h = full.height;
      let image: ImageBitmap = full;
      while (w > cols * 4 || h > rows * 4) {
        w = Math.max(cols, Math.ceil(w / 4));
        h = Math.max(rows, Math.ceil(h / 4));
        const next = await createImageBitmap(image, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
        image.close();
        image = next;
      }
      const grid = await createImageBitmap(image, { resizeWidth: cols, resizeHeight: rows, resizeQuality: 'high' });
      const canvas = new OffscreenCanvas(cols, rows);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(grid, 0, 0);
      const data = ctx.getImageData(0, 0, cols, rows).data;
      const out: number[] = [];
      for (let i = 0; i < data.length; i += 4) out.push(0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0));
      return out;
    },
    { src: source, cols, rows },
  );
}

async function setTone(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByTestId('edit-panel').getByRole('region', { name: label === 'Saturation' ? 'Color' : 'Tone', exact: true }).getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}

async function exportJpeg(page: Page, timeout = 60_000): Promise<number> {
  const count = await page.evaluate(() => window.__photosHarness?.exports.length ?? 0);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction((n) => (window.__photosHarness?.exports.length ?? 0) > n, count, { timeout });
  return count;
}

/**
 * A generated JPEG (a gradient with a grey block), loaded, with its first
 * preview: answers that preview's percentiles. `fullRange`: black to white,
 * for the sliders that act at the ends.
 */
async function openGradient(page: Page, fullRange = false): Promise<Awaited<ReturnType<typeof lumaPercentiles>>> {
  await openHarness(page);
  await openGeneratedImage(page, 640, 480, 'image/jpeg', fullRange ? ['#000000', '#ffffff', '#808080'] : undefined);
  await waitForReady(page);
  await waitForPreview(page, 0);
  return lumaPercentiles(page, { kind: 'preview', index: 0 });
}

test.describe('Tone sliders move the histogram the way they say', () => {
  test('Contrast spreads the tones apart', async ({ page }) => {
    const before = await openGradient(page);
    await setTone(page, 'Contrast', '60');
    const after = await lumaPercentiles(page, { kind: 'preview', index: await settledPreview(page, 0) });
    expect(after.p95 - after.p5).toBeGreaterThan(before.p95 - before.p5 + 8);
  });

  test('Whites raise the bright end', async ({ page }) => {
    const before = await openGradient(page, true);
    await setTone(page, 'Whites', '60');
    const after = await lumaPercentiles(page, { kind: 'preview', index: await settledPreview(page, 0) });
    expect(after.p95).toBeGreaterThan(before.p95 + 3);
  });

  test('Blacks lowered darken the dark end', async ({ page }) => {
    const before = await openGradient(page, true);
    await setTone(page, 'Blacks', '-60');
    const after = await lumaPercentiles(page, { kind: 'preview', index: await settledPreview(page, 0) });
    expect(after.p5).toBeLessThan(before.p5 - 3);
  });

  test('Shadows raised lift the dark tones', async ({ page }) => {
    const before = await openGradient(page);
    await setTone(page, 'Shadows', '60');
    const after = await lumaPercentiles(page, { kind: 'preview', index: await settledPreview(page, 0) });
    expect(after.p25).toBeGreaterThan(before.p25 + 4);
  });
});

test('Saturation −100 exports a grey picture', async ({ page }) => {
  await openGradient(page);
  const colourful = await meanChroma(page, await exportJpeg(page));
  expect(colourful).toBeGreaterThan(20);
  await setTone(page, 'Saturation', '-100');
  await settledPreview(page, 0);
  // JPEG's chroma rounding leaves a step or two.
  expect(await meanChroma(page, await exportJpeg(page))).toBeLessThan(2.5);
});

test('a curve with its midpoint raised brightens the midtones of the export', async ({ page }) => {
  await openGradient(page);
  const before = await imageStats(page, { kind: 'export', index: await exportJpeg(page), half: 'centre' });
  const curve = page.getByRole('group', { name: 'Luminance curve' });
  await curve.scrollIntoViewIfNeeded();
  const box = await curve.boundingBox();
  if (!box) throw new Error('no curve editor');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.up();
  await settledPreview(page, 0);
  // The centre is the generated image's mid-grey block.
  const after = await imageStats(page, { kind: 'export', index: await exportJpeg(page), half: 'centre' });
  expect(after.mean).toBeGreaterThan(before.mean + 10);
});

/** Presses Auto in the Tone group and answers Exposure once it has settled. */
async function pressAutoTone(page: Page): Promise<number> {
  const steps = async () => (await page.evaluate(() => window.__photosHarness?.steps.length)) ?? 0;
  const before = await steps();
  await page.getByTestId('edit-panel').getByRole('button', { name: 'Auto Tone' }).click();
  // A press that changes nothing makes no step; one that does makes exactly one.
  await page.waitForTimeout(2000);
  expect(await steps()).toBeLessThanOrEqual(before + 1);
  return Number((await page.getByLabel('Exposure value').inputValue()).replace('\u2212', '-'));
}

test('Auto tone raises Exposure on a dark photo as one step, and on a second press changes little', async ({ page }) => {
  await openHarness(page);
  // About two stops under middle grey: well within what one press may move (up to 4 EV).
  await openGeneratedImage(page, 640, 480, 'image/jpeg', ['#2a2a2a', '#5a4838', '#404040']);
  await waitForReady(page);
  await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');

  const first = await pressAutoTone(page);
  expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Auto tone']);
  expect(first).toBeGreaterThan(0.5);
  const second = await pressAutoTone(page);
  console.log(`Auto tone: ${first} then ${second}`);
  expect(Math.abs(second - first)).toBeLessThan(0.25);
});

test('Auto tone brings a photo about three stops dark up in one press, and a second press barely moves it', async ({ page }) => {
  await openHarness(page);
  // About three stops under middle grey: beyond the two stops one press used to reach, within the four it reaches now.
  await openGeneratedImage(page, 640, 480, 'image/jpeg', ['#1e1e1e', '#3a2e24', '#2a2a2a']);
  await waitForReady(page);
  await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');

  const first = await pressAutoTone(page);
  expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['Auto tone']);
  const second = await pressAutoTone(page);
  console.log(`Auto tone, three stops dark: ${first} then ${second}`);
  expect(first).toBeGreaterThan(2.2);
  expect(Math.abs(second - first)).toBeLessThan(0.1);
});

const samples = process.env.LOPSY_RAF_SAMPLES;
/** A frame whose default rendering has a large bright window at white (measured: its brightest cells are 251..255). */
const BRIGHT_SAMPLE = 'DSCF8005.RAF';

function brightSample(): string | null {
  if (!samples) return null;
  const path = join(samples, BRIGHT_SAMPLE);
  return existsSync(path) ? path : null;
}

test.describe('Highlights on a RAF', () => {
  const sample = brightSample();
  test.skip(!sample, `Set LOPSY_RAF_SAMPLES to a directory holding ${BRIGHT_SAMPLE} to run this test`);
  test.setTimeout(15 * 60_000);

  test('Highlights −100 brings a region at white clearly below white, in the preview and the export', async ({ page }) => {
    const COLS = 32;
    const ROWS = 24;
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');
    await waitForReady(page, 120_000);
    await waitForPreview(page, 0, 5 * 60_000);
    const first = await settledPreview(page, 0);
    const before = await cellMeans(page, { kind: 'preview', index: first }, COLS, ROWS);
    // The brightest cell of the default rendering is the one to bring back.
    const brightest = before.reduce((best, v, i) => (v > (before[best] ?? 0) ? i : best), 0);
    const at = before[brightest] ?? 0;
    console.log(`${BRIGHT_SAMPLE}: brightest cell ${brightest} at ${at.toFixed(1)}; top ten ${[...before].sort((a, b) => b - a).slice(0, 10).map((v) => v.toFixed(0)).join(' ')}`);
    expect(at, 'the sample has a region at or near white').toBeGreaterThan(245);
    const exportBefore = await cellMeans(page, { kind: 'export', index: await exportJpeg(page, 10 * 60_000) }, COLS, ROWS);
    expect(exportBefore[brightest] ?? 0).toBeGreaterThan(245);

    const count = await page.evaluate(() => window.__photosHarness?.previews.length ?? 0);
    await setTone(page, 'Highlights', '-100');
    const after = await cellMeans(page, { kind: 'preview', index: await settledPreview(page, count) }, COLS, ROWS);
    const exportAfter = await cellMeans(page, { kind: 'export', index: await exportJpeg(page, 10 * 60_000) }, COLS, ROWS);
    console.log(`after Highlights −100: preview ${(after[brightest] ?? 0).toFixed(1)}, export ${(exportAfter[brightest] ?? 0).toFixed(1)}`);
    expect(after[brightest] ?? 255).toBeLessThan(at - 15);
    expect(exportAfter[brightest] ?? 255).toBeLessThan((exportBefore[brightest] ?? 0) - 15);
  });
});
