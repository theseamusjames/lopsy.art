import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';

// #1655: #1429 snapped the Pencil's press to the pixel under the pointer,
// but drag moves still used the rounded position, so a drag in the
// lower-right half of a pixel stepped one pixel right/down after its
// first pixel.

interface PaintedPixel { x: number; y: number }

async function paintedPixels(page: Page, layerId: string): Promise<PaintedPixel[]> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    };
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const read = await w.__readLayerPixels(lid);
    const out: Array<{ x: number; y: number }> = [];
    if (!read) return out;
    for (let y = 0; y < read.height; y++) {
      for (let x = 0; x < read.width; x++) {
        if (read.pixels[(y * read.width + x) * 4 + 3]! > 128) out.push({ x: x + layer.x, y: y + layer.y });
      }
    }
    return out;
  }, layerId);
}

async function zoomIn(page: Page): Promise<void> {
  const centre = await docToScreen(page, 50, 40);
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
}

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('Pencil drag follows the pixel under the pointer (#1655)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('a horizontal drag stays on the row under the cursor', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 80, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'pencil');
    await setToolOption(page, 'Size', 1);
    await zoomIn(page);

    for (const [f, row] of [[0.25, 32], [0.75, 38]] as const) {
      const layerId = await addLayer(page);
      await dragDoc(page, { x: 40 + f, y: row + f }, { x: 46 + f, y: row + f });
      const pixels = await paintedPixels(page, layerId);
      expect(new Set(pixels.map((p) => p.y)), `fraction ${f}`).toEqual(new Set([row]));
      expect(Math.min(...pixels.map((p) => p.x)), `fraction ${f}`).toBe(40);
      expect(Math.max(...pixels.map((p) => p.x)), `fraction ${f}`).toBe(46);
      expect(pixels.length, `fraction ${f}`).toBe(7);
    }

    await page.screenshot({ path: 'e2e/screenshots/pencil-drag-pixel-under-pointer-1655.png' });
  });
});
