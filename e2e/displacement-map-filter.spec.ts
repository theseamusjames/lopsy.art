import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 400, transparent = false) {
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

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function readPixel(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    async ({ px, py, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: { id: string; x: number; y: number }[] } };
      };
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn(lid ?? undefined);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      let lx = px;
      let ly = py;
      if (lid) {
        const layer = store.getState().document.layers.find((l) => l.id === lid);
        if (layer) {
          lx = px - layer.x;
          ly = py - layer.y;
        }
      }
      if (lx < 0 || ly < 0 || lx >= result.width || ly >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (ly * result.width + lx) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    },
    { px: x, py: y, lid: layerId ?? null },
  );
}

async function getActiveLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

function paintLayerPattern(
  page: Page,
  layerId: string,
  paintFn: string,
) {
  return page.evaluate(
    ({ id, fn }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      state.pushHistory('Paint');
      const data = state.getOrCreateLayerPixelData(id);
      const W = data.width;
      const H = data.height;
      const paintFunction = new Function('data', 'W', 'H', fn);
      paintFunction(data, W, H);
      state.updateLayerPixelData(id, data);
    },
    { id: layerId, fn: paintFn },
  );
}

test.describe('Displacement Map Filter', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'displacement map requires sidebar and menu bar');
    await page.goto('/');
    await waitForStore(page);
  });

  test('displaces pixels using another layer as displacement source', async ({ page }) => {
    await createDocument(page, 400, 400, true);

    const layer1Id = await getActiveLayerId(page);

    // Paint active layer: left half red, right half blue
    await paintLayerPattern(page, layer1Id, `
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          if (x < W / 2) {
            data.data[idx] = 255; data.data[idx+1] = 0; data.data[idx+2] = 0; data.data[idx+3] = 255;
          } else {
            data.data[idx] = 0; data.data[idx+1] = 0; data.data[idx+2] = 255; data.data[idx+3] = 255;
          }
        }
      }
    `);
    await page.waitForTimeout(300);

    // Add a second layer for the displacement map
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(300);

    const dispLayerId = await getActiveLayerId(page);

    // Paint displacement layer: uniform red=255, green=128
    // Red channel: (255/255 - 0.5) * 2 = +1.0 → offset = +scaleX
    // Green channel: (128/255 - 0.5) * 2 ≈ 0.0 → no vertical shift
    await paintLayerPattern(page, dispLayerId, `
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          data.data[idx] = 255; data.data[idx+1] = 128; data.data[idx+2] = 0; data.data[idx+3] = 255;
        }
      }
    `);
    await page.waitForTimeout(300);

    // Select the first layer (the one to be displaced)
    await page.locator(`[data-layer-id="${layer1Id}"]`).click();
    await page.waitForTimeout(200);

    await fitToView(page);

    // Verify before state
    const beforeLeft = await readPixel(page, 150, 200, layer1Id);
    const beforeRight = await readPixel(page, 250, 200, layer1Id);
    expect(beforeLeft.r).toBe(255);
    expect(beforeLeft.b).toBe(0);
    expect(beforeRight.r).toBe(0);
    expect(beforeRight.b).toBe(255);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'displacement-map-before.png') });

    // Open Filter > Displacement Map dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Displacement Map...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Displacement Map")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Select the displacement source layer from dropdown
    const layerSelect = page.locator('[role="dialog"] select');
    await layerSelect.selectOption({ index: 0 });
    await page.waitForTimeout(200);

    // Set horizontal scale to 80 (strong displacement)
    const hScaleSlider = page.locator('input[type="range"]').first();
    await hScaleSlider.fill('80');
    await page.waitForTimeout(200);

    // Set vertical scale to 0 (no vertical displacement)
    const vScaleSlider = page.locator('input[type="range"]').nth(1);
    await vScaleSlider.fill('0');
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'displacement-map-after.png') });

    // With red=255 and scaleX=80:
    // offset.x = (1.0 - 0.5) * 2.0 * 80 = +80
    // srcUv = v_uv + 80/400 = v_uv + 0.2
    // Each output pixel samples from 80 pixels to its right in the source.
    // This shifts the visible content LEFT by 80 pixels:
    //   x=50:  samples from x=130 → red
    //   x=100: samples from x=180 → red
    //   x=120: samples from x=200 → boundary (blue)
    //   x=150: samples from x=230 → blue
    //   x=320: samples from x=400 → out of bounds → transparent
    //   x=350: samples from x=430 → out of bounds → transparent

    // x=150 was red before, now samples from x=230 → blue
    const afterAtX150 = await readPixel(page, 150, 200, layer1Id);
    expect(afterAtX150.b).toBeGreaterThan(200);
    expect(afterAtX150.r).toBeLessThan(50);

    // x=50 still samples from x=130 → still red
    const afterAtX50 = await readPixel(page, 50, 200, layer1Id);
    expect(afterAtX50.r).toBeGreaterThan(200);
    expect(afterAtX50.b).toBeLessThan(50);

    // x=350 samples from x=430 → out of bounds → transparent
    const afterAtX350 = await readPixel(page, 350, 200, layer1Id);
    expect(afterAtX350.a).toBe(0);
  });

  test('dialog shows layer picker and controls', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    const firstLayerId = await getActiveLayerId(page);

    // Need at least 2 layers
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(300);

    // Select first layer
    await page.locator(`[data-layer-id="${firstLayerId}"]`).click();
    await page.waitForTimeout(200);

    // Open displacement map dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Displacement Map...');
    await page.waitForTimeout(300);

    // Verify all controls are present
    await expect(page.locator('h2:has-text("Displacement Map")')).toBeVisible();
    await expect(page.locator('text=Source Layer')).toBeVisible();
    await expect(page.locator('text=Horizontal Scale')).toBeVisible();
    await expect(page.locator('text=Vertical Scale')).toBeVisible();
    await expect(page.locator('text=Channel Mode')).toBeVisible();
    await expect(page.locator('text=Edge Behavior')).toBeVisible();
    await expect(page.locator('text=Red / Green')).toBeVisible();
    await expect(page.locator('text=Luminance')).toBeVisible();
    await expect(page.locator('text=Transparent')).toBeVisible();
    await expect(page.locator('text=Tile')).toBeVisible();

    // Layer picker dropdown should list the other layer
    const selectOptions = page.locator('select option');
    const count = await selectOptions.count();
    expect(count).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'displacement-map-dialog.png') });

    // Cancel should close without applying
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
    await expect(page.locator('h2:has-text("Displacement Map")')).not.toBeVisible();
  });

  test('luminance mode uses brightness for both axes', async ({ page }) => {
    await createDocument(page, 400, 400, true);

    const layer1Id = await getActiveLayerId(page);

    // Paint active layer: uniform green
    await paintLayerPattern(page, layer1Id, `
      for (let i = 0; i < W * H * 4; i += 4) {
        data.data[i] = 0; data.data[i+1] = 200; data.data[i+2] = 0; data.data[i+3] = 255;
      }
    `);
    await page.waitForTimeout(300);

    // Add displacement layer with a bright left half and dark right half
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(300);

    const dispLayerId = await getActiveLayerId(page);

    // Left half: white (luminance=1.0 → positive displacement)
    // Right half: black (luminance=0.0 → negative displacement)
    await paintLayerPattern(page, dispLayerId, `
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          const val = x < W / 2 ? 255 : 0;
          data.data[idx] = val; data.data[idx+1] = val; data.data[idx+2] = val; data.data[idx+3] = 255;
        }
      }
    `);
    await page.waitForTimeout(300);

    // Select first layer
    await page.locator(`[data-layer-id="${layer1Id}"]`).click();
    await page.waitForTimeout(200);
    await fitToView(page);

    const beforeCenter = await readPixel(page, 200, 200, layer1Id);
    expect(beforeCenter.g).toBe(200);
    expect(beforeCenter.a).toBe(255);

    // Open Filter > Displacement Map dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Displacement Map...');
    await page.waitForTimeout(300);

    // Select displacement layer
    await page.locator('[role="dialog"] select').selectOption({ index: 0 });
    await page.waitForTimeout(200);

    // Set both scales
    const sliders = page.locator('input[type="range"]');
    await sliders.nth(0).fill('60');
    await sliders.nth(1).fill('60');
    await page.waitForTimeout(200);

    // Switch to luminance mode
    await page.locator('text=Luminance').click();
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'displacement-map-luminance.png') });

    // In luminance mode with white displacement (lum=1.0):
    // offset = (1.0 - 0.5) * 2.0 * 60 = 60 px in both axes
    // At (10, 10): samples from (70, 70) → green
    const afterLeftInner = await readPixel(page, 10, 10, layer1Id);
    expect(afterLeftInner.g).toBeGreaterThan(150);

    // In luminance mode with black displacement (lum=0.0):
    // offset = (0.0 - 0.5) * 2.0 * 60 = -60 px in both axes
    // At (350, 350): samples from (290, 290) → green
    const afterRightInner = await readPixel(page, 350, 350, layer1Id);
    expect(afterRightInner.g).toBeGreaterThan(150);

    // At (300, 10) in the dark half: offset = -60 in both axes
    // samples from (240, -50) → out of bounds → transparent
    const afterEdge = await readPixel(page, 300, 10, layer1Id);
    expect(afterEdge.a).toBe(0);
  });
});
