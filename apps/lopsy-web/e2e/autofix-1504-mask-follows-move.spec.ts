import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  setForegroundColor,
} from './helpers';

/**
 * #1504 — moving a layer with a layer mask moved the pixels but left the
 * mask behind, so the part the mask hid showed up and the part it showed
 * was hidden. The same happened for arrow-key nudges and for moving a
 * group that holds the masked layer.
 *
 * Setup on a 400 × 300 white document: a red card at x 50–349 on
 * Layer 1, and a mask that hides its left half (x 50–199), so only
 * x 200–349 shows red.
 */

const RED: [number, number, number] = [255, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];

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
    const mask = store.getState().document.layers.find((l) => l.id === lid)?.mask;
    if (!mask) return -1;
    return mask.data[y * mask.width + x] ?? -1;
  }, { lid: layerId, x, y });
}

/** Builds the half-masked red card on Layer 1 and returns its id. */
async function buildMaskedCard(page: Page): Promise<string> {
  const layerId = (await getEditorState(page)).document.activeLayerId;
  await setForegroundColor(page, 255, 0, 0);
  await page.keyboard.press('m');
  await dragDoc(page, 50, 50, 350, 250);
  await editFill(page);
  await page.keyboard.press('Control+d');

  await page.locator('[aria-label="Add Mask"]').click();
  await page.locator('[aria-label="Edit mask for Layer 1"]').click();
  await page.waitForTimeout(100);
  await dragDoc(page, 50, 50, 200, 250);
  await setForegroundColor(page, 0, 0, 0);
  await editFill(page);
  await page.keyboard.press('Control+d');
  // Leave mask edit mode.
  await page.locator(`[data-layer-id="${layerId}"]`).click();
  await page.waitForTimeout(150);

  expectNear(await compositeAt(page, 120, 150), WHITE);
  expectNear(await compositeAt(page, 260, 150), RED);
  return layerId;
}

test.describe('Layer mask follows a whole-layer move (#1504)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('a Move drag and an arrow nudge carry the mask with the layer', async ({ page }) => {
    const layerId = await buildMaskedCard(page);

    // Drag the card 50 px right: the card spans x 100–399 and the mask's
    // hidden half x 100–249, so red shows from x 250.
    await page.keyboard.press('v');
    await dragDoc(page, 300, 150, 350, 150);
    await page.screenshot({ path: 'e2e/screenshots/mask-follows-move-1504-drag.png' });
    expectNear(await compositeAt(page, 230, 150), WHITE);
    expectNear(await compositeAt(page, 245, 150), WHITE);
    expectNear(await compositeAt(page, 255, 150), RED);
    expectNear(await compositeAt(page, 390, 150), RED);
    await expect.poll(() => maskByteAt(page, layerId, 240, 150)).toBe(0);
    expect(await maskByteAt(page, layerId, 255, 150)).toBe(255);

    // Shift+→ nudges 10 px: red now starts at x 260.
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/mask-follows-move-1504-nudge.png' });
    expectNear(await compositeAt(page, 255, 150), WHITE);
    expectNear(await compositeAt(page, 265, 150), RED);

    // Undo both moves: mask and pixels go back together.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expectNear(await compositeAt(page, 190, 150), WHITE);
    expectNear(await compositeAt(page, 210, 150), RED);
    expectNear(await compositeAt(page, 360, 150), WHITE);
  });

  test('moving a group carries the masks of the layers inside it', async ({ page }) => {
    await buildMaskedCard(page);

    await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Layer', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Group Layers/ }).click();
    await page.waitForTimeout(200);
    const groupId = (await getEditorState(page)).document.activeLayerId;
    const group = (await getEditorState(page)).document.layers.find((l) => l.id === groupId) as unknown as { type: string };
    expect(group.type).toBe('group');

    await page.keyboard.press('v');
    await dragDoc(page, 300, 150, 350, 150);
    await page.screenshot({ path: 'e2e/screenshots/mask-follows-move-1504-group.png' });
    expectNear(await compositeAt(page, 230, 150), WHITE);
    expectNear(await compositeAt(page, 255, 150), RED);
    expectNear(await compositeAt(page, 390, 150), RED);
  });
});
