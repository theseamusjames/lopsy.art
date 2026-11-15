import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, getEditorState, docToScreen } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

const W = 240;
const H = 160;
const GREY = 128;

interface RegionStats {
  meanR: number;
  stdR: number;
  /** Mean |p(x+1) - p(x)| of the red channel: change along a row. */
  rowStep: number;
  /** Mean |p(y+1) - p(y)| of the red channel: change down a column. */
  colStep: number;
  /** Largest |r - g| or |g - b| seen: 0 for a grey (mono) texture. */
  maxChroma: number;
  minAlpha: number;
  /** Red channel of every pixel, for exact comparisons between runs. */
  reds: number[];
}

async function activeLayerId(page: Page): Promise<string> {
  const state = await getEditorState(page);
  return state.document.activeLayerId as string;
}

async function regionStats(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<RegionStats> {
  const layerId = await activeLayerId(page);
  return page.evaluate(
    async ({ layerId, x0, y0, x1, y1 }) => {
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id: string,
      ) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, pixels } = await read(layerId);
      const at = (x: number, y: number, c: number) => pixels[(y * width + x) * 4 + c]!;
      const reds: number[] = [];
      let sum = 0;
      let sumSq = 0;
      let rowStep = 0;
      let colStep = 0;
      let maxChroma = 0;
      let minAlpha = 255;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const r = at(x, y, 0);
          reds.push(r);
          sum += r;
          sumSq += r * r;
          rowStep += Math.abs(at(x + 1, y, 0) - r);
          colStep += Math.abs(at(x, y + 1, 0) - r);
          maxChroma = Math.max(maxChroma, Math.abs(r - at(x, y, 1)), Math.abs(at(x, y, 1) - at(x, y, 2)));
          minAlpha = Math.min(minAlpha, at(x, y, 3));
        }
      }
      const n = reds.length;
      const mean = sum / n;
      return {
        meanR: mean,
        stdR: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
        rowStep: rowStep / n,
        colStep: colStep / n,
        maxChroma,
        minAlpha,
        reds,
      };
    },
    { layerId, x0, y0, x1, y1 },
  );
}

/** Opens Filter → Texture..., sets toggles and sliders like a user, applies. */
async function runTexture(page: Page, toggles: string[], sliders: Record<string, number>): Promise<void> {
  await page.click('text=Filter');
  await page.getByRole('menuitem', { name: 'Texture...' }).click();
  const modal = page.getByRole('dialog', { name: 'Texture' });
  await expect(modal).toBeVisible();
  for (const label of toggles) {
    await modal.getByRole('button', { name: label, exact: true }).click();
  }
  for (const [label, value] of Object.entries(sliders)) {
    const slider = modal.locator(`text="${label}"`).locator('..').locator('input[type="range"]');
    await slider.fill(String(value));
  }
  await modal.getByRole('button', { name: 'Apply' }).click();
  await expect(modal).toBeHidden();
  await page.waitForTimeout(200);
}

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// Probe away from the texture edge so the +1 neighbour reads stay inside.
const INNER = [10, 10, W - 10, H - 10] as const;

test.describe('Texture filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, W, H, false);
    await drawRect(page, 0, 0, W, H, { r: GREY, g: GREY, b: GREY });
  });

  test('streaks follow the angle, are deterministic per seed, and undo cleanly', async ({ page }) => {
    const before = await regionStats(page, ...INNER);
    expect(before.stdR).toBeLessThan(0.5);
    expect(Math.round(before.meanR)).toBe(GREY);

    const settings = { Amount: 70, Size: 3, Stretch: 4, Angle: 0, Seed: 42 };
    await runTexture(page, ['Streaks'], settings);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'texture-streaks.png') });

    const first = await regionStats(page, ...INNER);
    // Texture is present: the flat grey now varies.
    expect(first.stdR).toBeGreaterThan(8);
    // Light & Dark is zero-centred, so the average stays near the grey.
    expect(Math.abs(first.meanR - GREY)).toBeLessThan(12);
    // Angle 0 lays the streaks along rows: neighbours along a row are far
    // more alike than neighbours down a column.
    expect(first.rowStep * 3).toBeLessThan(first.colStep);
    // Mono by default: every pixel stays grey. Alpha is untouched.
    expect(first.maxChroma).toBeLessThanOrEqual(2);
    expect(first.minAlpha).toBe(255);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await regionStats(page, ...INNER);
    expect(undone.stdR).toBeLessThan(0.5);
    expect(Math.round(undone.meanR)).toBe(GREY);

    // Same settings and seed reproduce the texture pixel for pixel.
    await runTexture(page, ['Streaks'], settings);
    const second = await regionStats(page, ...INNER);
    expect(second.reds).toEqual(first.reds);

    // A different seed gives a different texture of the same character.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await runTexture(page, ['Streaks'], { ...settings, Seed: 43 });
    const reseeded = await regionStats(page, ...INNER);
    const differing = reseeded.reds.filter((r, i) => Math.abs(r - first.reds[i]!) > 4).length;
    expect(differing).toBeGreaterThan(first.reds.length / 4);
    expect(reseeded.rowStep * 3).toBeLessThan(reseeded.colStep);
  });

  test('rotating the angle turns the streaks to run down columns', async ({ page }) => {
    await runTexture(page, ['Streaks'], { Amount: 70, Size: 3, Angle: 90, Seed: 5 });
    const s = await regionStats(page, ...INNER);
    expect(s.stdR).toBeGreaterThan(8);
    expect(s.colStep * 3).toBeLessThan(s.rowStep);
  });

  test('colored cells in relief stay inside the selection', async ({ page }) => {
    // Select the left half only.
    await dragMarquee(page, 0, 0, W / 2, H);
    await runTexture(page, ['Cells', 'Relief', 'Colored'], { Amount: 80, Size: 12, Seed: 3 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'texture-cells-relief-selection.png') });

    const inside = await regionStats(page, 10, 10, W / 2 - 10, H - 10);
    expect(inside.stdR).toBeGreaterThan(5);
    // Colored runs the pattern per channel, so channels disagree.
    expect(inside.maxChroma).toBeGreaterThan(20);

    const outside = await regionStats(page, W / 2 + 10, 10, W - 10, H - 10);
    expect(outside.stdR).toBeLessThan(0.5);
    expect(Math.round(outside.meanR)).toBe(GREY);
    expect(outside.maxChroma).toBe(0);
  });

  test('Lighten never darkens and Darken never lightens', async ({ page }) => {
    await runTexture(page, ['Rough', 'Lighten'], { Amount: 60, Size: 6, Seed: 9 });
    const light = await regionStats(page, ...INNER);
    expect(light.stdR).toBeGreaterThan(4);
    expect(Math.min(...light.reds)).toBeGreaterThanOrEqual(GREY - 1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await runTexture(page, ['Canvas', 'Darken'], { Amount: 60, Size: 6, Seed: 9 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'texture-canvas-darken.png') });
    const dark = await regionStats(page, ...INNER);
    expect(dark.stdR).toBeGreaterThan(4);
    expect(Math.max(...dark.reds)).toBeLessThanOrEqual(GREY + 1);
  });
});
