/**
 * Regression test for #1284: with Show Grid on (which turns Snap on), a
 * Move-drag of selected pixels snapped the pixels to whole grid cells but
 * dropped the selection — marching ants, transform box and mask — at the raw
 * drag offset. A scale right after then transformed a box that no longer
 * covered the pixels and left a crescent of the original behind.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, getEditorState, setForegroundColor } from './helpers';

interface Rect { x: number; y: number; width: number; height: number }

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function selectionBounds(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: Rect | null } };
    };
    const sel = store.getState().selection;
    return sel.active ? sel.bounds : null;
  });
}

/** Bounding box of the selection mask's selected (>= 128) bytes, in doc space. */
async function selectionMaskBounds(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { mask: Uint8ClampedArray | null; maskWidth: number; maskHeight: number } };
    };
    const { mask, maskWidth: w, maskHeight: h } = store.getState().selection;
    if (!mask) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((mask[y * w + x] ?? 0) < 128) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX) return null;
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  });
}

/** Bounding box of the layer's opaque (alpha >= 128) pixels, in doc space. */
async function opaqueBounds(page: Page, id: string): Promise<Rect | null> {
  return page.evaluate(async (lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(lid);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX) return null;
    const ox = layer?.x ?? 0;
    const oy = layer?.y ?? 0;
    return { x: minX + ox, y: minY + oy, width: maxX - minX + 1, height: maxY - minY + 1 };
  }, id);
}

test.describe('#1284 grid-snapped Move keeps the selection on the moved pixels', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer thumbnails and transform handles need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 800, true);
    await page.waitForTimeout(300);
  });

  test('selection lands where the snapped pixels land, and a follow-up scale leaves nothing behind', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;

    // A red disc centred on (200, 200) with radius 60.
    await setForegroundColor(page, 255, 0, 0);
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await drag(page, 140, 140, 260, 260);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    await page.click('button:has-text("View")');
    await page.getByRole('menuitem', { name: /Show Grid/ }).click();
    await expect(page.getByRole('checkbox', { name: 'Snap', exact: true })).toBeChecked();

    const thumbnail = page.locator(`[data-layer-id="${layerId}"] div[class*="thumbnail"]`).first();
    await thumbnail.click({ modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(300);

    const discBefore = (await opaqueBounds(page, layerId))!;
    const selBefore = (await selectionBounds(page))!;
    const maskBefore = (await selectionMaskBounds(page))!;
    expect(discBefore.width).toBeGreaterThan(110);

    // A drag of (237, 123) — not a multiple of the 16 px grid — so the
    // snapped pixel offset and the raw drag offset differ on both axes.
    await page.keyboard.press('v');
    await drag(page, 200, 200, 437, 323);
    await page.screenshot({ path: 'e2e/screenshots/move-grid-snap-selection-after-move.png' });

    const discAfter = (await opaqueBounds(page, layerId))!;
    const selAfter = (await selectionBounds(page))!;
    const maskAfter = (await selectionMaskBounds(page))!;

    const pixelShift = { x: discAfter.x - discBefore.x, y: discAfter.y - discBefore.y };
    // Grid snap moved the pixels by whole 16 px cells.
    expect(pixelShift.x % 16).toBe(0);
    expect(pixelShift.y % 16).toBe(0);
    expect(pixelShift.x).toBeGreaterThan(200);
    expect(pixelShift.y).toBeGreaterThan(100);
    expect(discAfter.width).toBe(discBefore.width);

    // The selection bounds and its mask moved by exactly the same amount.
    expect(selAfter).toEqual({
      ...selBefore,
      x: selBefore.x + pixelShift.x,
      y: selBefore.y + pixelShift.y,
    });
    expect(maskAfter).toEqual({
      ...maskBefore,
      x: maskBefore.x + pixelShift.x,
      y: maskBefore.y + pixelShift.y,
    });

    // Shrink to half from the bottom-right handle, then commit with ⌘D.
    const corner = { x: selAfter.x + selAfter.width, y: selAfter.y + selAfter.height };
    await drag(
      page,
      corner.x,
      corner.y,
      selAfter.x + selAfter.width / 2,
      selAfter.y + selAfter.height / 2,
    );
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/move-grid-snap-selection-after-scale.png' });

    // Only the shrunken disc remains. The handle drag itself snaps to the
    // grid, so it ends near (not exactly at) half size; what must be gone is
    // the outer quarter of the full-size disc, where the leftover crescent
    // used to sit.
    const finalDisc = (await opaqueBounds(page, layerId))!;
    expect(finalDisc.x).toBeGreaterThanOrEqual(discAfter.x - 2);
    expect(finalDisc.y).toBeGreaterThanOrEqual(discAfter.y - 2);
    expect(finalDisc.x + finalDisc.width).toBeLessThan(discAfter.x + discAfter.width * 0.75);
    expect(finalDisc.y + finalDisc.height).toBeLessThan(discAfter.y + discAfter.height * 0.75);
    expect(Math.abs(finalDisc.width - finalDisc.height)).toBeLessThanOrEqual(2);
  });
});
