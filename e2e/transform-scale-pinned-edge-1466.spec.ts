/**
 * #1466: scaling part of a layer with the Move handles left a translucent
 * seam (75% alpha) along the pinned edge and bled a 25%-alpha row past the
 * far edge, because the bilinear taps reached the transparent texels just
 * outside the selection.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, selectTool, docToScreen, setForegroundColor } from './helpers';

async function selectExact(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const pt = await docToScreen(page, (x0 + x1) / 2, (y0 + y1) / 2);
  await page.mouse.click(pt.x, pt.y);
  const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
  await expect(dialog).toBeVisible({ timeout: 3000 });
  await dialog.getByLabel('From X').fill(String(x0));
  await dialog.getByLabel('From Y').fill(String(y0));
  await dialog.getByLabel('To X').fill(String(x1));
  await dialog.getByLabel('To Y').fill(String(y1));
  await dialog.getByRole('button', { name: 'Select' }).click();
  await expect(dialog).toHaveCount(0);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await expect.poll(() => page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean } };
    };
    return store.getState().selection.active;
  })).toBe(false);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function dragDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Alpha of the active layer at document (x, y) for each requested point. */
async function alphaAt(page: Page, points: Array<[number, number]>): Promise<number[]> {
  return page.evaluate(async (pts) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await read(doc.activeLayerId);
    if (!layer || !result) return pts.map(() => -1);
    return pts.map(([x, y]) => {
      const lx = x - layer.x;
      const ly = y - layer.y;
      if (lx < 0 || ly < 0 || lx >= result.width || ly >= result.height) return 0;
      return result.pixels[(ly * result.width + lx) * 4 + 3] ?? -1;
    });
  }, points);
}

test.describe('Move-handle scale of a selection keeps whole-pixel edges solid (#1466)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'handle drags need a desktop pointer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await setForegroundColor(page, 0xd0, 0x18, 0x18);
    await selectExact(page, 50, 50, 250, 250);
    await editFill(page);
    await deselect(page);
  });

  test('bottom handle stretch: no seam at the pinned top edge, no bleed past the bottom', async ({ page }) => {
    await selectExact(page, 50, 150, 250, 250);
    await selectTool(page, 'move');
    await dragDoc(page, [150, 250], [150, 350]);
    await deselect(page);

    const [above, pinned, below, lastInside, firstOutside] = await alphaAt(page, [
      [150, 149], [150, 150], [150, 151], [150, 349], [150, 350],
    ]);
    expect(above).toBe(255);
    expect(pinned).toBe(255);
    expect(below).toBe(255);
    expect(lastInside).toBe(255);
    expect(firstOutside).toBe(0);
  });

  test('right handle stretch: no seam at the pinned left edge', async ({ page }) => {
    await selectExact(page, 150, 50, 200, 250);
    await selectTool(page, 'move');
    await dragDoc(page, [200, 150], [300, 150]);
    await deselect(page);

    const [left, pinned, lastInside, firstOutside] = await alphaAt(page, [
      [149, 100], [150, 100], [299, 100], [300, 100],
    ]);
    expect(left).toBe(255);
    expect(pinned).toBe(255);
    expect(lastInside).toBe(255);
    expect(firstOutside).toBe(0);
  });
});
