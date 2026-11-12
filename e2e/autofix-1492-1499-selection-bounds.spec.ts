import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getPixelAt,
  setForegroundColor,
  getEditorState,
} from './helpers';

/**
 * #1492 — Select → Inverse set the selection bounds to the whole canvas, so
 *         Edit → Crop after wand-outside + Inverse did not crop.
 * #1499 — a thin marquee dragged across a guide snapped both edges onto
 *         it, collapsed to zero height and selected nothing; the next
 *         Edit → Fill flooded the whole layer.
 */

interface Bounds { x: number; y: number; width: number; height: number }

async function selectionBounds(page: Page): Promise<Bounds | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: Bounds | null } };
    };
    const sel = store.getState().selection;
    return sel.active ? sel.bounds : null;
  });
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
}

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number } };
    };
    return store.getState().viewport.zoom;
  });
}

/** Cmd/Ctrl-click the top ruler above doc x: drops a vertical guide on the nearest layout fraction. */
async function dropVerticalGuideAtFraction(page: Page, docX: number): Promise<void> {
  const container = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!container) throw new Error('no canvas container');
  const { x } = await docToScreen(page, docX, 0);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.click(x, container.y + 10);
  await page.keyboard.up('ControlOrMeta');
  await page.mouse.move(container.x + container.width / 2, container.y + container.height - 10);
  await page.waitForTimeout(100);
}

async function guides(page: Page): Promise<{ orientation: string; position: number }[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guides: { orientation: string; position: number }[] };
    };
    return store.getState().guides;
  });
}

test.describe('Selection bounds (#1492, #1499)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers and the menu bar need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
    await setForegroundColor(page, 255, 0, 0);
  });

  test('#1492: wand the outside, Inverse, Crop crops to the object', async ({ page }) => {
    await page.keyboard.press('m');
    await dragDoc(page, 150, 100, 250, 200);
    await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    await page.keyboard.press('w');
    await clickDoc(page, 10, 10);
    expect(await selectionBounds(page)).toEqual({ x: 0, y: 0, width: 400, height: 300 });

    await menu(page, 'Select', /^\s*Inverse/);
    expect(await selectionBounds(page)).toEqual({ x: 150, y: 100, width: 100, height: 100 });

    await menu(page, 'Edit', /^Crop$/);
    await page.screenshot({ path: 'e2e/screenshots/inverse-crop-1492.png' });
    const doc = (await getEditorState(page)).document;
    expect(doc.width).toBe(100);
    expect(doc.height).toBe(100);
    // The red square now fills the cropped canvas corner to corner.
    expect((await getPixelAt(page, 1, 1)).r).toBe(255);
    expect((await getPixelAt(page, 98, 98)).r).toBe(255);
  });

  test('#1499: a thin marquee across a guide selects the strip, not nothing', async ({ page }) => {
    await dropVerticalGuideAtFraction(page, 200);
    const placed = await guides(page);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ orientation: 'vertical', position: 200 });
    // Each edge 3 doc px from the guide must sit inside the 8 screen px reach.
    expect(3 * (await zoom(page))).toBeLessThanOrEqual(8);

    await page.keyboard.press('m');
    await dragDoc(page, 197, 50, 203, 250);
    expect(await selectionBounds(page)).toEqual({ x: 197, y: 50, width: 6, height: 200 });

    await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
    await page.screenshot({ path: 'e2e/screenshots/marquee-guide-collapse-1499.png' });
    expect((await getPixelAt(page, 198, 150)).a).toBe(255);
    expect((await getPixelAt(page, 202, 150)).a).toBe(255);
    // Outside the strip stays transparent: the fill did not flood the layer.
    expect((await getPixelAt(page, 100, 150)).a).toBe(0);
    expect((await getPixelAt(page, 300, 20)).a).toBe(0);
  });
});
