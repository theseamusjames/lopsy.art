import { test, expect } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  drawRect,
  getPixelAt,
} from './helpers';

// Regression: nudging a selection with the arrow keys and then pressing Delete
// must clear only the moved selection — not the original (pre-nudge) area. The
// GPU selection mask is otherwise only refreshed on the next render frame, so
// Delete used to clear using a stale mask and wipe the whole shape.
test('delete after nudging the marquee clears only the moved selection', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  const layerId = await addLayer(page);

  // Solid red square at doc rows [100, 200), cols [100, 200).
  await drawRect(page, 100, 100, 100, 100, { r: 255, g: 0, b: 0 });
  await page.waitForTimeout(200);

  // Sanity: the square is painted.
  expect((await getPixelAt(page, 150, 103, layerId)).a).toBeGreaterThan(0);
  expect((await getPixelAt(page, 150, 150, layerId)).a).toBeGreaterThan(0);

  // Marquee-select the square (top edge aligned with the square's top edge).
  await page.keyboard.press('m');
  await page.waitForTimeout(50);
  const start = await docToScreen(page, 100, 100);
  const end = await docToScreen(page, 200, 200);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Nudge the marquee down 10px, then delete.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);

  // The top rows of the square fell outside the moved selection and must
  // remain; the interior moved under the selection and must be cleared.
  expect((await getPixelAt(page, 150, 103, layerId)).a).toBeGreaterThan(0);
  expect((await getPixelAt(page, 150, 150, layerId)).a).toBe(0);
});
