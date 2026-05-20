import { test, expect } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  getEditorState,
  getPixelAt,
  paintRect,
  addLayer,
  setActiveLayer,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

test('displacement map shifts pixels using source layer channels', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Layers panel not visible on mobile viewport');
  await createDocument(page, 200, 200, false);

  const state = await getEditorState(page);
  const bgLayerId = state.document.layers.find(
    (l: { type: string }) => l.type === 'raster',
  )!.id;

  await paintRect(page, 90, 0, 20, 200, { r: 255, g: 0, b: 0, a: 255 }, bgLayerId);
  await page.waitForTimeout(200);

  await page.screenshot({ path: 'e2e/screenshots/displacement-map-before.png' });

  const beforeCenter = await getPixelAt(page, 100, 100, bgLayerId);
  expect(beforeCenter.r).toBeGreaterThan(200);
  expect(beforeCenter.g).toBeLessThan(50);

  const dispLayerId = await addLayer(page);

  await paintRect(page, 0, 0, 200, 200, { r: 230, g: 128, b: 128, a: 255 }, dispLayerId);
  await page.waitForTimeout(200);

  await setActiveLayer(page, bgLayerId);

  await page.click('text=Filter');
  await page.click('text=Displacement Map...');
  await page.waitForTimeout(300);

  const dialog = page.locator('[role="dialog"][aria-label="Displacement Map"]');
  await expect(dialog).toBeVisible();

  const sourceSelect = dialog.locator('#disp-source');
  await sourceSelect.selectOption(dispLayerId);

  const hSlider = dialog.locator('text=Horizontal Scale').locator('..').locator('input[type="range"]');
  await hSlider.fill('100');

  const vSlider = dialog.locator('text=Vertical Scale').locator('..').locator('input[type="range"]');
  await vSlider.fill('0');

  await dialog.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'e2e/screenshots/displacement-map-after.png' });

  const afterCenter = await getPixelAt(page, 100, 100, bgLayerId);
  const centerChanged = (
    Math.abs(afterCenter.r - beforeCenter.r) > 10 ||
    Math.abs(afterCenter.g - beforeCenter.g) > 10 ||
    Math.abs(afterCenter.b - beforeCenter.b) > 10 ||
    Math.abs(afterCenter.a - beforeCenter.a) > 10
  );
  expect(centerChanged).toBe(true);
});

test('displacement map supports undo', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Layers panel not visible on mobile viewport');
  await createDocument(page, 200, 200, false);

  const state = await getEditorState(page);
  const bgLayerId = state.document.layers.find(
    (l: { type: string }) => l.type === 'raster',
  )!.id;

  await paintRect(page, 80, 0, 40, 200, { r: 0, g: 0, b: 255, a: 255 }, bgLayerId);
  await page.waitForTimeout(200);

  const beforePixel = await getPixelAt(page, 100, 100, bgLayerId);

  const dispLayerId = await addLayer(page);
  await paintRect(page, 0, 0, 200, 200, { r: 230, g: 128, b: 128, a: 255 }, dispLayerId);
  await page.waitForTimeout(200);

  await setActiveLayer(page, bgLayerId);

  await page.click('text=Filter');
  await page.click('text=Displacement Map...');
  await page.waitForTimeout(300);

  const dialog = page.locator('[role="dialog"][aria-label="Displacement Map"]');
  const sourceSelect = dialog.locator('#disp-source');
  await sourceSelect.selectOption(dispLayerId);

  const hSlider = dialog.locator('text=Horizontal Scale').locator('..').locator('input[type="range"]');
  await hSlider.fill('100');

  await dialog.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(300);

  const afterPixel = await getPixelAt(page, 100, 100, bgLayerId);
  const changed = Math.abs(afterPixel.r - beforePixel.r) > 10 ||
    Math.abs(afterPixel.g - beforePixel.g) > 10 ||
    Math.abs(afterPixel.b - beforePixel.b) > 10 ||
    Math.abs(afterPixel.a - beforePixel.a) > 10;
  expect(changed).toBe(true);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  const undonePixel = await getPixelAt(page, 100, 100, bgLayerId);
  expect(undonePixel.b).toBeGreaterThan(200);
});

test('displacement map dialog shows source layer selector and controls', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Layers panel not visible on mobile viewport');
  await createDocument(page, 200, 200, false);

  await addLayer(page);

  await page.click('text=Filter');
  await page.click('text=Displacement Map...');
  await page.waitForTimeout(300);

  const dialog = page.locator('[role="dialog"][aria-label="Displacement Map"]');
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('#disp-source')).toBeVisible();
  await expect(dialog.locator('text=Horizontal Scale')).toBeVisible();
  await expect(dialog.locator('text=Vertical Scale')).toBeVisible();
  await expect(dialog.locator('#disp-edge')).toBeVisible();
  await expect(dialog.locator('button:has-text("Apply")')).toBeVisible();
  await expect(dialog.locator('button:has-text("Cancel")')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/displacement-map-dialog.png' });

  await dialog.locator('button:has-text("Cancel")').click();
  await expect(dialog).not.toBeVisible();
});
