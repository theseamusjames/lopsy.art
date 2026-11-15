import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setForegroundColor,
  getEditorState,
  getRootGroupId,
  addAdjustment,
  undo,
} from './helpers';

/**
 * #1052 — adjustment node edits recorded no history, so ⌘Z undid the step
 *         before the edit (or removed the whole node).
 * #1055 — ⌘-click another layer's thumbnail, then Delete, wiped the whole
 *         active layer instead of the loaded selection (regression of #801).
 * #1057 — the R8 mask readback returned zeros on documents whose width
 *         isn't a multiple of 4 (PACK_ALIGNMENT), blacking out mask.data.
 * #1060 — a tool drag froze while the pointer was over a ruler, so a
 *         marquee released on the ruler ended short.
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

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((e) => e.label);
  });
}

async function selectionBounds(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null } };
    };
    const sel = store.getState().selection;
    return sel.active ? sel.bounds : null;
  });
}

async function opaqueCount(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ pixels: number[] }>;
    };
    const { pixels } = await w.__readLayerPixels(id);
    let n = 0;
    for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 128) n++;
    return n;
  }, layerId);
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

async function adjustmentValue(page: Page, groupId: string, type: string, key: string): Promise<number | null> {
  return page.evaluate(({ gid, type, key }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; adjustments?: Array<Record<string, unknown>> }> } };
    };
    const group = store.getState().document.layers.find((l) => l.id === gid);
    const node = group?.adjustments?.find((n) => n.type === type);
    return node ? (node[key] as number) : null;
  }, { gid: groupId, type, key });
}

test.describe('autofix #1052 #1055 #1057 #1060', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel and rulers need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('#1060 a marquee released over the top ruler reaches the release point', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);

    const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
    const origin = await docToScreen(page, 0, 0);
    // Ruler strips are 20 px; aim at the middle of the top one, 30 px left
    // of the canvas's left edge.
    const rulerX = origin.x - 30;
    const rulerY = box.y + 10;
    expect(rulerX).toBeGreaterThan(box.x + 20);
    expect(rulerY).toBeLessThan(origin.y);

    // Press on a whole screen pixel: Firefox truncates pointer coordinates
    // to whole CSS pixels while Chromium keeps the fraction, so the corner
    // must come from the pixel actually pressed, rounded as the marquee does.
    await page.keyboard.press('m');
    const requested = await docToScreen(page, 700, 500);
    const start = { x: Math.round(requested.x), y: Math.round(requested.y) };
    const unit = await docToScreen(page, 1, 1);
    const zoom = unit.x - origin.x;
    const cornerX = Math.round((start.x - origin.x) / zoom);
    const cornerY = Math.round((start.y - origin.y) / zoom);
    expect(Math.abs(cornerX - 700)).toBeLessThanOrEqual(2);
    expect(Math.abs(cornerY - 500)).toBeLessThanOrEqual(2);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(rulerX, rulerY, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const bounds = await selectionBounds(page);
    expect(bounds).not.toBeNull();
    // The selection covers the canvas's top-left corner, as it does when
    // released anywhere else outside the canvas.
    expect(bounds!.x).toBeLessThanOrEqual(0);
    expect(bounds!.y).toBeLessThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBe(cornerX);
    expect(bounds!.y + bounds!.height).toBe(cornerY);
    // A press on the canvas doesn't create a guide.
    const guides = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { guides: unknown[] };
      };
      return ui.getState().guides.length;
    });
    expect(guides).toBe(0);
  });

  test('#1055 ⌘-click another layer\'s thumbnail, then Delete, clears only that shape', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(300);
    const layer1 = (await getEditorState(page)).document.activeLayerId!;

    await setForegroundColor(page, 0, 0, 255);
    await dragMarquee(page, 100, 100, 200, 200);
    await editFill(page);
    await deselect(page);
    expect(await opaqueCount(page, layer1)).toBe(10000);

    const layer2 = await addLayer(page);
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 50, 140, 350, 160);
    await editFill(page);
    await deselect(page);
    expect(await opaqueCount(page, layer2)).toBe(6000);

    const thumbnail = page.locator(`[data-layer-id="${layer1}"] div[class*="thumbnail"]`).first();
    await thumbnail.click({ modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(300);
    expect(await selectionBounds(page)).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect((await getEditorState(page)).document.activeLayerId).toBe(layer2);

    const hover = await docToScreen(page, 300, 250);
    await page.mouse.move(hover.x, hover.y);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Only the 100 × 20 part of the bar inside the square is gone.
    expect(await opaqueCount(page, layer2)).toBe(4000);
    expect(await opaqueCount(page, layer1)).toBe(10000);
    expect(await selectionBounds(page)).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect((await historyLabels(page)).at(-1)).toBe('Clear Selection');

    await undo(page);
    await page.waitForTimeout(200);
    expect(await opaqueCount(page, layer2)).toBe(6000);
  });

  test('#1055 ⌘-click the active layer\'s own thumbnail, then Delete, still clears it', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(300);
    const layer1 = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 0, 0, 255);
    await dragMarquee(page, 100, 100, 200, 200);
    await editFill(page);
    await deselect(page);

    const thumbnail = page.locator(`[data-layer-id="${layer1}"] div[class*="thumbnail"]`).first();
    await thumbnail.click({ modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(300);
    const hover = await docToScreen(page, 300, 250);
    await page.mouse.move(hover.x, hover.y);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    expect(await opaqueCount(page, layer1)).toBe(0);
  });

  test('#1057 mask data survives an edit on a document whose width isn\'t a multiple of 4', async ({ page }) => {
    await createDocument(page, 401, 300, false);
    await page.waitForTimeout(300);
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    await editFill(page);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.locator('[aria-label="Edit mask for Layer 1"]').click();
    await page.waitForTimeout(100);

    await dragMarquee(page, 100, 100, 300, 250);
    await setForegroundColor(page, 0, 0, 0);
    await editFill(page);
    await deselect(page);

    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await page.waitForTimeout(300);

    // The GPU readback lands in mask.data: black inside the fill, white
    // outside. Before the fix every byte read back as 0.
    await expect.poll(() => maskByteAt(page, layerId, 200, 200)).toBe(0);
    expect(await maskByteAt(page, layerId, 50, 50)).toBe(255);
    expect(await maskByteAt(page, layerId, 400, 299)).toBe(255);
  });

  test('#1052 adjustment node edits are undoable one gesture at a time', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);

    // A brush stroke to stand in for the unrelated work before the edit.
    await page.keyboard.press('b');
    const a = await docToScreen(page, 50, 150);
    const b = await docToScreen(page, 350, 150);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect((await historyLabels(page)).at(-1)).toBe('Brush');

    const rootId = await getRootGroupId(page);
    await addAdjustment(page, rootId, 'vignette', { vignette: 22 });
    let labels = await historyLabels(page);
    expect(labels.slice(-3)).toEqual(['Brush', 'Add Adjustment', 'Edit Vignette']);

    const row = page.getByTestId('effects-drawer').locator('div[class*="nodeRow"]', { hasText: 'Vignette' });
    const vignetteInput = row.locator('[aria-label="Vignette value"]');
    if (!(await vignetteInput.isVisible().catch(() => false))) {
      await row.locator('[aria-label="Expand"]').click();
    }
    await vignetteInput.fill('45');
    await vignetteInput.press('Enter');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await adjustmentValue(page, rootId, 'vignette', 'vignette')).toBe(45);
    expect((await historyLabels(page)).slice(-2)).toEqual(['Edit Vignette', 'Edit Vignette']);

    // A slider drag records exactly one entry, however many updates it fires.
    const slider = row.locator('input[type="range"][aria-label="Vignette"]');
    const sb = (await slider.boundingBox())!;
    const before = (await historyLabels(page)).length;
    await page.mouse.move(sb.x + sb.width * 0.45, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width * 0.85, sb.y + sb.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(await adjustmentValue(page, rootId, 'vignette', 'vignette')).toBeGreaterThan(70);
    labels = await historyLabels(page);
    expect(labels.length).toBe(before + 1);
    expect(labels.at(-1)).toBe('Edit Vignette');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // ⌘Z steps back through the edits, one at a time, and keeps the stroke.
    await undo(page);
    await page.waitForTimeout(150);
    expect(await adjustmentValue(page, rootId, 'vignette', 'vignette')).toBe(45);
    await undo(page);
    await page.waitForTimeout(150);
    expect(await adjustmentValue(page, rootId, 'vignette', 'vignette')).toBe(22);
    await undo(page);
    await page.waitForTimeout(150);
    expect(await adjustmentValue(page, rootId, 'vignette', 'vignette')).toBe(0);
    expect((await historyLabels(page)).at(-1)).toBe('Add Adjustment');
    await undo(page);
    await page.waitForTimeout(150);
    expect(await adjustmentValue(page, rootId, 'vignette', 'vignette')).toBeNull();
    expect((await historyLabels(page)).at(-1)).toBe('Brush');
  });
});
