import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';

// #1429: pointer positions are rounded to the nearest integer, so a Pencil
// click in the right or bottom half of a pixel painted the pixel to the
// right of / below the one under the cursor.

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

async function viewportZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number } };
    };
    return store.getState().viewport.zoom;
  });
}

async function clickDoc(page: Page, x: number, y: number, isShift = false): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.move(p.x, p.y);
  if (isShift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.up();
  if (isShift) await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
}

test.describe('Pencil paints the pixel under the pointer (#1429)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('clicks anywhere inside a pixel paint that pixel', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 80, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'pencil');
    await setToolOption(page, 'Size', 1);
    await zoomIn(page);
    expect(await viewportZoom(page)).toBeGreaterThan(6);

    for (const f of [0.1, 0.35, 0.65, 0.9]) {
      const layerId = await addLayer(page);
      await clickDoc(page, 40 + f, 30 + f);
      expect(await paintedPixels(page, layerId), `fraction ${f}`).toEqual([{ x: 40, y: 30 }]);
    }

    await page.screenshot({ path: 'e2e/screenshots/pencil-pixel-under-pointer-1429.png' });
  });

  test('a Shift+click line through pixel centres stays on that row', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 80, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'pencil');
    await setToolOption(page, 'Size', 1);
    await zoomIn(page);

    const layerId = await addLayer(page);
    await clickDoc(page, 44.5, 35.5);
    await clickDoc(page, 56.5, 35.5, true);

    const pixels = await paintedPixels(page, layerId);
    expect(pixels.length).toBe(13);
    expect(new Set(pixels.map((p) => p.y))).toEqual(new Set([35]));
    expect(Math.min(...pixels.map((p) => p.x))).toBe(44);
    expect(Math.max(...pixels.map((p) => p.x))).toBe(56);
  });
});
