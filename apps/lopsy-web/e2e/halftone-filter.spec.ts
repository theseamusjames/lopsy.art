import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, addLayer, docToScreen, applyFilter, undo } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Helpers for the softness-0 regression test (#878)
// ---------------------------------------------------------------------------

async function activateGradientTool(page: Page) {
  await page.locator('[data-tool-id="gradient"]').click();
  await page.waitForTimeout(100);
}

async function setBlackToWhiteGradientStops(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setGradientSetting: (
          k: 'stops' | 'type',
          v: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }> | string,
        ) => void;
      };
    };
    store.getState().setGradientSetting('type', 'linear');
    store.getState().setGradientSetting('stops', [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ]);
  });
}

async function dragGradient(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * Fraction of pixels with alpha > 128 inside [xMin, xMax) x [yMin, yMax)
 * of the given layer, in document coordinates. Used to detect the
 * "light cells stay fully opaque" failure mode from issue #878.
 */
async function opaqueFractionInRegion(
  page: Page,
  layerId: string,
  region: { xMin: number; xMax: number; yMin: number; yMax: number },
): Promise<number> {
  return page.evaluate(
    async ({ layerId, region }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
        };
      };
      const layer = store.getState().document.layers.find((l) => l.id === layerId);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(layerId);
      if (!result || result.width === 0) return 0;
      let opaque = 0;
      let total = 0;
      for (let y = region.yMin; y < region.yMax; y++) {
        const localY = y - ly;
        if (localY < 0 || localY >= result.height) continue;
        for (let x = region.xMin; x < region.xMax; x++) {
          const localX = x - lx;
          if (localX < 0 || localX >= result.width) continue;
          const idx = (localY * result.width + localX) * 4;
          total++;
          if (result.pixels[idx + 3] > 128) opaque++;
        }
      }
      return total === 0 ? 0 : opaque / total;
    },
    { layerId, region },
  );
}

test.describe('Halftone Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies halftone filter via menu and renders dot pattern', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a gradient-like pattern with colored stripes so halftone dots are visible
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      const color = {
        r: Math.round(255 * (1 - t)),
        g: Math.round(100 * t),
        b: Math.round(255 * t),
      };
      await drawRect(page, i * 20, 0, 20, 300, color);
    }

    await fitToView(page);
    await page.waitForTimeout(300);

    // Take screenshot before filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-before.png') });

    // Open Filter menu and click Halftone
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Halftone...');
    await page.waitForTimeout(300);

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Halftone")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Click Apply button
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Take screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-after.png') });

    // Verify the filter was applied — layer should still exist
    const layerInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; width: number; height: number }>; activeLayerId: string };
        };
      };
      const state = store.getState();
      return {
        layerCount: state.document.layers.length,
        activeLayerId: state.document.activeLayerId,
        layerWidth: state.document.layers[0]?.width,
        layerHeight: state.document.layers[0]?.height,
      };
    });

    expect(layerInfo.layerCount).toBeGreaterThan(0);
    expect(layerInfo.layerWidth).toBe(400);
    expect(layerInfo.layerHeight).toBe(300);
  });

  test('halftone filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a simple pattern
    await drawRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0 });
    await drawRect(page, 100, 0, 100, 200, { r: 0, g: 255, b: 0 });
    await fitToView(page);

    // Apply halftone via store API directly
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;

      const engineMod = (window as unknown as Record<string, unknown>).__wasmEngine as {
        filterHalftone: (engine: unknown, layerId: string, dotSize: number, density: number, angle: number, contrast: number) => void;
      };
      const engine = (window as unknown as Record<string, unknown>).__engine;
      if (engineMod && engine) {
        state.pushHistory('Halftone');
        engineMod.filterHalftone(engine, activeId, 8, 1.0, 45, 1.0);
        state.notifyRender();
      }
    });

    await page.waitForTimeout(300);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // The document should still have the layer
    const layerCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length;
    });

    expect(layerCount).toBeGreaterThan(0);
  });
});

test.describe('Halftone Filter — Softness 0 regression (#878)', () => {
  // Region covering the light (right) half of the black-to-white gradient,
  // inset from the doc edges to avoid gradient-tool edge artifacts.
  const LIGHT_REGION = { xMin: 300, xMax: 390, yMin: 10, yMax: 290 };

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  async function drawGradientLayer(page: Page): Promise<string> {
    const layerId = await addLayer(page);
    await activateGradientTool(page);
    await setBlackToWhiteGradientStops(page);
    await dragGradient(page, { x: 0, y: 150 }, { x: 399, y: 150 });
    return layerId;
  }

  test('Softness 0 turns light cells into dots, not a solid opaque fill', async ({ page }) => {
    const layerId = await drawGradientLayer(page);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-softness-0-before.png') });

    await applyFilter(page, 'Halftone...', {
      'Dot Size': 14,
      Density: 1,
      Angle: 45,
      Softness: 0,
    });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-softness-0-after.png') });

    const opaqueFraction = await opaqueFractionInRegion(page, layerId, LIGHT_REGION);

    // Before the fix, the undefined smoothstep(edge, edge, dist) call made
    // ~99.3% of this region opaque (a solid stepped gradient instead of
    // dots). It should now be mostly transparent, with small dots covering
    // only a minority of the area.
    expect(opaqueFraction).toBeLessThan(0.4);
    // ...but dots should still exist — this isn't just erasing the region.
    expect(opaqueFraction).toBeGreaterThan(0);
  });

  test('Softness 1 still produces dots on transparency (no regression)', async ({ page }) => {
    const layerId = await drawGradientLayer(page);

    await applyFilter(page, 'Halftone...', {
      'Dot Size': 14,
      Density: 1,
      Angle: 45,
      Softness: 1,
    });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-softness-1-after.png') });

    const opaqueFraction = await opaqueFractionInRegion(page, layerId, LIGHT_REGION);
    expect(opaqueFraction).toBeLessThan(0.4);
  });

  test('Softness 0 and Softness 0.1 produce visually similar coverage (continuity)', async ({ page }) => {
    const layerIdA = await drawGradientLayer(page);
    await applyFilter(page, 'Halftone...', {
      'Dot Size': 14,
      Density: 1,
      Angle: 45,
      Softness: 0,
    });
    const fractionAtZero = await opaqueFractionInRegion(page, layerIdA, LIGHT_REGION);

    await undo(page);
    await page.waitForTimeout(300);

    await applyFilter(page, 'Halftone...', {
      'Dot Size': 14,
      Density: 1,
      Angle: 45,
      Softness: 0.1,
    });
    const fractionNearZero = await opaqueFractionInRegion(page, layerIdA, LIGHT_REGION);

    // Softness should interpolate continuously — a small step away from 0
    // must not cause a huge jump in opaque coverage.
    expect(Math.abs(fractionNearZero - fractionAtZero)).toBeLessThan(0.3);
  });
});
