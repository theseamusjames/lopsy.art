import type { Locator } from '@playwright/test';
import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, getPixelAt, waitForStore } from './helpers';

// #1023: with no selection a Gradient drag replaced the whole layer, so a
// second fade wiped the first one even where its stops were fully
// transparent. With a selection the same drag composited "over" the
// existing pixels. Both cases must composite over.

type Edge = 'min' | 'max' | 'mid';

/**
 * Press inside a picker slider and drag 3 px past the given edges so the
 * handler clamps to exactly 0 or 1. The release stays inside the modal: a
 * mouseup on the overlay would count as an overlay click and close it.
 */
async function dragSlider(page: Page, slider: Locator, ex: Edge, ey: Edge): Promise<void> {
  const box = await slider.boundingBox();
  if (!box) throw new Error('slider not visible');
  const at = (start: number, size: number, edge: Edge): number =>
    edge === 'min' ? start - 3 : edge === 'max' ? start + size + 3 : start + size / 2;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(at(box.x, box.width, ex), at(box.y, box.height, ey), { steps: 3 });
  await page.mouse.up();
}

async function pickRedWithOpacity(page: Page, dlg: Locator, isOpaque: boolean): Promise<void> {
  await dragSlider(page, dlg.locator('[aria-label="Saturation and brightness"]'), 'max', 'min');
  await dragSlider(page, dlg.locator('[aria-label="Hue"]'), 'min', 'mid');
  await dragSlider(page, dlg.locator('[aria-label="Opacity"]'), isOpaque ? 'max' : 'min', 'mid');
}

/** Red at 100% opacity fading to the same red at 0%, set through the Gradient Editor. */
async function setRedFadeGradient(page: Page, type: 'linear' | 'radial'): Promise<void> {
  await page.locator('[data-tool-id="gradient"]').click();
  await page.locator('[aria-labelledby="gradient-type-label"]').selectOption(type);
  await page.getByTestId('gradient-advanced-btn').click();
  const dlg = page.locator('[role="dialog"][aria-label="Gradient Editor"]');
  await dlg.waitFor({ state: 'visible' });
  await dlg.getByTestId('gradient-stop-0').click();
  await pickRedWithOpacity(page, dlg, true);
  await dlg.getByTestId('gradient-stop-1').click();
  await pickRedWithOpacity(page, dlg, false);
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(dlg).toBeHidden();
}

async function dragGradient(page: Page, points: Array<[number, number]>): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  const a = await docToScreen(page, first[0], first[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const [x, y] of rest) {
    const p = await docToScreen(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 8 });
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe('Gradient composites over existing pixels without a selection (#1023)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('a second linear fade keeps the first one', async ({ page }) => {
    const layerId = await addLayer(page);
    await setRedFadeGradient(page, 'linear');

    await dragGradient(page, [[0, 200], [250, 200]]);
    const firstFade = await getPixelAt(page, 10, 200, layerId);
    expect(firstFade.a).toBeGreaterThan(235);

    // Overshoot to x=100 and come back: the live preview must restore the
    // pre-drag pixels each frame instead of piling up intermediate frames.
    await dragGradient(page, [[600, 200], [100, 200], [350, 200]]);
    await page.screenshot({ path: 'e2e/screenshots/gradient-composite-no-selection-linear.png' });

    // Left edge: the first fade (t = 0.04 → alpha ≈ 245) survives under the
    // second gradient's fully transparent end.
    const left = await getPixelAt(page, 10, 200, layerId);
    expect(left.a).toBeGreaterThan(235);
    expect(left.r).toBeGreaterThan(240);
    expect(left.g).toBeLessThan(15);

    // Right edge: the second fade, mirrored.
    const right = await getPixelAt(page, 590, 200, layerId);
    expect(right.a).toBeGreaterThan(235);
    expect(right.r).toBeGreaterThan(240);

    // Between the two fades both gradients are transparent — nothing from
    // the overshoot frame at x=100 may linger here.
    const middle = await getPixelAt(page, 300, 200, layerId);
    expect(middle.a).toBeLessThan(8);
  });

  test('a second radial fade keeps the first one', async ({ page }) => {
    const layerId = await addLayer(page);
    await setRedFadeGradient(page, 'radial');

    await dragGradient(page, [[150, 200], [250, 200]]);
    await dragGradient(page, [[450, 200], [550, 200]]);
    await page.screenshot({ path: 'e2e/screenshots/gradient-composite-no-selection-radial.png' });

    const firstCenter = await getPixelAt(page, 150, 200, layerId);
    expect(firstCenter.a).toBeGreaterThan(245);
    expect(firstCenter.r).toBeGreaterThan(240);

    const secondCenter = await getPixelAt(page, 450, 200, layerId);
    expect(secondCenter.a).toBeGreaterThan(245);

    const between = await getPixelAt(page, 300, 200, layerId);
    expect(between.a).toBeLessThan(8);
  });
});
