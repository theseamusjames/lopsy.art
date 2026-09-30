import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  setForegroundColor,
} from './helpers';

// #1026 — Select → Shrink that consumes the whole selection must not
//         silently deselect (which turns the next Delete into Delete Layer).
// #1036 — Magic Wand / Paint Bucket seed pixel is the pixel under the
//         pointer, not the nearest pixel corner (Math.round → Math.floor).
// #1038 — Select → Shrink keeps small circles round.

interface SelectionSnapshot {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  mask: number[] | null;
  maskWidth: number;
}

async function getSelection(page: Page): Promise<SelectionSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          bounds: { x: number; y: number; width: number; height: number } | null;
          mask: Uint8ClampedArray | null;
          maskWidth: number;
        };
      };
    };
    const sel = store.getState().selection;
    return {
      active: sel.active,
      bounds: sel.bounds,
      mask: sel.mask ? Array.from(sel.mask) : null,
      maskWidth: sel.maskWidth,
    };
  });
}

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const pos = await docToScreen(page, x, y);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(250);
}

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function editFill(page: Page): Promise<void> {
  await menu(page, 'Edit', /^Fill$/);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function shrinkBy(page: Page, amount: number): Promise<void> {
  await menu(page, 'Select', /^Shrink/);
  const modal = page.locator('[role="dialog"][aria-label="Shrink Selection"]');
  await modal.waitFor({ state: 'visible' });
  const input = modal.locator('input[aria-label$=" value"]').first();
  await input.fill(String(amount));
  await input.press('Tab');
  await modal.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);
}

test.describe('Selection fixes (#1026, #1036, #1038)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('#1038 Shrink 3 on a 16 px circle gives a ~10 px disc, not an 8 px square', async ({ page }) => {
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragOnCanvas(page, 100, 100, 116, 116);
    const before = await getSelection(page);
    expect(before.bounds).toEqual({ x: 100, y: 100, width: 16, height: 16 });

    await shrinkBy(page, 3);

    const after = await getSelection(page);
    expect(after.active).toBe(true);
    const b = after.bounds!;
    expect(b.width).toBeGreaterThanOrEqual(9);
    expect(b.width).toBeLessThanOrEqual(10);
    expect(b.height).toBe(b.width);
    const at = (x: number, y: number) => after.mask![y * after.maskWidth + x]!;
    // A disc: the bounding-box corners are cut, the side midpoints are in.
    expect(at(b.x, b.y)).toBe(0);
    expect(at(b.x + b.width - 1, b.y)).toBe(0);
    expect(at(b.x, b.y + b.height - 1)).toBe(0);
    expect(at(b.x + b.width - 1, b.y + b.height - 1)).toBe(0);
    expect(at(108, b.y)).toBeGreaterThan(127);
    expect(at(b.x, 108)).toBeGreaterThan(127);
  });

  test('#1026 Shrink that would consume the selection keeps it and warns; Delete keeps the layer', async ({ page }) => {
    const layerCount = (await getEditorState(page)).document.layers.length;
    await page.keyboard.press('m');
    await dragOnCanvas(page, 50, 50, 350, 250);
    await setForegroundColor(page, 200, 40, 40);
    await editFill(page);
    await deselect(page);

    await dragOnCanvas(page, 100, 100, 130, 130);
    await shrinkBy(page, 20);

    const toast = page.locator('[role="status"]').filter({ hasText: 'No pixels would remain selected' });
    await expect(toast).toBeVisible();
    const sel = await getSelection(page);
    expect(sel.active).toBe(true);
    expect(sel.bounds).toEqual({ x: 100, y: 100, width: 30, height: 30 });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);

    const state = await getEditorState(page);
    expect(state.document.layers.length).toBe(layerCount);
    // Only the selected square was cleared.
    expect((await getPixelAt(page, 115, 115)).a).toBe(0);
    expect((await getPixelAt(page, 200, 200)).a).toBe(255);
  });

  test('#1036 Magic Wand and Paint Bucket seed from the pixel under the pointer', async ({ page }) => {
    await page.keyboard.press('m');
    await dragOnCanvas(page, 100, 100, 300, 200);
    await setForegroundColor(page, 0, 0, 0);
    await editFill(page);
    await deselect(page);
    await dragOnCanvas(page, 150, 100, 151, 200);
    await setForegroundColor(page, 255, 255, 255);
    await editFill(page);
    await deselect(page);

    // Right-hand part of the white pixel at x = 150.
    await page.keyboard.press('w');
    await clickDoc(page, 150.8, 150.8);
    const sel = await getSelection(page);
    expect(sel.active).toBe(true);
    expect(sel.bounds).toEqual({ x: 150, y: 100, width: 1, height: 100 });
    await deselect(page);

    await page.keyboard.press('g');
    await setForegroundColor(page, 255, 0, 0);
    await clickDoc(page, 150.8, 150.8);
    const line = await getPixelAt(page, 150, 150);
    expect([line.r, line.g, line.b]).toEqual([255, 0, 0]);
    const right = await getPixelAt(page, 151, 150);
    expect([right.r, right.g, right.b]).toEqual([0, 0, 0]);
  });
});
