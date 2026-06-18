import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, drawRect, openGroupEffectsPanel, addAdjustment, getRootGroupId, setGroupBlendMode } from './helpers';

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<PixelSnap | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

interface CurvePointJSON { x: number; y: number; }

interface CurvesJSON {
  rgb: CurvePointJSON[];
  r: CurvePointJSON[];
  g: CurvePointJSON[];
  b: CurvePointJSON[];
}

/**
 * Add a curves adjustment node via the UI and set the curve data.
 * The node is added through the AdjustmentsPanel "Add Adjustment" menu.
 * Curve values are set via updateAdjustmentNode because the canvas-based
 * curve editor has no text inputs for precise mathematical values.
 */
async function setCurvesOnGroup(page: Page, groupId: string, curves: CurvesJSON): Promise<void> {
  // Pass-through groups skip the scratch FBO, so curves won't apply.
  await setGroupBlendMode(page, groupId, 'normal');
  await openGroupEffectsPanel(page, groupId);

  // Check if a curves node already exists
  const hasCurves = await page.evaluate(({ gid }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; type: string; adjustments?: Array<{ type: string }> }> };
      };
    };
    const group = store.getState().document.layers.find((l) => l.id === gid);
    return group?.adjustments?.some((n) => n.type === 'curves') ?? false;
  }, { gid: groupId });

  if (!hasCurves) {
    await addAdjustment(page, groupId, 'curves');
  }

  // Update curve data on the node
  await page.evaluate(({ gid, c }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; type: string; adjustments?: Array<{ id: string; type: string }> }> };
        updateAdjustmentNode: (groupId: string, nodeId: string, params: Record<string, unknown>) => void;
        setGroupAdjustmentsEnabled: (groupId: string, enabled: boolean) => void;
      };
    };
    const state = store.getState();
    const group = state.document.layers.find((l) => l.id === gid);
    const curvesNode = group?.adjustments?.find((n) => n.type === 'curves');
    if (curvesNode) {
      state.updateAdjustmentNode(gid, curvesNode.id, { curves: c });
    }
    state.setGroupAdjustmentsEnabled(gid, true);
  }, { gid: groupId, c: curves });
}

test.describe('Curves adjustment', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
  });

  test('inverting the master curve flips midtones in the live composite', async ({ page }) => {
    await drawRect(page, 0, 0, 100, 100, { r: 100, g: 100, b: 100 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 50, 50);
    expect(before.r).toBeGreaterThan(95);
    expect(before.r).toBeLessThan(110);

    const groupId = await getRootGroupId(page);

    // Master curve: (0,1) → (1,0) — invert.
    await setCurvesOnGroup(page, groupId, {
      rgb: [{ x: 0, y: 1 }, { x: 1, y: 0 }],
      r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    await page.waitForTimeout(200);

    const after = await readCompositedAtDoc(page, 50, 50);
    expect(after.r, 'inverted gray midtone should be ≈ 255 - 100').toBeGreaterThan(140);
    expect(after.r).toBeLessThan(170);
  });

  test('per-channel curve crushes only the targeted channel', async ({ page }) => {
    await drawRect(page, 0, 0, 100, 100, { r: 200, g: 200, b: 50 });
    await page.waitForTimeout(200);

    await page.screenshot({
      path: 'test-results/screenshots/curves-before.png',
    });

    const groupId = await getRootGroupId(page);

    // Crush red to 0; green and blue identity.
    await setCurvesOnGroup(page, groupId, {
      rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      r: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    await page.waitForTimeout(200);

    const px = await readCompositedAtDoc(page, 50, 50);
    expect(px.r, 'red channel should be crushed to 0').toBeLessThan(10);
    expect(px.g, 'green channel untouched').toBeGreaterThan(180);
    expect(px.b, 'blue channel untouched').toBeLessThan(70);
    expect(px.b).toBeGreaterThan(30);

    await page.screenshot({
      path: 'test-results/screenshots/curves-red-crush.png',
    });
  });

  test('S-curve crushes shadows and lifts highlights on a gradient', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const data = new ImageData(state.document.width, state.document.height);
      for (let y = 0; y < state.document.height; y++) {
        for (let x = 0; x < state.document.width; x++) {
          const v = Math.round((x / (state.document.width - 1)) * 255);
          const idx = (y * state.document.width + x) * 4;
          data.data[idx] = v;
          data.data[idx + 1] = v;
          data.data[idx + 2] = v;
          data.data[idx + 3] = 255;
        }
      }
      store.getState().updateLayerPixelData(state.document.activeLayerId, data);
    });
    await page.waitForTimeout(300);

    await page.screenshot({
      path: 'test-results/screenshots/curves-gradient-before.png',
    });

    const groupId = await getRootGroupId(page);

    // Classic contrast S-curve.
    await setCurvesOnGroup(page, groupId, {
      rgb: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.1 },
        { x: 0.75, y: 0.9 },
        { x: 1, y: 1 },
      ],
      r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    await page.waitForTimeout(200);

    await page.screenshot({
      path: 'test-results/screenshots/curves-gradient-s-curve.png',
    });

    const quarter = await readCompositedAtDoc(page, 25, 50);
    expect(quarter.r, 'quarter-tone should be crushed').toBeLessThan(70);

    const threeQuarter = await readCompositedAtDoc(page, 75, 50);
    expect(threeQuarter.r, 'three-quarter tone should be lifted').toBeGreaterThan(192);
  });

  test('clearing curves restores the original pixels', async ({ page }) => {
    await drawRect(page, 0, 0, 100, 100, { r: 100, g: 100, b: 100 });
    await page.waitForTimeout(200);

    const groupId = await getRootGroupId(page);

    await setCurvesOnGroup(page, groupId, {
      rgb: [{ x: 0, y: 1 }, { x: 1, y: 0 }],
      r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    await page.waitForTimeout(150);

    // Click the Reset button in the curves editor UI to restore identity.
    const drawer = page.getByTestId('effects-drawer');
    const resetBtn = drawer.locator('button:has-text("Reset")');
    if (await resetBtn.isVisible().catch(() => false)) {
      await resetBtn.click();
    } else {
      // Fall back: set identity values
      await setCurvesOnGroup(page, groupId, {
        rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      });
    }
    await page.waitForTimeout(200);

    const px = await readCompositedAtDoc(page, 50, 50);
    expect(px.r).toBeGreaterThan(95);
    expect(px.r).toBeLessThan(110);
  });
});
