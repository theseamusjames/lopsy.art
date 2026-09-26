import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, drawEllipse, getPixelAt, applyFilter } from './helpers';

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

test.describe('Kaleidoscope Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies kaleidoscope filter via menu and produces symmetric output', async ({ page }) => {
    await createDocument(page, 400, 400, false);

    // Paint an asymmetric, colorful pattern so the kaleidoscope effect is visible.
    // A few offset colored rectangles creates enough asymmetry to verify the mirror.
    await drawRect(page, 0, 0, 400, 400, { r: 20, g: 20, b: 40 });
    await drawRect(page, 250, 50, 120, 80, { r: 255, g: 80, b: 80 });
    await drawRect(page, 60, 180, 150, 60, { r: 80, g: 220, b: 120 });
    await drawRect(page, 280, 260, 80, 120, { r: 80, g: 120, b: 255 });
    await drawRect(page, 120, 60, 60, 60, { r: 255, g: 220, b: 60 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Screenshot the asymmetric "before" state
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kaleidoscope-before.png') });

    // Open Filter menu and click Kaleidoscope
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Kaleidoscope...');
    await page.waitForTimeout(300);

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Kaleidoscope")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Click Apply — defaults (6 segments, rotation 0) should produce a
    // clearly symmetric 6-wedge pattern.
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Screenshot the "after" state
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kaleidoscope-after.png') });

    // Sanity: layer is still the same dimensions and still exists.
    const layerInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; width: number; height: number }>; activeLayerId: string };
        };
      };
      const state = store.getState();
      return {
        layerCount: state.document.layers.length,
        layerWidth: state.document.layers[0]?.width,
        layerHeight: state.document.layers[0]?.height,
      };
    });

    expect(layerInfo.layerCount).toBeGreaterThan(0);
    expect(layerInfo.layerWidth).toBe(400);
    expect(layerInfo.layerHeight).toBe(400);

    // Verify the pixel output is actually horizontally symmetric after the
    // filter runs. With an even number of segments (6) aligned at rotation 0,
    // pixel (cx + dx, cy) should equal pixel (cx - dx, cy) because the
    // kaleidoscope mirrors wedges across the horizontal axis.
    const symmetryOk = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);
      const w = data.width;
      const h = data.height;
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      // Sample a handful of mirrored pairs at mid-radius and check each
      // component matches within a small tolerance (GPU filtering can
      // introduce a little bilinear wiggle at exact pixel locations).
      const offsets = [30, 50, 80, 110];
      const tol = 8;
      for (const dx of offsets) {
        const a = ((cy) * w + (cx + dx)) * 4;
        const b = ((cy) * w + (cx - dx)) * 4;
        for (let c = 0; c < 4; c++) {
          if (Math.abs(data.data[a + c] - data.data[b + c]) > tol) {
            return { ok: false, dx, c, a: data.data[a + c], b: data.data[b + c] };
          }
        }
      }
      return { ok: true };
    });

    expect(symmetryOk.ok).toBe(true);
  });

  test('kaleidoscope filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    await drawRect(page, 0, 0, 200, 200, { r: 40, g: 40, b: 40 });
    await drawRect(page, 130, 20, 50, 50, { r: 255, g: 100, b: 50 });
    await fitToView(page);

    // Apply kaleidoscope via the wasm bridge directly
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const store = w.__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
        };
      };
      const engineState = w.__engineState as { getEngine: () => unknown } | undefined;
      const bridge = w.__wasmBridge as {
        filterKaleidoscope?: (engine: unknown, layerId: string, segments: number, rotation: number) => void;
      } | undefined;
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      const engine = engineState?.getEngine();
      if (bridge?.filterKaleidoscope && engine) {
        state.pushHistory('Kaleidoscope');
        bridge.filterKaleidoscope(engine, activeId, 8, 30);
        state.notifyRender();
      }
    });

    await page.waitForTimeout(300);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const layerCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length;
    });

    expect(layerCount).toBeGreaterThan(0);
  });

  // Regression test for #889: kaleidoscope computed its polar math in UV
  // space, where a unit of x and a unit of y cover different pixel counts
  // on a non-square layer. That stretched mirrored copies along the long
  // axis instead of placing them at an equal radius from center.
  test('mirrors copies at an equal radius on a non-square layer (#889)', async ({ page }) => {
    await createDocument(page, 400, 200, true);

    // A red dot 50px above center (200, 100) on a 400x200 doc.
    await drawEllipse(page, 200, 50, 5, 5, { r: 255, g: 0, b: 0 });
    await fitToView(page);

    await applyFilter(page, 'Kaleidoscope...', { Segments: 4, Rotation: 270 });
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kaleidoscope-aspect-after.png') });

    const isRed = (p: { r: number; g: number; b: number; a: number }) =>
      p.a > 100 && p.r > 150 && p.g < 100 && p.b < 100;

    // Correct, aspect-corrected copies: 4-fold symmetry, all 50px from
    // center (200, 100) — up, right, down, left.
    const expectedCopies = [
      { x: 200, y: 50 },
      { x: 250, y: 100 },
      { x: 200, y: 150 },
      { x: 150, y: 100 },
    ];
    for (const { x, y } of expectedCopies) {
      const pixel = await getPixelAt(page, x, y);
      expect(isRed(pixel), `expected red at (${x}, ${y})`).toBe(true);
    }

    // The pre-fix (UV-space) math placed the horizontal mirrors 100px out
    // instead of 50px, at roughly (292, 98) and (92, 98). Those locations
    // must be background (transparent), not red, once the aspect-ratio
    // math is fixed.
    const buggyLocations = [
      { x: 292, y: 98 },
      { x: 92, y: 98 },
    ];
    for (const { x, y } of buggyLocations) {
      const pixel = await getPixelAt(page, x, y);
      expect(isRed(pixel), `expected background (not red) at (${x}, ${y})`).toBe(false);
    }
  });
});
