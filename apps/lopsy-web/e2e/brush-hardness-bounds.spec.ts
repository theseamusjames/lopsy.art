import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, addLayer, configureEffect, closeEffectsPanel, setEffectColor } from './helpers';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width: number, height: number) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
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

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function pushHistory(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label: string) => void };
    };
    store.getState().pushHistory('test');
  });
  await page.waitForTimeout(200);
}

async function selectTriangleBrush(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        presets: Array<{ id: string; name: string }>;
        setActivePreset: (id: string) => void;
      };
    };
    const s = store.getState();
    const triangle = s.presets.find((p) => p.name === 'Diamond');
    if (triangle) s.setActivePreset(triangle.id);
  });
}

async function setHardness(page: Page, value: number) {
  await page.evaluate((v) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setBrushSetting: (k: 'hardness', v: number) => void };
    };
    store.getState().setBrushSetting('hardness', v);
  }, value);
  await page.waitForTimeout(100);
}

async function readLayerPixels(page: Page, layerId: string) {
  return page.evaluate(async (id) => {
    return ((window as unknown as Record<string, (...args: unknown[]) => Promise<{
      width: number; height: number; pixels: number[];
    }>>).__readLayerPixels!(id));
  }, layerId);
}

async function getActiveLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

test.describe('Brush Hardness Bounds', () => {
  test('softened brush fills to original shape boundary', async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects drawer requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 250);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Select brush tool, diamond tip, white color, size 150
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await selectTriangleBrush(page);
    await setForegroundColor(page, 255, 255, 255);
    await setToolOption(page, 'Size', 150);

    // Dab 1: hardness 100
    await setHardness(page, 100);
    const p1 = await docToScreen(page, 100, 125);
    await page.mouse.click(p1.x, p1.y);
    await page.waitForTimeout(300);

    // Dab 2: hardness 50
    await setHardness(page, 50);
    await page.waitForTimeout(200);
    const p2 = await docToScreen(page, 300, 125);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(300);

    // Dab 3: hardness 0
    await setHardness(page, 0);
    await page.waitForTimeout(200);
    const p3 = await docToScreen(page, 500, 125);
    await page.mouse.click(p3.x, p3.y);
    await page.waitForTimeout(300);

    await pushHistory(page);

    // Add 1px black stroke effect to show the original shape boundary
    const layerId = await getActiveLayerId(page);
    await configureEffect(page, 'Stroke', { 'Width': 1 });
    await setEffectColor(page, 'Stroke color', 0, 0, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(300);

    // Add a new layer and paint the same 3 dabs in black
    const newLayerId = await addLayer(page);
    await page.keyboard.press('b');
    await setForegroundColor(page, 0, 0, 0);

    await setHardness(page, 100);
    await page.waitForTimeout(200);
    await page.mouse.click(p1.x, p1.y);
    await page.waitForTimeout(300);

    await setHardness(page, 50);
    await page.waitForTimeout(200);
    await page.mouse.click(p2.x, p2.y);
    await page.waitForTimeout(300);

    await setHardness(page, 0);
    await page.waitForTimeout(200);
    await page.mouse.click(p3.x, p3.y);
    await page.waitForTimeout(300);

    await pushHistory(page);

    await page.screenshot({ path: 'e2e/screenshots/brush-hardness-bounds.png' });

    // Read the black layer's pixels for the 50% and 0% hardness dabs.
    // The blur should extend close to the original shape boundary.
    // We measure by scanning from the known dab center outward and finding
    // where the black pixels end (alpha drops below threshold), then compare
    // that to the expected radius (75px for size 150).
    const result = await readLayerPixels(page, newLayerId);
    const w = result.width;

    // For dab 2 (center at doc x=300, hardness 50), scan rightward from center.
    // The black content should extend close to 300 + 75 = 375.
    const dab2CenterX = 300;
    const dab2CenterY = 125;
    let dab2RightEdge = dab2CenterX;
    for (let x = dab2CenterX; x < dab2CenterX + 100; x++) {
      const idx = (dab2CenterY * w + x) * 4;
      const a = result.pixels[idx + 3] ?? 0;
      if (a > 5) dab2RightEdge = x;
    }
    const dab2Reach = dab2RightEdge - dab2CenterX;
    const expectedRadius = 75;

    // For dab 3 (center at doc x=500, hardness 0), scan rightward.
    const dab3CenterX = 500;
    let dab3RightEdge = dab3CenterX;
    for (let x = dab3CenterX; x < dab3CenterX + 100; x++) {
      const idx = (dab2CenterY * w + x) * 4;
      const a = result.pixels[idx + 3] ?? 0;
      if (a > 5) dab3RightEdge = x;
    }
    const dab3Reach = dab3RightEdge - dab3CenterX;

    // eslint-disable-next-line no-console
    console.log(`Dab2 (H50) reach: ${dab2Reach}px / ${expectedRadius}px expected`);
    // eslint-disable-next-line no-console
    console.log(`Dab3 (H0) reach: ${dab3Reach}px / ${expectedRadius}px expected`);

    expect(dab2Reach).toBeGreaterThan(expectedRadius - 10);
    // Hardness 0 has aggressive Gaussian falloff — alpha drops below
    // threshold well before the nominal radius, so allow wider margin.
    expect(dab3Reach).toBeGreaterThan(expectedRadius - 35);
  });
});
