import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';

// #1067: Paths panel → Stroke Path skipped the pixel-write guard the Pen
// tool's Enter applies. On a text layer it replaced the glyphs with the
// stroke; on a group it pushed an empty "Stroke Path" history row.

async function clickAtDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function activeLayer(page: Page): Promise<{ id: string; type: string }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; type: string }> } };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    return { id: layer.id, type: layer.type };
  });
}

async function layerTexture(page: Page, id: string): Promise<{ width: number; height: number; opaque: number }> {
  return page.evaluate(async (layerId) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await read(layerId);
    let opaque = 0;
    for (let i = 3; i < r.pixels.length; i += 4) if (r.pixels[i]! > 0) opaque++;
    return { width: r.width, height: r.height, opaque };
  }, id);
}

async function commitPenPath(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  await clickAtDoc(page, 60, 320);
  await clickAtDoc(page, 540, 320);
  await page.locator('button[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);
}

async function strokeFirstPathFromPanel(page: Page): Promise<void> {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible())) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
  }
  const row = list.locator('[data-testid^="path-item-"]').first();
  if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await page.locator('button[aria-label="Stroke Path"]').click();
  const modal = page.locator('[role="dialog"][aria-label="Stroke Path"]');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[type="number"]').fill('10');
  await modal.locator('button:has-text("Stroke")').click();
  await modal.waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
}

test.describe('Paths panel Stroke Path guards the target layer (#1067)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'paths panel requires the desktop sidebar');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
  });

  test('on a text layer it leaves the glyphs alone and explains why', async ({ page }) => {
    await page.keyboard.press('t');
    await clickAtDoc(page, 100, 120);
    await page.keyboard.type('HELLO');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const text = await activeLayer(page);
    expect(text.type).toBe('text');
    const glyphs = await layerTexture(page, text.id);
    expect(glyphs.opaque).toBeGreaterThan(0);

    await commitPenPath(page);
    const before = await historyLabels(page);
    await strokeFirstPathFromPanel(page);

    await expect(page.getByText('Text layers must be rasterized before they can be painted on.')).toBeVisible();
    expect(await historyLabels(page)).toEqual(before);
    expect(await layerTexture(page, text.id)).toEqual(glyphs);
  });

  test('on a group it pushes no history entry', async ({ page }) => {
    await commitPenPath(page);
    await page.locator('button[aria-label="New Group"]').click();
    await page.waitForTimeout(200);
    expect((await activeLayer(page)).type).toBe('group');
    const before = await historyLabels(page);

    await strokeFirstPathFromPanel(page);

    await expect(page.getByText("Groups can't be painted on. Select a layer inside the group.")).toBeVisible();
    expect(await historyLabels(page)).toEqual(before);
  });
});
