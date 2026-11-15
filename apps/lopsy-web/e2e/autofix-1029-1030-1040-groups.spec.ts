/**
 * #1029 — a Normal group's opacity (and blend mode) was ignored unless the
 *         group also had adjustments or a mask.
 * #1040 — groups had no Blend control: the drawer showed Adjustments only.
 * #1030 — Group Layers on a Shift-range spanning an expanded group emptied
 *         that group.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
} from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): Promise<void> {
  await page.keyboard.press('m');
  await dragMarquee(page, x0, y0, x1, y1);
  await setForegroundColor(page, ...rgb);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
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

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId!;
}

async function layerById(page: Page, id: string): Promise<{ blendMode: string; opacity: number; children?: string[] }> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; blendMode: string; opacity: number; children?: string[] }> } };
    };
    const l = store.getState().document.layers.find((x) => x.id === lid)!;
    return { blendMode: l.blendMode, opacity: l.opacity, children: l.children ? [...l.children] : undefined };
  }, id);
}

function expectNear(actual: [number, number, number], expected: [number, number, number], tol = 4): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tol);
}

test.describe('Group compositing and controls', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layers panel and menus need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
  });

  test('#1029 a Normal group at 40% opacity renders its children at 40%', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    await fillRect(page, 300, 200, 450, 350, [40, 160, 60]);

    expectNear(await compositeAt(page, 375, 275), [40, 160, 60]);

    const row = page.locator(`[data-layer-id="${groupId}"]`);
    await row.locator('button[aria-label^="Opacity"]').click();
    await page.locator('input[type="range"][aria-label="Group opacity"]').fill('40');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect((await layerById(page, groupId)).opacity).toBeCloseTo(0.4, 2);

    // 40% green over white: 255 + 0.4 * (c - 255).
    expectNear(await compositeAt(page, 375, 275), [169, 217, 177]);
  });

  test('#1040 the group drawer has a Blend control with Pass Through, and the mode renders', async ({ page }) => {
    // Blue on Layer 1 below the group.
    await fillRect(page, 100, 100, 400, 400, [0, 0, 255]);

    await page.locator('[aria-label="New Group"]').click();
    const groupId = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    // Red inside the group, overlapping the blue on the right half.
    await fillRect(page, 250, 100, 550, 400, [255, 0, 0]);
    expectNear(await compositeAt(page, 325, 250), [255, 0, 0]);

    await page.locator(`[data-layer-id="${groupId}"]`).click();
    await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label^="Group effects"]').click();
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer.locator('[aria-label="Add Adjustment"]')).toBeVisible();
    const select = drawer.locator('[aria-labelledby="blend-mode-label"]');
    await expect(select).toBeVisible();
    await expect(select.locator('option[value="pass-through"]')).toHaveCount(1);

    await select.selectOption('multiply');
    await page.waitForTimeout(200);
    expect((await layerById(page, groupId)).blendMode).toBe('multiply');
    // Red multiplied with blue is black; red over white stays red.
    expectNear(await compositeAt(page, 325, 250), [0, 0, 0]);
    expectNear(await compositeAt(page, 500, 250), [255, 0, 0]);

    await select.selectOption('pass-through');
    await page.waitForTimeout(200);
    expect((await layerById(page, groupId)).blendMode).toBe('pass-through');
    expectNear(await compositeAt(page, 325, 250), [255, 0, 0]);

    // Undo restores the previous mode.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect((await layerById(page, groupId)).blendMode).toBe('multiply');
  });

  test('#1030 Group Layers on a Shift-range over an expanded group keeps its children', async ({ page }) => {
    const layer1 = await activeLayerId(page);
    await fillRect(page, 50, 200, 200, 350, [200, 40, 40]);
    await page.locator('[aria-label="Add Layer"]').click();
    const layer4 = await activeLayerId(page);
    await fillRect(page, 300, 200, 450, 350, [40, 160, 60]);
    await page.locator('[aria-label="Add Layer"]').click();
    const layer5 = await activeLayerId(page);
    await fillRect(page, 550, 200, 700, 350, [40, 60, 200]);

    await page.locator(`[data-layer-id="${layer4}"]`).click();
    await page.locator(`[data-layer-id="${layer5}"]`).click({ modifiers: ['Shift'] });
    await page.click('button:has-text("Layer")');
    await page.getByRole('menuitem', { name: /^Group Layers/ }).click();
    await page.waitForTimeout(200);
    const innerGroup = await activeLayerId(page);
    expect((await layerById(page, innerGroup)).children).toEqual([layer4, layer5]);

    // Shift-range from Layer 1 up to the expanded group row.
    await page.locator(`[data-layer-id="${layer1}"]`).click();
    await page.locator(`[data-layer-id="${innerGroup}"]`).click({ modifiers: ['Shift'] });
    const selected = (await getEditorState(page)).document.selectedLayerIds;
    expect(selected).toEqual(expect.arrayContaining([layer1, layer4, layer5, innerGroup]));

    await page.click('button:has-text("Layer")');
    await page.getByRole('menuitem', { name: /^Group Layers/ }).click();
    await page.waitForTimeout(200);

    const outerGroup = await activeLayerId(page);
    expect((await layerById(page, outerGroup)).children).toEqual([layer1, innerGroup]);
    expect((await layerById(page, innerGroup)).children).toEqual([layer4, layer5]);
    // Nothing moved on the canvas.
    expectNear(await compositeAt(page, 125, 275), [200, 40, 40]);
    expectNear(await compositeAt(page, 375, 275), [40, 160, 60]);
    expectNear(await compositeAt(page, 625, 275), [40, 60, 200]);
  });
});
