import { test, expect, type Page } from '@playwright/test';
import { getEditorState } from './helpers';
import { buildSyntheticRaf } from './synthetic-raf';

/**
 * RAF import decodes on a pool of workers, each rendering row bands of the
 * frame that are uploaded into the layer texture as they finish. These
 * tests open a synthetic RAF (a neutral gray ramp, brighter to the sensor's
 * right and, more gently, towards its bottom) through File → Open and
 * check that every band landed, in the right place and orientation.
 */

const SENSOR_W = 1500;
const SENSOR_H = 1000;

interface LayerProfile {
  width: number;
  height: number;
  /** Mean (R+G+B)/3 per image row, 0–255. */
  rowMeans: number[];
  /** Mean (R+G+B)/3 per image column, 0–255. */
  colMeans: number[];
  /** Pixels darker than any part of the ramp: gaps no band covered. */
  darkPixels: number;
}

async function openRaf(page: Page, orientation: number): Promise<void> {
  // Pin the pool size so the frame is cut into the same bands everywhere.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  });
  await page.goto('/');
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open File")'),
  ]);
  await chooser.setFiles({
    name: `ramp-o${orientation}.raf`,
    mimeType: 'application/octet-stream',
    buffer: buildSyntheticRaf({ width: SENSOR_W, height: SENSOR_H, orientation }),
  });
  await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 30000 });
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][aria-label*="Opening"]'),
    { timeout: 120000 },
  );
}

async function readLayerProfile(page: Page): Promise<LayerProfile> {
  return page.evaluate(async () => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      () => Promise<{ width: number; height: number; pixels: ArrayLike<number> } | null>;
    const layer = await read();
    if (!layer) throw new Error('no layer pixels');
    const { width, height, pixels } = layer;
    const rowSums = new Array<number>(height).fill(0);
    const colSums = new Array<number>(width).fill(0);
    let darkPixels = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
        rowSums[y] = (rowSums[y] ?? 0) + v;
        colSums[x] = (colSums[x] ?? 0) + v;
        if (v < 20) darkPixels++;
      }
    }
    return {
      width,
      height,
      rowMeans: rowSums.map((s) => s / width),
      colMeans: colSums.map((s) => s / height),
      darkPixels,
    };
  });
}

/**
 * Largest jump between neighbouring lines of a profile, ignoring the frame
 * edges. A band uploaded to the wrong place, or not at all, breaks the ramp
 * with a step far larger than its per-line slope.
 */
function largestStep(profile: number[]): number {
  let max = 0;
  for (let i = 10; i < profile.length - 10; i++) {
    max = Math.max(max, Math.abs((profile[i] ?? 0) - (profile[i - 1] ?? 0)));
  }
  return max;
}

function first(profile: number[]): number {
  return profile[10] ?? 0;
}

function last(profile: number[]): number {
  return profile[profile.length - 11] ?? 0;
}

test.describe('RAF banded import', () => {
  test.setTimeout(180000);

  test('upright frame: every band lands, ramp runs left→right', async ({ page }) => {
    await openRaf(page, 1);
    await page.screenshot({ path: 'e2e/screenshots/raf-banded-import-upright.png' });

    const state = await getEditorState(page);
    expect([state.document.width, state.document.height]).toEqual([SENSOR_W, SENSOR_H]);

    const p = await readLayerProfile(page);
    expect([p.width, p.height]).toEqual([SENSOR_W, SENSOR_H]);
    expect(p.darkPixels).toBe(0);
    // Sensor x is the steep axis: dark on the left, bright on the right.
    expect(last(p.colMeans) - first(p.colMeans)).toBeGreaterThan(80);
    // Sensor y (the axis the bands are cut along) brightens gently downward…
    expect(last(p.rowMeans) - first(p.rowMeans)).toBeGreaterThan(10);
    // …without a step anywhere, so no band is missing or misplaced.
    expect(largestStep(p.rowMeans)).toBeLessThan(1.5);
    expect(largestStep(p.colMeans)).toBeLessThan(1.5);

    // The layer thumbnail is read back once the bands are in, so it shows
    // the ramp (dark left edge, bright right edge), not the empty
    // placeholder it was created with.
    const thumbnail = page.locator(`[data-layer-id="${state.document.activeLayerId}"] canvas`);
    await expect.poll(async () => thumbnail.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d');
      if (!ctx || c.width === 0) return 0;
      const mid = Math.floor(c.height / 2);
      const left = ctx.getImageData(1, mid, 1, 1).data;
      const right = ctx.getImageData(c.width - 2, mid, 1, 1).data;
      return (right[0] ?? 0) - (left[0] ?? 0);
    }), { timeout: 10000 }).toBeGreaterThan(40);
  });

  test('EXIF orientation 6: bands are rotated into place', async ({ page }) => {
    await openRaf(page, 6);
    await page.screenshot({ path: 'e2e/screenshots/raf-banded-import-rotated.png' });

    const state = await getEditorState(page);
    expect([state.document.width, state.document.height]).toEqual([SENSOR_H, SENSOR_W]);

    const p = await readLayerProfile(page);
    expect([p.width, p.height]).toEqual([SENSOR_H, SENSOR_W]);
    expect(p.darkPixels).toBe(0);
    // Rotated 90° clockwise: sensor x now runs top→bottom (steep)…
    expect(last(p.rowMeans) - first(p.rowMeans)).toBeGreaterThan(80);
    // …and sensor y runs right→left, so the bands are now columns and the
    // image brightens gently towards the left.
    expect(first(p.colMeans) - last(p.colMeans)).toBeGreaterThan(10);
    expect(largestStep(p.colMeans)).toBeLessThan(1.5);
    expect(largestStep(p.rowMeans)).toBeLessThan(1.5);
  });
});
