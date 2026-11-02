import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, undo, waitForStore } from './helpers';

// #1423: undoing a Pen anchor move or Delete Path restored the path and the
// text's path anchor but kept the layer's live x/y, so the reflow read the
// gap as a deliberate offset and the text floated off the restored path.

interface TextInfo { id: string; x: number; y: number; pathId?: string; pathAnchorX?: number; pathAnchorY?: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

async function textLayer(page: Page): Promise<TextInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<TextInfo & { type: string }> } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text')!;
    return { id: l.id, x: l.x, y: l.y, pathId: l.pathId, pathAnchorX: l.pathAnchorX, pathAnchorY: l.pathAnchorY };
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

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
}

async function dragDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function selectOnlyPath(page: Page): Promise<void> {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible())) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
  }
  const row = list.locator('[data-testid^="path-item-"]').first();
  if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
}

/** Pen path 150,400 → 400,280 → 650,400, then text bound to it. Returns the on-path bounds. */
async function bindTextToArch(page: Page): Promise<{ id: string; bounds: Bounds }> {
  await page.keyboard.press('p');
  await clickDoc(page, 150, 400);
  await clickDoc(page, 400, 280);
  await clickDoc(page, 650, 400);
  await page.locator('[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);

  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 40);
  await clickDoc(page, 100, 60);
  await page.keyboard.type('HELLO PATH TEXT');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const straight = await textLayer(page);
  const straightBounds = await opaqueBounds(page, straight.id);

  const pathSelect = page.locator('[aria-label="Text path"]');
  const pathId = await pathSelect.locator('option').nth(1).getAttribute('value');
  await pathSelect.selectOption(pathId!);
  await expect.poll(async () => (await textLayer(page)).pathId, { timeout: 15000 }).toBe(pathId);
  await expect
    .poll(async () => (await opaqueBounds(page, straight.id)).minY, { timeout: 15000 })
    .toBeGreaterThan(straightBounds.minY + 100);
  await page.waitForTimeout(300);
  return { id: straight.id, bounds: await opaqueBounds(page, straight.id) };
}

function expectSameBounds(actual: Bounds, expected: Bounds): void {
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(Math.abs(actual[k] - expected[k]), `${k}: ${actual[k]} vs ${expected[k]}`).toBeLessThanOrEqual(3);
  }
}

async function expectNoOffsetFromPath(page: Page): Promise<void> {
  const l = await textLayer(page);
  expect(l.pathId).toBeDefined();
  expect(l.x - l.pathAnchorX!).toBe(0);
  expect(l.y - l.pathAnchorY!).toBe(0);
}

test.describe('Undo puts path-bound text back on its path (#1423)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'paths panel and text options bar require desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
  });

  test('undoing a Pen anchor move', async ({ page }) => {
    const { id, bounds: onPath } = await bindTextToArch(page);

    await page.keyboard.press('p');
    await selectOnlyPath(page);
    await dragDoc(page, [400, 280], [400, 180]);
    await expect
      .poll(async () => (await opaqueBounds(page, id)).minY, { timeout: 15000 })
      .toBeLessThan(onPath.minY - 50);

    await undo(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/path-text-undo-anchor-move-1423.png' });

    await expectNoOffsetFromPath(page);
    expectSameBounds(await opaqueBounds(page, id), onPath);
  });

  test('undoing Delete Path', async ({ page }) => {
    const { id, bounds: onPath } = await bindTextToArch(page);

    await selectOnlyPath(page);
    await page.locator('button[aria-label="Delete Path"]').click();
    await page.waitForTimeout(400);
    expect((await textLayer(page)).pathId).toBeUndefined();

    await undo(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/path-text-undo-delete-path-1423.png' });

    await expectNoOffsetFromPath(page);
    expectSameBounds(await opaqueBounds(page, id), onPath);
  });
});
