/**
 * #1781 — Color Grading's Tone bar mode: stops on a fixed black-to-white
 * bar, each tinting the tones at its position with its colour, edited with
 * the colour picker below, plus a separate Blend slider. The compile step is
 * unit tested in src/filters/color-grading.test.ts; this covers the UI and
 * that the stops reach the shader.
 */
import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument, drawRect, getRootGroupId, addAdjustment } from './helpers';

interface Rgb { r: number; g: number; b: number }

const PATCHES = { dark: { x: 40, y: 100 }, mid: { x: 100, y: 100 }, bright: { x: 160, y: 100 } };

async function readAt(page: Page, point: { x: number; y: number }): Promise<Rgb> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) throw new Error('no composited pixels');
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } };
    };
    const state = store.getState();
    const sx = Math.round((x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2);
    const sy = Math.round((y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2);
    const idx = ((result.height - 1 - sy) * result.width + sx) * 4;
    return { r: result.pixels[idx] ?? -1, g: result.pixels[idx + 1] ?? -1, b: result.pixels[idx + 2] ?? -1 };
  }, point);
}

function expectGray(c: Rgb, v: number): void {
  for (const ch of [c.r, c.g, c.b]) expect(Math.abs(ch - v), JSON.stringify(c)).toBeLessThanOrEqual(3);
}

test.describe('Color Grading — Tone bar (#1781)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'adjustments panel not accessible on mobile');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);
    await drawRect(page, 20, 20, 40, 160, { r: 40, g: 40, b: 40, a: 1 });
    await drawRect(page, 80, 20, 40, 160, { r: 128, g: 128, b: 128, a: 1 });
    await drawRect(page, 140, 20, 40, 160, { r: 220, g: 220, b: 220, a: 1 });
    await page.waitForTimeout(200);
  });

  test('stops on the tone bar tint their tones; Wheels brings the wheels back', async ({ page }) => {
    await addAdjustment(page, await getRootGroupId(page), 'color-grading');
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer.getByRole('tab', { name: 'Wheels', exact: true })).toHaveAttribute('aria-selected', 'true');

    await drawer.getByRole('tab', { name: 'Tone bar', exact: true }).click();
    await expect(drawer.getByRole('group', { name: 'Tone bar — click to add stops' })).toBeVisible();
    await expect(drawer.getByRole('slider', { name: /color wheel/ })).toHaveCount(0);
    await expect(drawer.locator('[aria-label="Blend value"]')).toBeVisible();
    await expect(drawer.getByRole('slider', { name: /^Tone stop/ })).toHaveCount(2);

    // The new stops are the bar's own black and white: no change.
    expectGray(await readAt(page, PATCHES.dark), 40);
    expectGray(await readAt(page, PATCHES.bright), 220);

    // Make the shadow stop blue.
    await drawer.getByRole('slider', { name: 'Tone stop 1' }).click();
    const hex = drawer.getByLabel('Hex color', { exact: true });
    await hex.fill('0000ff');
    await hex.press('Enter');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/color-grading-tone-bar.png' });

    const dark = await readAt(page, PATCHES.dark);
    expect(dark.b - dark.r, JSON.stringify(dark)).toBeGreaterThan(15);
    const bright = await readAt(page, PATCHES.bright);
    expect(Math.abs(bright.b - bright.r), JSON.stringify(bright)).toBeLessThanOrEqual(6);

    // A click on the bar adds a stop.
    const bar = drawer.getByRole('group', { name: 'Tone bar — click to add stops' });
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect(drawer.getByRole('slider', { name: /^Tone stop/ })).toHaveCount(3);

    // Back to the wheels: neutral again.
    await drawer.getByRole('tab', { name: 'Wheels', exact: true }).click();
    await expect(drawer.getByRole('slider', { name: /color wheel/ })).toHaveCount(4);
    await page.waitForTimeout(300);
    expectGray(await readAt(page, PATCHES.dark), 40);
  });
});
