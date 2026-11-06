import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  setForegroundColor,
} from './helpers';

/**
 * #1493 — Add Layer named new layers from the entry count, root group
 *         included, so the first one was "Layer 4" and a delete made the
 *         next Add Layer repeat a name.
 * #1508 — inside a Mesh Warp session an off-handle drag ran a Move on the
 *         layer, the grid stayed behind and Cancel kept the move.
 */

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function editFill(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[role="menu"][aria-label="Edit"]').getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await page.waitForTimeout(200);
}

async function layerNames(page: Page): Promise<string[]> {
  const doc = (await getEditorState(page)).document as unknown as { layers: { name: string; type: string }[] };
  return doc.layers.filter((l) => l.type !== 'group').map((l) => l.name);
}

async function layerIdByName(page: Page, name: string): Promise<string> {
  const doc = (await getEditorState(page)).document as unknown as { layers: { id: string; name: string }[] };
  const layer = doc.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer named ${name}`);
  return layer.id;
}

async function meshWarpBounds(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { meshWarp: { bounds: { x: number; y: number; width: number; height: number } } | null };
    };
    return ui.getState().meshWarp?.bounds ?? null;
  });
}

async function selectionBounds(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { bounds: { x: number; y: number; width: number; height: number } | null } };
    };
    return store.getState().selection.bounds;
  });
}

test.describe('Autofix #1493, #1508', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and options bar');
  });

  test('#1493: Add Layer numbers from the highest name and never repeats one', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    expect(await layerNames(page)).toEqual(['Background', 'Layer 1']);

    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);
    expect((await layerNames(page)).sort()).toEqual(['Background', 'Layer 1', 'Layer 2']);

    await page.locator(`[data-layer-id="${await layerIdByName(page, 'Layer 1')}"]`).click();
    await page.locator('[aria-label="Delete Layer"]').click();
    await page.waitForTimeout(100);
    await page.locator(`[data-layer-id="${await layerIdByName(page, 'Background')}"]`).click();
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'e2e/screenshots/add-layer-names-1493.png' });

    const names = await layerNames(page);
    expect(names.sort()).toEqual(['Background', 'Layer 2', 'Layer 3']);
    expect(new Set(names).size).toBe(names.length);
  });

  test('#1508: an off-handle drag in a Mesh Warp session moves nothing, and Cancel keeps the layer', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    await setForegroundColor(page, 255, 0, 0);
    await page.keyboard.press('m');
    await dragDoc(page, 200, 150, 600, 450);
    await editFill(page);
    await dragDoc(page, 150, 100, 650, 500);

    // Firefox truncates pointer coordinates to whole CSS pixels, so the
    // marquee can land a doc pixel off 150,100 → 650,500: measure it.
    const marquee = await selectionBounds(page);
    expect(marquee, 'marquee selection').not.toBeNull();
    expect(Math.abs(marquee!.x - 150), JSON.stringify(marquee)).toBeLessThanOrEqual(2);
    expect(Math.abs(marquee!.y - 100), JSON.stringify(marquee)).toBeLessThanOrEqual(2);
    expect(Math.abs(marquee!.width - 500), JSON.stringify(marquee)).toBeLessThanOrEqual(3);
    expect(Math.abs(marquee!.height - 400), JSON.stringify(marquee)).toBeLessThanOrEqual(3);

    const layerId = (await getEditorState(page)).document.activeLayerId;
    const undoBefore = (await getEditorState(page)).undoStackLength;

    await page.keyboard.press('v');
    await page.locator('button:has-text("Mesh Warp")').click();
    await expect(page.locator('[role="group"][aria-label="Mesh warp controls"]')).toBeVisible();
    const sessionBounds = await meshWarpBounds(page);
    expect(sessionBounds).toEqual(marquee);

    // Doc (400, 300) sits between the 4 × 4 grid's handles (at thirds of the box).
    await dragDoc(page, 400, 300, 460, 360);
    // An arrow-key nudge is ignored too.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/mesh-warp-off-handle-1508.png' });

    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore);
    expect(await meshWarpBounds(page)).toEqual(sessionBounds);
    // The red rectangle has not moved: its top-left corner is still red,
    // and the area a (60, 60) move would have filled is still empty.
    expect((await getPixelAt(page, 202, 152, layerId)).r).toBe(255);
    expect((await getPixelAt(page, 202, 152, layerId)).a).toBe(255);
    expect((await getPixelAt(page, 620, 470, layerId)).a).toBe(0);

    await page.locator('[role="group"][aria-label="Mesh warp controls"]').locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
    expect(await meshWarpBounds(page)).toBeNull();
    expect((await getPixelAt(page, 202, 152, layerId)).a).toBe(255);
    expect((await getPixelAt(page, 597, 447, layerId)).a).toBe(255);
    expect((await getPixelAt(page, 620, 470, layerId)).a).toBe(0);
  });
});
