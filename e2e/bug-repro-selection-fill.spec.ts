// Regression tests for #222 — fill bucket should respect an active selection.
//
// Root cause (now fixed): the transform-handle hit-test in
// src/app/interactions/transform-handlers.ts ran for every tool, not just
// move. At low zoom with small selections the hit radius (8 / zoom in
// doc-space) overlapped multiple handles around the selection, so a click
// inside the selection on the fill tool was intercepted as a transform-handle
// drag — handleFillDown never ran and the fill silently no-op'd. The fix
// scopes the handle hit-test to the move tool and caps the radius to a
// fraction of the selection's smallest dimension.
import { test, expect } from '@playwright/test';
import {
  createDocument,
  setForegroundColor,
  selectTool,
  setToolOption,
  docToScreen,
  getPixelAt,
  waitForStore,
} from './helpers';

test('issue #222 — small ellipse marquee + fill stays inside selection (was: silently no-op due to handle hit-radius)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 1200, true);

  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);

  // 20×20 ellipse at low zoom — pre-fix this was inside every transform
  // handle's hit radius, so the fill click was swallowed by handle dispatch.
  await selectTool(page, 'marquee-ellipse');
  const eStart = await docToScreen(page, 250, 550);
  const eEnd = await docToScreen(page, 270, 570);
  await page.mouse.move(eStart.x, eStart.y);
  await page.mouse.down();
  await page.mouse.move(eEnd.x, eEnd.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  await setForegroundColor(page, 180, 200, 220);
  await selectTool(page, 'fill');
  await setToolOption(page, 'Tolerance', 255);
  const click = await docToScreen(page, 260, 560);
  await page.mouse.click(click.x, click.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(80);

  const inside = await getPixelAt(page, 260, 560);
  const farTopLeft = await getPixelAt(page, 50, 50);
  const farRight = await getPixelAt(page, 700, 560);

  expect(inside.b).toBeGreaterThan(150);
  expect(inside.a).toBeGreaterThan(200);
  // Selection-respect: layer must remain transparent outside the ellipse.
  expect(farTopLeft.a).toBe(0);
  expect(farRight.a).toBe(0);
});

test('issue #222 — elliptical marquee + fill on a fresh layer (mid-size)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, true);

  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);

  await selectTool(page, 'marquee-ellipse');
  const eStart = await docToScreen(page, 350, 250);
  const eEnd = await docToScreen(page, 450, 350);
  await page.mouse.move(eStart.x, eStart.y);
  await page.mouse.down();
  await page.mouse.move(eEnd.x, eEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  await setForegroundColor(page, 255, 0, 100);
  await selectTool(page, 'fill');
  await setToolOption(page, 'Tolerance', 255);
  const click = await docToScreen(page, 400, 300);
  await page.mouse.click(click.x, click.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  const inside = await getPixelAt(page, 400, 300);
  const farOutsideTopLeft = await getPixelAt(page, 50, 50);
  const farOutsideBottomRight = await getPixelAt(page, 750, 550);
  expect(inside.r).toBeGreaterThan(200);
  expect(inside.a).toBeGreaterThan(200);
  expect(farOutsideTopLeft.a).toBe(0);
  expect(farOutsideBottomRight.a).toBe(0);
});

test('issue #222 — freehand lasso polygon + fill stays inside selection', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 400, true);

  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);

  await selectTool(page, 'lasso');
  const traceDocPoints = [
    { x: 250, y: 200 },
    { x: 380, y: 220 },
    { x: 380, y: 380 },
    { x: 220, y: 380 },
    { x: 250, y: 200 },
  ];
  const screenPoints: Array<{ x: number; y: number }> = [];
  for (const p of traceDocPoints) {
    screenPoints.push(await docToScreen(page, p.x, p.y));
  }
  await page.mouse.move(screenPoints[0]!.x, screenPoints[0]!.y);
  await page.mouse.down();
  for (const sp of screenPoints.slice(1)) {
    await page.mouse.move(sp.x, sp.y, { steps: 8 });
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  await setForegroundColor(page, 255, 0, 100);
  await selectTool(page, 'fill');
  await setToolOption(page, 'Tolerance', 255);
  const click = await docToScreen(page, 320, 300);
  await page.mouse.click(click.x, click.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  const inside = await getPixelAt(page, 320, 300);
  const farOutsideTopLeft = await getPixelAt(page, 50, 50);
  const farOutsideRight = await getPixelAt(page, 50, 200);

  expect(inside.r).toBeGreaterThan(200);
  expect(inside.a).toBeGreaterThan(200);
  expect(farOutsideTopLeft.a).toBe(0);
  expect(farOutsideRight.a).toBe(0);
});
