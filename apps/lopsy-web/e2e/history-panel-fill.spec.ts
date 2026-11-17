import { test, expect } from './fixtures';
import { createDocument, docToScreen, selectTool, waitForStore } from './helpers';

/**
 * The History list fills its dock pane. It used to stop at a fixed 250px,
 * so with History as the only open panel it showed a dozen rows and
 * scrolled, with most of the dock empty beneath it.
 */

const STROKE_COUNT = 16;

test('history list fills the dock when it is the only open panel', async ({ page, isMobile }) => {
  test.skip(isMobile, 'docking is a desktop feature');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);

  const toolbar = page.locator('[role="toolbar"][aria-label="Panel visibility"]');
  const openPanels = toolbar.locator('button[aria-pressed="true"]:not([aria-label="History"])');
  while ((await openPanels.count()) > 0) {
    await openPanels.first().click();
  }
  const historyToggle = toolbar.locator('button[aria-label="History"]');
  if ((await historyToggle.getAttribute('aria-pressed')) !== 'true') {
    await historyToggle.click();
  }
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);

  const panel = page.locator('section[role="tabpanel"][aria-label="History"]');
  const rows = panel.locator('button');
  const rowsBefore = await rows.count();

  await selectTool(page, 'brush');
  for (let i = 0; i < STROKE_COUNT; i++) {
    const y = 20 + i * 16;
    const from = await docToScreen(page, 40, y);
    const to = await docToScreen(page, 360, y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  }

  // One row per stroke: more than fit in the old 250px cap.
  await expect(rows).toHaveCount(rowsBefore + STROKE_COUNT);

  // The pane is far taller than the rows, so every row shows at once.
  await expect(rows.first()).toBeInViewport({ ratio: 1 });
  await expect(rows.last()).toBeInViewport({ ratio: 1 });

  const panelBox = await panel.boundingBox();
  const listBox = await panel.locator('> div').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(listBox).not.toBeNull();
  const padding = await panel.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(listBox!.y + listBox!.height).toBeCloseTo(panelBox!.y + panelBox!.height - padding, 0);

  await page.screenshot({ path: 'e2e/screenshots/history-panel-fill.png' });
});
