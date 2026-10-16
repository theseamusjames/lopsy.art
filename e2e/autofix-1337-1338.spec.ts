import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, getEditorState, setForegroundColor } from './helpers';

/**
 * #1337 — Move-dragging a selection past the canvas edge deleted the overhang.
 * #1338 — Copy with a group active copied nothing and Paste added an empty layer.
 */

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function clickMenu(page: Page, menu: string, item: string): Promise<void> {
  await page.click(`button:has-text("${menu}")`);
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Document-space x range of the layer's opaque pixels (alpha > 100), or null. */
async function opaqueXRange(page: Page, layerId: string): Promise<{ min: number; max: number } | null> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number }> } } };
    };
    const result = await w.__readLayerPixels(id);
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === id);
    if (!result || !layer || result.width === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        if ((result.pixels[(y * result.width + x) * 4 + 3] ?? 0) > 100) {
          min = Math.min(min, x);
          max = Math.max(max, x);
        }
      }
    }
    if (min === Infinity) return null;
    return { min: min + layer.x, max: max + layer.x };
  }, layerId);
}

test.describe('autofix #1337 #1338', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('#1337 a selection dragged past the canvas edge keeps its overhang', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 0, 0, 0);
    await dragMarquee(page, 100, 100, 300, 200);
    await clickMenu(page, 'Edit', 'Fill');

    const filled = await opaqueXRange(page, layerId);
    expect(filled).not.toBeNull();
    expect(filled!.min).toBeGreaterThanOrEqual(98);
    expect(filled!.max).toBeLessThanOrEqual(301);
    const width = filled!.max - filled!.min;

    // The marquee is still active, so this drag moves a float.
    await page.keyboard.press('v');
    await dragDoc(page, { x: 200, y: 150 }, { x: 350, y: 150 });
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);

    const moved = await opaqueXRange(page, layerId);
    expect(moved).not.toBeNull();
    // The bar's right end now sits past the 400 px canvas, and is kept.
    expect(moved!.max).toBeGreaterThan(420);
    expect(moved!.max - moved!.min).toBeGreaterThanOrEqual(width - 2);

    // Drag the layer (nothing selected) back into the canvas.
    await dragDoc(page, { x: 330, y: 150 }, { x: 180, y: 150 });
    const back = await opaqueXRange(page, layerId);
    expect(back).not.toBeNull();
    expect(back!.max - back!.min).toBeGreaterThanOrEqual(width - 2);
    expect(back!.max).toBeGreaterThan(290);
  });

  test('#1338 Copy with a group active refuses with a toast; Paste adds no empty layer', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 0, 0, 0);
    await dragMarquee(page, 100, 100, 200, 200);
    await clickMenu(page, 'Edit', 'Fill');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    expect(groupId).not.toBe(layerId);

    await page.locator(`[data-layer-id="${layerId}"] [class*="thumbnail"]`).first()
      .click({ modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(200);
    const afterLoad = await getEditorState(page);
    expect(afterLoad.document.activeLayerId).toBe(groupId);
    expect(await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    })).toBe(true);

    const layerCountBefore = afterLoad.document.layers.length;
    await clickMenu(page, 'Edit', 'Copy');
    await expect(page.getByText("Groups can't be copied from")).toBeVisible();

    await clickMenu(page, 'Edit', 'Paste');
    await page.waitForTimeout(200);
    const after = await getEditorState(page);
    expect(after.document.layers.length).toBe(layerCountBefore);
    expect(after.document.layers.some((l) => l.name === 'Pasted Layer')).toBe(false);
  });
});
