/**
 * The Color Grading group adjustment. The compile step is unit tested in
 * src/filters/color-grading.test.ts; these cover what only the real pipeline
 * can show: the wheels and sliders reach the shader, the tone masks isolate
 * each range, and the grade survives nodes that rebuild RGB.
 */

import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  drawRect,
  getRootGroupId,
  addAdjustment,
  openGroupEffectsPanel,
} from './helpers';

const DARK = 40;
const MID = 128;
const BRIGHT = 220;

const PATCHES = { dark: { x: 40, y: 100 }, mid: { x: 100, y: 100 }, bright: { x: 160, y: 100 } };

interface Rgb { r: number; g: number; b: number }

async function readAt(page: Page, point: { x: number; y: number }): Promise<Rgb> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) throw new Error('no composited pixels');
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round((x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2);
    const sy = Math.round((y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2);
    const idx = ((result.height - 1 - sy) * result.width + sx) * 4;
    return { r: result.pixels[idx] ?? -1, g: result.pixels[idx + 1] ?? -1, b: result.pixels[idx + 2] ?? -1 };
  }, point);
}

async function readPatches(page: Page): Promise<{ dark: Rgb; mid: Rgb; bright: Rgb }> {
  return {
    dark: await readAt(page, PATCHES.dark),
    mid: await readAt(page, PATCHES.mid),
    bright: await readAt(page, PATCHES.bright),
  };
}

function expectRgb(actual: Rgb, expected: Rgb, tolerance = 3): void {
  expect(Math.abs(actual.r - expected.r), `r: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g), `g: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b), `b: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`).toBeLessThanOrEqual(tolerance);
}

const gray = (v: number): Rgb => ({ r: v, g: v, b: v });

async function setSlider(page: Page, label: string, value: number): Promise<void> {
  const input = page.getByTestId('effects-drawer').locator(`[aria-label="${label} value"]`);
  await input.fill(String(value));
  await input.press('Enter');
  await page.waitForTimeout(100);
}

async function selectRange(page: Page, name: string): Promise<void> {
  await page.getByTestId('effects-drawer').getByRole('tab', { name, exact: true }).click();
}

function wheel(page: Page, name: string) {
  return page.getByRole('slider', { name: `${name} color wheel` });
}

test.describe('Color Grading adjustment', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'adjustments panel not accessible on mobile');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);
    await drawRect(page, 20, 20, 40, 160, { ...gray(DARK), a: 1 });
    await drawRect(page, 80, 20, 40, 160, { ...gray(MID), a: 1 });
    await drawRect(page, 140, 20, 40, 160, { ...gray(BRIGHT), a: 1 });
    await page.waitForTimeout(200);
  });

  test('the default node on the root group changes nothing until a wheel moves', async ({ page }) => {
    await openGroupEffectsPanel(page, await getRootGroupId(page));
    const row = page.getByTestId('effects-drawer').locator('div[class*="nodeRow"]', { hasText: 'Color Grading' });
    await expect(row).toHaveCount(1);
    await page.screenshot({ path: 'e2e/screenshots/color-grading-default-node.png' });

    let patches = await readPatches(page);
    expectRgb(patches.dark, gray(DARK), 1);
    expectRgb(patches.mid, gray(MID), 1);
    expectRgb(patches.bright, gray(BRIGHT), 1);

    await row.locator('[aria-label="Expand"]').click();
    await selectRange(page, 'Midtones');
    await setSlider(page, 'Hue', 240);
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);
    patches = await readPatches(page);
    expect(patches.mid.b).toBeGreaterThan(patches.mid.r + 10);
  });

  test('a new node changes nothing', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    await page.waitForTimeout(200);

    const { dark, mid, bright } = await readPatches(page);
    expectRgb(dark, gray(DARK), 1);
    expectRgb(mid, gray(MID), 1);
    expectRgb(bright, gray(BRIGHT), 1);
  });

  test('each range tints only its own tones, keeping luma', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading', { blending: 0 });

    // Teal at 50: the tint block is (-0.2, 0.054, 0.054) in unit space. Red
    // would land at -0.043, which the shader eases to 8 rather than clipping.
    await selectRange(page, 'Shadows');
    await setSlider(page, 'Hue', 180);
    await setSlider(page, 'Saturation', 50);
    await page.waitForTimeout(200);
    let patches = await readPatches(page);
    expectRgb(patches.dark, { r: 8, g: 54, b: 54 });
    expectRgb(patches.mid, gray(MID), 1);
    expectRgb(patches.bright, gray(BRIGHT), 1);

    // Blue at 25: mostly the blue channel (-0.008, -0.008, 0.1).
    await selectRange(page, 'Midtones');
    await setSlider(page, 'Hue', 240);
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);
    patches = await readPatches(page);
    expectRgb(patches.mid, { r: 126, g: 126, b: 154 });
    expectRgb(patches.dark, { r: 8, g: 54, b: 54 });
    expectRgb(patches.bright, gray(BRIGHT), 1);

    // Red at 25: (0.1, -0.027, -0.027), red easing in below the ceiling.
    await selectRange(page, 'Highlights');
    await setSlider(page, 'Hue', 0);
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);
    patches = await readPatches(page);
    expectRgb(patches.bright, { r: 242, g: 213, b: 213 });
    expectRgb(patches.mid, { r: 126, g: 126, b: 154 });
  });

  test('a strong tint eases into the channel limits on a ramp', async ({ page }) => {
    // Flat-then-steep is what shows up as a line across a smooth gradient.
    await page.locator('[data-tool-id="gradient"]').click();
    await page.keyboard.press('d');
    const start = await docToScreen(page, 0, 100);
    const end = await docToScreen(page, 200, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    await selectRange(page, 'Shadows');
    await setSlider(page, 'Hue', 180);
    await setSlider(page, 'Saturation', 70);
    await page.waitForTimeout(200);

    const red: number[] = [];
    for (let x = 4; x <= 100; x += 4) red.push((await readAt(page, { x, y: 100 })).r);
    expect(red[0], red.join()).toBeGreaterThan(0);
    for (let i = 1; i < red.length; i++) {
      expect(red[i]!, red.join()).toBeGreaterThanOrEqual(red[i - 1]! - 1);
    }
    const flatSteps = red.slice(1).filter((v, i) => v === red[i]).length;
    expect(flatSteps, red.join()).toBeLessThan(red.length / 2);
  });

  test('Global applies to every tone', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    await selectRange(page, 'Global');
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);

    const { dark, mid, bright } = await readPatches(page);
    expectRgb(dark, { r: DARK + 26, g: DARK - 7, b: DARK - 7 });
    expectRgb(mid, { r: MID + 26, g: MID - 7, b: MID - 7 });
    expectRgb(bright, { r: 242, g: BRIGHT - 7, b: BRIGHT - 7 });
  });

  test('Luminance moves brightness without adding color', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading', { blending: 0 });
    await selectRange(page, 'Highlights');
    await setSlider(page, 'Luminance', -20);
    await page.waitForTimeout(200);

    const { mid, bright } = await readPatches(page);
    expectRgb(bright, gray(BRIGHT - 26));
    expectRgb(mid, gray(MID), 1);
  });

  test('Balance moves a tone between ranges', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading', { blending: 0 });
    await selectRange(page, 'Highlights');
    await setSlider(page, 'Luminance', 20);
    await page.waitForTimeout(200);
    expectRgb((await readPatches(page)).mid, gray(MID), 1);

    // Exponent 0.25 puts mid gray at tone 0.84, well inside the highlights.
    await setSlider(page, 'Balance', 100);
    await page.waitForTimeout(200);
    expectRgb((await readPatches(page)).mid, gray(MID + 26));
  });

  test('Blending spreads a range into its neighbor', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading', { blending: 0 });
    await selectRange(page, 'Shadows');
    await setSlider(page, 'Luminance', 40);
    await page.waitForTimeout(200);
    expectRgb((await readPatches(page)).mid, gray(MID), 1);

    await setSlider(page, 'Blending', 100);
    await page.waitForTimeout(200);
    const { r } = (await readPatches(page)).mid;
    expect(r).toBeGreaterThan(MID + 3);
  });

  test('dragging a wheel grades the canvas and undoes as one step', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    const box = await wheel(page, 'Global').boundingBox();
    if (!box) throw new Error('wheel not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Toward 3 o'clock, hue 0: red up, the others down.
    await page.mouse.move(cx + 2, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.1, cy, { steps: 3 });
    await page.mouse.move(cx + box.width * 0.2, cy, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const graded = await readAt(page, PATCHES.mid);
    expect(graded.r).toBeGreaterThan(MID + 10);
    expect(graded.b).toBeLessThan(MID);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expectRgb(await readAt(page, PATCHES.mid), gray(MID), 1);
  });

  test('double-clicking a wheel returns it to neutral', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    const target = wheel(page, 'Global');
    const box = await target.boundingBox();
    if (!box) throw new Error('wheel not visible');
    await target.click({ position: { x: box.width * 0.8, y: box.height / 2 } });
    await page.waitForTimeout(200);
    expect((await readAt(page, PATCHES.mid)).r).toBeGreaterThan(MID + 10);

    await target.dblclick({ position: { x: box.width * 0.8, y: box.height / 2 } });
    await page.waitForTimeout(200);
    expectRgb(await readAt(page, PATCHES.mid), gray(MID), 1);
  });

  test('double-clicking a wheel keeps its hue and undoes in one step (#1455)', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading', { blending: 0 });
    await selectRange(page, 'Shadows');
    await setSlider(page, 'Hue', 220);
    await setSlider(page, 'Saturation', 40);
    const drawer = page.getByTestId('effects-drawer');
    const hueInput = drawer.locator('[aria-label="Hue value"]');
    const saturationInput = drawer.locator('[aria-label="Saturation value"]');
    await expect(hueInput).toHaveValue('220');
    await expect(saturationInput).toHaveValue('40');

    const undoDepth = () => page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undoStack: unknown[] };
      };
      return store.getState().undoStack.length;
    });
    const before = await undoDepth();

    // The centre, the obvious place to aim for a reset.
    const target = wheel(page, 'Shadows');
    const box = await target.boundingBox();
    if (!box) throw new Error('wheel not visible');
    await target.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(200);
    await expect(saturationInput).toHaveValue('0');
    await expect(hueInput).toHaveValue('220');
    expect(await undoDepth()).toBe(before + 1);

    // Off-centre, where each press would otherwise move the hue.
    await setSlider(page, 'Saturation', 40);
    await target.dblclick({ position: { x: box.width * 0.9, y: box.height / 2 } });
    await page.waitForTimeout(200);
    await expect(saturationInput).toHaveValue('0');
    await expect(hueInput).toHaveValue('220');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expect(saturationInput).toHaveValue('40');
    await expect(hueInput).toHaveValue('220');
    // The dark patch is blue again, so the restored grade reached the shader.
    const dark = await readAt(page, PATCHES.dark);
    expect(dark.b).toBeGreaterThan(dark.r + 10);
  });

  test('arrow keys on a focused wheel grade instead of nudging the layer', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    await page.keyboard.press('v');
    await wheel(page, 'Global').focus();
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(200);

    const saturationInput = page.getByTestId('effects-drawer').locator('[aria-label="Saturation value"]');
    await expect(saturationInput).toHaveValue('20');
    await expect(page.getByTestId('effects-drawer').locator('[aria-label="Hue value"]')).toHaveValue(/^350/);

    // A nudge would have moved the patch's left edge across this column.
    expect((await readAt(page, { x: 21, y: 100 })).r).toBeLessThan(MID);
    expect((await readAt(page, { x: 18, y: 100 })).r).toBeGreaterThan(MID);
  });

  test('tints a Black & White stack instead of being discarded', async ({ page }) => {
    const root = await getRootGroupId(page);
    await addAdjustment(page, root, 'black-white');
    await addAdjustment(page, root, 'color-grading');
    await selectRange(page, 'Global');
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);

    const { r, g, b } = await readAt(page, PATCHES.mid);
    expect(r - g).toBeGreaterThan(20);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  });

  test('PNG export matches the live grade', async ({ page }) => {
    // In-gamut on purpose: export converts a Display P3 document to sRGB, so
    // a color near the P3 boundary legitimately reads differently in the PNG.
    await addAdjustment(page, await getRootGroupId(page), 'color-grading', { blending: 0 });
    await selectRange(page, 'Midtones');
    await setSlider(page, 'Hue', 240);
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);
    const live = await readAt(page, PATCHES.mid);
    expectRgb(live, { r: 126, g: 126, b: 154 });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Quick Export PNG' }).click();
    const download = await downloadPromise;
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    const exported = await page.evaluate(async ({ base64, x, y }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const [r = -1, g = -1, b = -1] = ctx.getImageData(x, y, 1, 1).data;
      return { r, g, b };
    }, { base64: Buffer.concat(chunks).toString('base64'), ...PATCHES.mid });
    expectRgb(exported, live, 4);
  });

  test('disabling the node removes the grade', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    await selectRange(page, 'Global');
    await setSlider(page, 'Saturation', 25);
    await page.waitForTimeout(200);
    expect((await readAt(page, PATCHES.mid)).r).toBeGreaterThan(MID + 10);

    await page.getByTestId('effects-drawer').locator('[aria-label="Disable node"]').last().click();
    await page.waitForTimeout(200);
    expectRgb(await readAt(page, PATCHES.mid), gray(MID), 1);
  });
});
