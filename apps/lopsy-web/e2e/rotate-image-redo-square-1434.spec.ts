import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, redo, selectTool, setForegroundColor, undo, waitForStore } from './helpers';

// #1434: Image → Rotate 90° turned every raster layer on the GPU but never
// marked them dirty. On a square document a full-canvas layer keeps its
// position and size through the turn, so the redo snapshot taken by Undo
// reused its pre-rotate texture handle and Redo restored it unrotated.

interface Box { minX: number; minY: number; maxX: number; maxY: number }

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(300);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, x0, y0, x1, y1);
  await setForegroundColor(page, ...rgb);
  await menu(page, 'Edit', /^Fill$/);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

/** Doc-space bounding box of a layer's opaque pixels, read from its GPU texture. */
async function opaqueBox(page: Page, layerId: string): Promise<Box | null> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    };
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const read = await w.__readLayerPixels(lid);
    if (!read) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let y = 0; y < read.height; y++) {
      for (let x = 0; x < read.width; x++) {
        if (read.pixels[(y * read.width + x) * 4 + 3]! < 128) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    if (minX === Infinity) return null;
    return { minX: minX + layer.x, minY: minY + layer.y, maxX: maxX + layer.x, maxY: maxY + layer.y };
  }, layerId);
}

function near(box: Box | null, expected: Box): void {
  expect(box).not.toBeNull();
  for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(Math.abs(box![k] - expected[k]), `${k}: ${box![k]} vs ${expected[k]}`).toBeLessThanOrEqual(2);
  }
}

test.describe('Rotate Image 90° redo on a square document (#1434)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('redo restores every layer rotated, including the active one', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const lowerId = await addLayer(page);
    await fillRect(page, 20, 20, 150, 60, [0, 0, 255]);
    const upperId = await addLayer(page);
    await fillRect(page, 250, 300, 380, 380, [255, 0, 0]);

    const lowerBefore = await opaqueBox(page, lowerId);
    const upperBefore = await opaqueBox(page, upperId);
    expect(lowerBefore).not.toBeNull();
    expect(upperBefore).not.toBeNull();

    // A CW turn on a W×H document maps (x, y) → (H - 1 - y, x).
    const turn = (b: Box): Box => ({ minX: 399 - b.maxY, minY: b.minX, maxX: 399 - b.minY, maxY: b.maxX });
    const lowerTurned = turn(lowerBefore!);
    const upperTurned = turn(upperBefore!);

    await menu(page, 'Image', /^Rotate 90° CW/);
    near(await opaqueBox(page, lowerId), lowerTurned);
    near(await opaqueBox(page, upperId), upperTurned);

    await undo(page);
    await page.waitForTimeout(300);
    near(await opaqueBox(page, lowerId), lowerBefore!);
    near(await opaqueBox(page, upperId), upperBefore!);

    await redo(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/rotate-image-redo-square-1434.png' });
    near(await opaqueBox(page, lowerId), lowerTurned);
    near(await opaqueBox(page, upperId), upperTurned);

    // Clicking another layer row must not bring the stale texture back.
    await page.locator(`[data-layer-id="${lowerId}"]`).click();
    await page.waitForTimeout(300);
    near(await opaqueBox(page, upperId), upperTurned);
  });
});
