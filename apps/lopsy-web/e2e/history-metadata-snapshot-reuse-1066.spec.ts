import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, addLayer, selectTool, docToScreen } from './helpers';

// #1066: the first pixel edit after a metadata history entry (Add Layer,
// Rename Layer, …) re-snapshotted every layer's GPU texture instead of only
// the edited one, because handle reuse only looked at the stack top.

async function snapshotCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __gpuSnapshotCount: () => number }).__gpuSnapshotCount());
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(100);
}

async function fill(page: Page): Promise<void> {
  await page.locator('button:has-text("Edit")').first().click();
  await page.getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await settle(page);
}

/** Snapshots allocated by one Edit → Fill. */
async function fillDelta(page: Page): Promise<number> {
  const before = await snapshotCount(page);
  await fill(page);
  return (await snapshotCount(page)) - before;
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

test('a pixel edit after a metadata step snapshots only the edited layer (#1066)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'menu bar requires desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  for (let i = 0; i < 6; i++) await addLayer(page);

  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, 40, 40);
  const b = await docToScreen(page, 160, 140);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await fill(page);

  const pixelAfterPixel = await fillDelta(page);
  expect(pixelAfterPixel).toBeLessThanOrEqual(1);

  const id = await activeLayerId(page);
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.locator('span[class*="name"]').first().dblclick();
  const input = row.getByLabel('Layer name');
  await expect(input).toBeFocused();
  await input.fill('Renamed');
  await input.press('Enter');
  await settle(page);
  // Pre-fix: +8, one per layer.
  expect(await fillDelta(page)).toBe(pixelAfterPixel);

  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  // The new layer has no earlier snapshot, so it costs one more copy than a
  // fill on an existing layer — but none of the other seven layers is copied.
  expect(await fillDelta(page)).toBe(pixelAfterPixel + 1);
});
