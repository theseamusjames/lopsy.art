/**
 * #1033 — Edit → Fill with a selection touching the canvas edge also filled
 *         the off-canvas part of the layer.
 * #1034 — in mask edit mode, Edit → Fill and Delete changed the layer's
 *         pixels instead of its mask (and a group mask couldn't be filled).
 * #1047 — global shortcuts fired behind open modal dialogs: Backspace
 *         deleted the active layer under the Marquee Region / filter dialog.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
  getPixelAt,
  moveLayerTo,
} from './helpers';

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

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

/** Composited (on-screen) colour at a document point, at the current viewport. */
async function compositeAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as [number, number, number];
  }, { x, y });
}

function expectNear(actual: [number, number, number], expected: [number, number, number], tol = 2): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tol);
}

async function maskByteAt(page: Page, layerId: string, x: number, y: number): Promise<number> {
  return page.evaluate(({ lid, x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number } | null }> } };
    };
    const mask = store.getState().document.layers.find((l) => l.id === lid)!.mask!;
    return mask.data[y * mask.width + x] ?? -1;
  }, { lid: layerId, x, y });
}

async function lastHistoryLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label ?? '';
  });
}

async function countBluePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (lid) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(lid);
    let n = 0;
    for (let i = 0; i < px.pixels.length; i += 4) {
      if ((px.pixels[i + 3] ?? 0) > 200 && (px.pixels[i + 2] ?? 0) > 200 && (px.pixels[i] ?? 0) < 50) n++;
    }
    return n;
  }, layerId);
}

test.describe('Fill / Delete targets and dialogs', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and the layers panel need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);
  });

  test('#1033 Fill with a selection on the canvas edge leaves the off-canvas part alone', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 0, 100, 200, 300);
    await editFill(page);
    await deselect(page);

    await moveLayerTo(page, layerId, -100, 100);
    await setForegroundColor(page, 0, 0, 255);
    await dragMarquee(page, 0, 150, 50, 160);
    await editFill(page);
    await deselect(page);

    await moveLayerTo(page, layerId, 50, 100);
    expect(await countBluePixels(page, layerId)).toBe(500);
  });

  test('#1034 Fill and Delete in mask edit mode write the mask, not the pixels', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    const editMask = page.locator('[aria-label="Edit mask for Layer 1"]');
    await setForegroundColor(page, 255, 0, 0);
    await editFill(page);

    await page.locator('[aria-label="Add Mask"]').click();
    await editMask.click();
    await page.waitForTimeout(100);

    await dragMarquee(page, 100, 100, 300, 300);
    await setForegroundColor(page, 0, 0, 0);
    await editFill(page);

    expect(await lastHistoryLabel(page)).toBe('Mask Fill');
    const px = await getPixelAt(page, 200, 200, layerId);
    expect([px.r, px.g, px.b, px.a]).toEqual([255, 0, 0, 255]);
    await expect.poll(() => maskByteAt(page, layerId, 200, 200)).toBe(0);
    expect(await maskByteAt(page, layerId, 50, 50)).toBe(255);

    // Leave mask edit mode (which shows the layer unmasked) and look: the
    // mask hides the layer inside the selection, so the white Background shows.
    await row.click();
    await page.waitForTimeout(150);
    expectNear(await compositeAt(page, 200, 200), [255, 255, 255]);
    expectNear(await compositeAt(page, 50, 50), [255, 0, 0]);

    // Delete fills the mask with the background colour (white) and keeps the layer.
    await editMask.click();
    await page.waitForTimeout(100);
    const layerCount = (await getEditorState(page)).document.layers.length;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    expect(await lastHistoryLabel(page)).toBe('Mask Clear');
    expect((await getEditorState(page)).document.layers.length).toBe(layerCount);
    await expect.poll(() => maskByteAt(page, layerId, 200, 200)).toBe(255);
    const after = await getPixelAt(page, 200, 200, layerId);
    expect([after.r, after.g, after.b, after.a]).toEqual([255, 0, 0, 255]);
    await row.click();
    await page.waitForTimeout(150);
    expectNear(await compositeAt(page, 200, 200), [255, 0, 0]);

    // Undo steps back to the black mask fill.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expectNear(await compositeAt(page, 200, 200), [255, 255, 255]);
  });

  test('#1034 Fill on a group mask is applied instead of refused', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await editFill(page);
    await page.click('button:has-text("Layer")');
    await page.getByRole('menuitem', { name: /^Group Layers/ }).click();
    await page.waitForTimeout(200);
    const groupId = (await getEditorState(page)).document.activeLayerId!;

    await page.locator('[aria-label="Add Mask"]').click();
    await page.locator('[aria-label="Edit mask for Group"]').click();
    await dragMarquee(page, 150, 150, 250, 250);
    await setForegroundColor(page, 0, 0, 0);
    await editFill(page);

    await expect(page.getByText("Groups can't be painted on")).toHaveCount(0);
    expect(await lastHistoryLabel(page)).toBe('Mask Fill');
    await expect.poll(() => maskByteAt(page, groupId, 200, 200)).toBe(0);
    await page.locator(`[data-layer-id="${groupId}"]`).click();
    await page.waitForTimeout(150);
    expectNear(await compositeAt(page, 200, 200), [255, 255, 255]);
    expectNear(await compositeAt(page, 100, 100), [255, 0, 0]);
  });

  test('#1047 Backspace, ⌘Z and tool keys do nothing behind the Marquee Region dialog', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 100, 80, 400, 300);
    await editFill(page);
    await deselect(page);
    const before = await getEditorState(page);
    const undoDepth = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>).__editorStore as { getState: () => { undoStack: unknown[] } })
        .getState().undoStack.length);

    const pos = await docToScreen(page, 500, 350);
    await page.mouse.click(pos.x, pos.y);
    const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('heading', { name: 'Rectangular Selection' }).click();

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    await expect(dialog).toBeVisible();
    const after = await getEditorState(page);
    expect(after.document.layers.length).toBe(before.document.layers.length);
    const undoAfter = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>).__editorStore as { getState: () => { undoStack: unknown[] } })
        .getState().undoStack.length);
    expect(undoAfter).toBe(undoDepth);
    const tool = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>).__uiStore as { getState: () => { activeTool: string } })
        .getState().activeTool);
    expect(tool).toBe('marquee-rect');
    expect((await getPixelAt(page, 200, 200)).a).toBe(255);
  });

  test('#1047 Backspace does not delete the layer behind a filter dialog', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await editFill(page);
    const layerCount = (await getEditorState(page)).document.layers.length;

    await page.click('text=Filter');
    await page.click('text=Add Noise...');
    const dialog = page.getByRole('dialog', { name: 'Add Noise' });
    await expect(dialog).toBeVisible();
    await dialog.locator('h2').first().click();
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    await expect(dialog).toBeVisible();
    expect((await getEditorState(page)).document.layers.length).toBe(layerCount);
  });
});
