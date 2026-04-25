import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width = 200, height = 200, transparent = true) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function paintRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number },
  layerId?: string,
) {
  await page.evaluate(
    ({ x, y, w, h, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
          const idx = (py * data.width + px) * 4;
          data.data[idx] = color.r;
          data.data[idx + 1] = color.g;
          data.data[idx + 2] = color.b;
          data.data[idx + 3] = color.a;
        }
      }
      state.updateLayerPixelData(id, data);
    },
    { x, y, w, h, color, lid: layerId ?? null },
  );
  await page.waitForTimeout(100);
}

async function getLayerPosition(page: Page, layerId?: string) {
  return page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            layers: Array<{ id: string; x: number; y: number }>;
          };
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const layer = state.document.layers.find((l) => l.id === id);
      if (!layer) return { x: 0, y: 0 };
      return { x: layer.x, y: layer.y };
    },
    layerId ?? null,
  );
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    ({ x, y, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => ImageData | undefined;
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const data = pixelData.get(id);
      if (!data) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (y * data.width + x) * 4;
      return {
        r: data.data[idx] ?? 0,
        g: data.data[idx + 1] ?? 0,
        b: data.data[idx + 2] ?? 0,
        a: data.data[idx + 3] ?? 0,
      };
    },
    { x, y, lid: layerId ?? null },
  );
}

async function clickAlignButton(page: Page, label: string) {
  await page.click(`button[aria-label="${label}"]`);
  await page.waitForTimeout(100);
}

async function selectMoveTool(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('move');
  });
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, transparent: boolean) => void };
    };
    store.getState().createDocument(200, 200, true);
  });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await selectMoveTool(page);
});

// ---------------------------------------------------------------------------
// Alignment tests — verify layer position moves correctly
// ---------------------------------------------------------------------------

test.describe('Align layer content', () => {
  test('align left moves content to left edge', async ({ page }) => {
    // Paint a 20x20 block at (50,50) within the 200x200 layer
    await paintRect(page, 50, 50, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align left');

    const pos = await getLayerPosition(page);
    // Auto-crop shrinks layer to 20x20 at (50,50). Content bounds = (50,50,20,20).
    // Align left: relX = 50-50 = 0, x = -0 = 0. y unchanged from 50.
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(50);
  });

  test('align right moves content to right edge', async ({ page }) => {
    await paintRect(page, 50, 50, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align right');

    const pos = await getLayerPosition(page);
    // Auto-crop shrinks layer to 20x20 at (50,50). Content bounds = (50,50,20,20).
    // Align right: relX = 50-50 = 0, x = 200-20-0 = 180. y unchanged from 50.
    expect(pos.x).toBe(180);
    expect(pos.y).toBe(50);
  });

  test('align top moves content to top edge', async ({ page }) => {
    await paintRect(page, 50, 50, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align top');

    const pos = await getLayerPosition(page);
    // Auto-crop shrinks layer to 20x20 at (50,50). Align top: relY=0, y=0. x unchanged from 50.
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(0);
  });

  test('align bottom moves content to bottom edge', async ({ page }) => {
    await paintRect(page, 50, 50, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align bottom');

    const pos = await getLayerPosition(page);
    // Auto-crop shrinks layer to 20x20 at (50,50). Align bottom: relY=0, y=200-20=180. x unchanged from 50.
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(180);
  });

  test('align center horizontally', async ({ page }) => {
    await paintRect(page, 50, 50, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align center horizontally');

    const pos = await getLayerPosition(page);
    // Auto-crop shrinks layer to 20x20 at (50,50). Center-h: relX=0, x=(200-20)/2=90. y unchanged from 50.
    expect(pos.x).toBe(90);
    expect(pos.y).toBe(50);
  });

  test('align center vertically', async ({ page }) => {
    await paintRect(page, 50, 50, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align center vertically');

    const pos = await getLayerPosition(page);
    // Auto-crop shrinks layer to 20x20 at (50,50). Center-v: relY=0, y=(200-20)/2=90. x unchanged from 50.
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(90);
  });

  test('pixel data moves with the layer', async ({ page }) => {
    // Paint red block at (10,10) — auto-crop shrinks layer to 20x20 at (10,10)
    await paintRect(page, 10, 10, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await clickAlignButton(page, 'Align left');

    const pos = await getLayerPosition(page);
    // Auto-crop: layer at (10,10), 20x20. Align left: x=0, y=10.
    expect(pos.x).toBe(0);

    // After crop, pixel data is 20x20 — content fills the entire cropped data.
    // Pixel at local (10,10) is within the 20x20 block and should be red.
    const pixel = await getPixelAt(page, 10, 10);
    expect(pixel.r).toBe(255);
    expect(pixel.a).toBe(255);

    // After crop, local (0,0) IS part of the red content (the entire 20x20 is red)
    const originPixel = await getPixelAt(page, 0, 0);
    expect(originPixel.r).toBe(255);
    expect(originPixel.a).toBe(255);
  });

  test('align only moves content, does not modify pixels', async ({ page }) => {
    // Paint 40x40 green block at (30,30) — auto-crop shrinks to 40x40 at (30,30)
    await paintRect(page, 30, 30, 40, 40, { r: 0, g: 255, b: 0, a: 255 });

    // After crop, pixel data is 40x40. Check pixel at local (20,20) — within the green block.
    const beforePixel = await getPixelAt(page, 20, 20);
    expect(beforePixel.g).toBe(255);
    expect(beforePixel.a).toBe(255);

    await clickAlignButton(page, 'Align right');

    // Pixel data in layer-local coords should be unchanged after align
    const afterPixel = await getPixelAt(page, 20, 20);
    expect(afterPixel.g).toBe(255);
    expect(afterPixel.a).toBe(255);
  });

  test('align with full-layer content', async ({ page }) => {
    // Fill entire 200x200 layer
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 255, b: 0, a: 255 });

    await clickAlignButton(page, 'Align left');

    // Content fills entire layer, so no movement needed
    const pos = await getLayerPosition(page);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  test('sequential alignments compose correctly', async ({ page }) => {
    await paintRect(page, 80, 80, 20, 20, { r: 255, g: 0, b: 255, a: 255 });

    // Align to top-left corner
    await clickAlignButton(page, 'Align left');
    await clickAlignButton(page, 'Align top');

    const pos = await getLayerPosition(page);
    // Auto-crop: layer at (80,80), 20x20.
    // After align-left: x=0, y=80
    // After align-top: x=0, y=0
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  test('align to bottom-right corner', async ({ page }) => {
    await paintRect(page, 10, 10, 30, 30, { r: 0, g: 0, b: 255, a: 255 });

    await clickAlignButton(page, 'Align right');
    await clickAlignButton(page, 'Align bottom');

    const pos = await getLayerPosition(page);
    // Auto-crop: layer at (10,10), 30x30.
    // Align right: relX=0, x=200-30=170. y=10.
    // Align bottom: relY=0, y=200-30=170. x=170.
    expect(pos.x).toBe(170);
    expect(pos.y).toBe(170);
  });

  test('center both axes', async ({ page }) => {
    await paintRect(page, 0, 0, 40, 60, { r: 128, g: 128, b: 128, a: 255 });

    await clickAlignButton(page, 'Align center horizontally');
    await clickAlignButton(page, 'Align center vertically');

    const pos = await getLayerPosition(page);
    // Content at (0,0) size 40x60
    // Center h: layer.x = (200-40)/2 - 0 = 80
    // Center v: layer.y = (200-60)/2 - 0 = 70
    expect(pos.x).toBe(80);
    expect(pos.y).toBe(70);
  });
});
