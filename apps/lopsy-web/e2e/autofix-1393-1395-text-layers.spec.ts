import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, selectTool, setToolOption, undo, waitForStore } from './helpers';

/*
 * #1395 — Color LUT, Mesh Warp and Tilt-Shift Blur on a live text layer
 * expanded it to the document and re-origined it to (0, 0); the next text
 * edit then re-rendered the type in the canvas corner. They now refuse a text
 * layer with the layer-type toast, like every other filter.
 *
 * #1393 — Delete Path left text bound to it with a dangling pathId, freezing
 * it: later edits never rendered and the Path dropdown vanished. Deleting the
 * path now unbinds the text back to straight text at its pre-bind anchor.
 */

const SHOTS = 'e2e/screenshots';
const TEXT_TOAST = 'Text layers must be rasterized before they can be painted on.';

interface TextInfo { id: string; x: number; y: number; fontSize: number; pathId?: string }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

async function textLayer(page: Page): Promise<TextInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<TextInfo & { type: string }> } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text')!;
    return { id: l.id, x: l.x, y: l.y, fontSize: l.fontSize, pathId: l.pathId };
  });
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((h) => h.label);
  });
}

/** Opaque-pixel bounding box of a layer in document coordinates. */
async function opaqueBounds(page: Page, id: string): Promise<Bounds> {
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
    const ox = layer?.x ?? 0;
    const oy = layer?.y ?? 0;
    return { minX: minX + ox, maxX: maxX + ox, minY: minY + oy, maxY: maxY + oy };
  }, id);
}

async function dragDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function typeText(page: Page, size: number, at: [number, number], text: string): Promise<void> {
  await page.keyboard.press('t');
  await setToolOption(page, 'Size', size);
  const p = await docToScreen(page, at[0], at[1]);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

async function openFilterItem(page: Page, label: string): Promise<void> {
  await page.click('text=Filter');
  await page.waitForTimeout(200);
  const item = page.getByText(label, { exact: true });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await page.waitForTimeout(300);
}

async function resizeText(page: Page, size: number): Promise<void> {
  await page.keyboard.press('t');
  await setToolOption(page, 'Size', size);
  await page.waitForTimeout(400);
}

test.describe('#1395 — pixel sessions refuse a live text layer', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options bar and filter menu require desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1200, 800, false);
    await page.waitForTimeout(300);
    await typeText(page, 160, [300, 300], 'HELLO');
  });

  /** A Size edit must keep the text near where it was typed, not the corner. */
  async function expectTextStaysPut(page: Page, before: Bounds, shot: string): Promise<void> {
    const layer = await textLayer(page);
    await resizeText(page, 150);
    expect((await textLayer(page)).fontSize).toBe(150);
    const after = await opaqueBounds(page, layer.id);
    await page.screenshot({ path: `${SHOTS}/${shot}` });
    expect(Math.abs(after.minX - before.minX)).toBeLessThan(30);
    expect(Math.abs(after.minY - before.minY)).toBeLessThan(30);
  }

  test('Color LUT shows the toast and leaves the layer in place', async ({ page }) => {
    const typed = await textLayer(page);
    const before = await opaqueBounds(page, typed.id);
    expect(before.minX).toBeGreaterThan(250);
    const history = await historyLabels(page);

    await openFilterItem(page, 'Color LUT...');
    const dialog = page.locator('h2:has-text("Color LUT")');
    await expect(dialog).toBeVisible();
    await page.locator('button:has(canvas)').nth(1).click();
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(400);

    await expect(page.getByText(TEXT_TOAST).first()).toBeVisible();
    expect(await historyLabels(page)).toEqual(history);
    const after = await textLayer(page);
    expect(after.x).toBe(typed.x);
    expect(after.y).toBe(typed.y);

    await expectTextStaysPut(page, before, 'autofix-1395-color-lut.png');
  });

  test('Mesh Warp will not activate on a text layer', async ({ page }) => {
    const typed = await textLayer(page);
    const before = await opaqueBounds(page, typed.id);

    await selectTool(page, 'move');
    await page.locator('button[aria-label="Activate mesh warp"]').click();
    await page.waitForTimeout(200);

    await expect(page.getByText(TEXT_TOAST).first()).toBeVisible();
    await expect(page.locator('[role="group"][aria-label="Mesh warp controls"]')).toHaveCount(0);
    const after = await textLayer(page);
    expect(after.x).toBe(typed.x);
    expect(after.y).toBe(typed.y);

    await expectTextStaysPut(page, before, 'autofix-1395-mesh-warp.png');
  });

  test('Tilt-Shift Blur will not start on a text layer', async ({ page }) => {
    const typed = await textLayer(page);
    const before = await opaqueBounds(page, typed.id);

    await openFilterItem(page, 'Tilt-Shift Blur...');

    await expect(page.getByText(TEXT_TOAST).first()).toBeVisible();
    const after = await textLayer(page);
    expect(after.x).toBe(typed.x);
    expect(after.y).toBe(typed.y);

    await expectTextStaysPut(page, before, 'autofix-1395-tilt-shift.png');
  });
});

test.describe('#1393 — Delete Path unbinds text that follows it', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'paths panel and text options bar require desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
  });

  test('the text returns to straight text and later edits render', async ({ page }) => {
    await page.keyboard.press('p');
    await dragDoc(page, [150, 400], [250, 200]);
    const end = await docToScreen(page, 650, 400);
    await page.mouse.click(end.x, end.y);
    await page.waitForTimeout(120);
    await page.locator('[aria-label="Commit path"]').click();
    await page.waitForTimeout(200);

    await typeText(page, 40, [200, 480], 'HELLO PATH TEXT');
    const straight = await textLayer(page);
    const straightBounds = await opaqueBounds(page, straight.id);

    const pathSelect = page.locator('[aria-label="Text path"]');
    const pathId = await pathSelect.locator('option').nth(1).getAttribute('value');
    await pathSelect.selectOption(pathId!);
    await expect.poll(async () => (await textLayer(page)).pathId, { timeout: 15000 }).toBe(pathId);
    await expect
      .poll(async () => (await opaqueBounds(page, straight.id)).minY, { timeout: 15000 })
      .toBeLessThan(straightBounds.minY - 50);

    const list = page.locator('[role="listbox"][aria-label="Paths"]');
    if (!(await list.isVisible())) {
      await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
    }
    const row = list.locator('[data-testid^="path-item-"]').first();
    if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page.locator('button[aria-label="Delete Path"]').click();
    await page.waitForTimeout(400);

    const unbound = await textLayer(page);
    expect(unbound.pathId).toBeUndefined();
    const unboundBounds = await opaqueBounds(page, unbound.id);
    await page.screenshot({ path: `${SHOTS}/autofix-1393-unbound.png` });
    // Back on its pre-bind baseline, not on the arc.
    expect(Math.abs(unboundBounds.minX - straightBounds.minX)).toBeLessThan(4);
    expect(Math.abs(unboundBounds.minY - straightBounds.minY)).toBeLessThan(4);

    await resizeText(page, 70);
    const resized = await textLayer(page);
    expect(resized.fontSize).toBe(70);
    const resizedBounds = await opaqueBounds(page, resized.id);
    await page.screenshot({ path: `${SHOTS}/autofix-1393-resized.png` });
    expect(resizedBounds.maxX - resizedBounds.minX)
      .toBeGreaterThan((unboundBounds.maxX - unboundBounds.minX) * 1.4);
    expect(Math.abs(resizedBounds.minX - unboundBounds.minX)).toBeLessThan(30);

    // Undo the Size change and the delete: the path and its binding come back.
    await undo(page);
    await page.waitForTimeout(300);
    await undo(page);
    await page.waitForTimeout(400);
    await expect(list.locator('[data-testid^="path-item-"]')).toHaveCount(1);
    expect((await textLayer(page)).pathId).toBe(pathId);
  });
});
