import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, paintRect } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

async function applyChromaticAberration(page: Page, amount: number, angle: number): Promise<void> {
  await page.evaluate(
    ({ amount, angle }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          layerPixelData: Map<string, unknown>;
          sparseLayerData: Map<string, unknown>;
          dirtyLayerIds: Set<string>;
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
        };
        setState: (s: Record<string, unknown>) => void;
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      state.pushHistory('Chromatic Aberration');

      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      } | undefined;
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        filterChromaticAberration: (engine: unknown, layerId: string, amount: number, angle: number) => void;
      } | undefined;

      if (engineState && bridge) {
        const engine = engineState.getEngine();
        bridge.filterChromaticAberration(engine, activeId, amount, angle);
      }

      // Clear JS pixel cache so GPU texture is source of truth
      const freshState = store.getState();
      const pixelDataMap = new Map(freshState.layerPixelData);
      pixelDataMap.delete(activeId);
      const sparseMap = new Map(freshState.sparseLayerData);
      sparseMap.delete(activeId);
      const dirtyIds = new Set(freshState.dirtyLayerIds);
      dirtyIds.add(activeId);
      store.setState({
        layerPixelData: pixelDataMap,
        sparseLayerData: sparseMap,
        dirtyLayerIds: dirtyIds,
      });

      state.notifyRender();
    },
    { amount, angle },
  );
  await page.waitForTimeout(500);
}

async function readGpuPixel(
  page: Page,
  layerId: string,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ lid, x, y }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(lid);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (y * result.width + x) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { lid: layerId, x, y },
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

test.describe('Chromatic Aberration Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies chromatic aberration and shifts RGB channels', async ({ page }) => {
    await createDocument(page, 200, 200);

    // Paint a full-width pattern: left half red, right half blue (in one call
    // to avoid state issues between two paintRect calls).
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number; layers: Array<{ id: string; width: number; height: number }> };
          layerPixelData: Map<string, ImageData>;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      state.pushHistory('Paint');
      const existing = state.layerPixelData.get(id);
      const w = state.document.width;
      const h = state.document.height;
      const data = existing ?? new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (x < 100) {
            data.data[idx] = 255;     // R
            data.data[idx + 1] = 0;   // G
            data.data[idx + 2] = 0;   // B
          } else {
            data.data[idx] = 0;       // R
            data.data[idx + 1] = 0;   // G
            data.data[idx + 2] = 255; // B
          }
          data.data[idx + 3] = 255;   // A
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    const layerId = await getActiveLayerId(page);

    // Verify initial state: left is pure red, right is pure blue
    const leftBefore = await readGpuPixel(page, layerId, 50, 100);
    const rightBefore = await readGpuPixel(page, layerId, 150, 100);
    expect(leftBefore.r).toBe(255);
    expect(leftBefore.b).toBe(0);
    expect(rightBefore.r).toBe(0);
    expect(rightBefore.b).toBe(255);

    // Apply chromatic aberration with horizontal shift (angle=0, amount=15px)
    await applyChromaticAberration(page, 15, 0);

    // Near the boundary (x=100), the red channel samples 15px to the right (into blue area)
    // and the blue channel samples 15px to the left (into red area).
    //
    // At x=100 (right on the boundary):
    //   Red channel samples at x=115 → blue area → R component of blue = 0 → fragColor.r = 0
    //   Green channel samples at x=100 → boundary → G=0
    //   Blue channel samples at x=85 → red area → B component of red = 0 → fragColor.b = 0
    //
    // At x=90 (10px left of boundary, in red zone):
    //   Red channel samples at x=90+15=105 → blue area → R of (0,0,255) = 0
    //   Green channel samples at x=90 → red area → G of (255,0,0) = 0
    //   Blue channel samples at x=90-15=75 → red area → B of (255,0,0) = 0
    //   So at x=90: (0, 0, 0, 255) — the red channel got zeroed by blue area
    //
    // At x=110 (10px right of boundary, in blue zone):
    //   Red channel samples at x=110+15=125 → blue area → R=0
    //   Green channel samples at x=110 → blue area → G=0
    //   Blue channel samples at x=110-15=95 → red area → B=0
    //   So at x=110: (0, 0, 0, 255) — same, both channels zeroed
    //
    // For a stronger test, check x=50 (far left, all samples in red zone):
    //   Red channel samples at x=65 → still red → R=255
    //   Green channel samples at x=50 → red → G=0
    //   Blue channel samples at x=35 → red → B=0
    //   So (255, 0, 0, 255) — unchanged, as expected
    //
    // x=150 (far right, all samples in blue zone):
    //   Red channel samples at x=165 → still blue → R=0
    //   Green channel samples at x=150 → blue → G=0
    //   Blue channel samples at x=135 → blue → B=255
    //   So (0, 0, 255, 255) — unchanged
    //
    // The interesting area is near the boundary. At x=90:
    //   Red samples from x=105 (blue) → R=0, but original was R=255
    //   So the red channel at x=90 should now be 0 (was 255).

    const farLeft = await readGpuPixel(page, layerId, 50, 100);
    const nearBoundaryLeft = await readGpuPixel(page, layerId, 90, 100);
    const nearBoundaryRight = await readGpuPixel(page, layerId, 110, 100);
    const farRight = await readGpuPixel(page, layerId, 150, 100);

    // Far from boundary — channels stay the same
    expect(farLeft.r).toBe(255);
    expect(farRight.b).toBe(255);

    // Near boundary on the left: red channel now reads from blue area → R drops to 0
    // (original was 255)
    expect(nearBoundaryLeft.r).toBeLessThan(50);

    // Near boundary on the right: blue channel now reads from red area → B drops to 0
    // (original was 255)
    expect(nearBoundaryRight.b).toBeLessThan(50);

    // Take a screenshot for the PR
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'chromatic-aberration.png'),
    });
  });

  test('chromatic aberration is undoable', async ({ page }) => {
    await createDocument(page, 100, 100);
    await paintRect(page, 0, 0, 100, 100, { r: 200, g: 100, b: 50, a: 255 });
    await page.waitForTimeout(300);

    const layerId = await getActiveLayerId(page);
    const before = await readGpuPixel(page, layerId, 50, 50);

    await applyChromaticAberration(page, 15, 0);

    // Undo
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      };
      store.getState().undo();
    });
    await page.waitForTimeout(500);

    const after = await readGpuPixel(page, layerId, 50, 50);
    expect(after.r).toBe(before.r);
    expect(after.g).toBe(before.g);
    expect(after.b).toBe(before.b);
  });
});
