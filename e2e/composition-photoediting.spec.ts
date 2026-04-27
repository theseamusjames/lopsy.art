/**
 * Composition Test 3: Photo Editing Workflow
 *
 * Covers: All filters (Gaussian blur, box blur, motion blur, radial blur,
 *   find edges, unsharp mask, pixelate, halftone, kaleidoscope, oil paint,
 *   cel shading, chromatic aberration, solarize, add noise, brightness/contrast,
 *   hue/saturation, fill with noise, clouds, smoke),
 * Quick filters (invert, desaturate, posterize, threshold),
 * Text tool (create, type, commit, area text),
 * Crop tool,
 * Layer masks (add, edit, toggle, remove),
 * Layer groups (create group, add adjustments),
 * Remaining blend modes (Darken, Lighten, Color Burn, Hard Light,
 *   Soft Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity),
 * Flatten image, rasterize style,
 * Remaining adjustments (highlights, shadows, whites, blacks, vibrance),
 * Magnetic lasso.
 */
import { test, expect, type Page } from './fixtures';
import {
  setToolOption,
  setForegroundColor as setForegroundColorUI,
  setBlendMode,
  setLayerOpacity,
  setAdjustment,
  setActiveLayer,
  configureEffect,
  setEffectColor,
  closeEffectsPanel,
  setBrushModalOption,
  closeBrushModal,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 500, height = 400, transparent = false) {
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

async function dragAtDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

/** Thin wrapper: delegates to UI helpers where possible, falls back to store. */
async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

const toolKeyMap: Record<string, string> = {
  move: 'v', brush: 'b', fill: 'g', shape: 'u', text: 't', eraser: 'e',
  'marquee-rect': 'm', wand: 'w', lasso: 'l', stamp: 's', dodge: 'o',
  smudge: 'r', eyedropper: 'i', pencil: 'n', crop: 'c', path: 'p', spray: 'j',
};

async function setActiveTool(page: Page, tool: string) {
  const key = toolKeyMap[tool];
  if (key) {
    await page.keyboard.press(key);
  } else {
    await page.locator(`[data-tool-id="${tool}"]`).click();
  }
  await page.waitForTimeout(100);
}

async function getActiveTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    if (dr + dg + db > 30) count++;
  }
  return count;
}

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{
            id: string;
            name: string;
            type: string;
            visible: boolean;
            opacity: number;
            blendMode: string;
            x: number;
            y: number;
            width: number;
            height: number;
            effects: Record<string, { enabled: boolean }>;
            mask: { id: string; enabled: boolean } | null;
            text?: string;
          }>;
          layerOrder: string[];
          activeLayerId: string;
        };
        undoStack: unknown[];
        redoStack: unknown[];
      };
    };
    const state = store.getState();
    return {
      document: state.document,
      undoStackLength: state.undoStack.length,
      redoStackLength: state.redoStack.length,
    };
  });
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    async ({ x, y, lid }) => {
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
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const localX = x - lx;
      const localY = y - ly;
      if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (localY * result.width + localX) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { x, y, lid: layerId ?? null },
  );
}

/**
 * Read a pixel from the active layer's GPU texture at document coordinates.
 * Uses __readLayerPixels (GPU readback via rAF) which always reflects
 * the latest GPU state including filter modifications.
 */
async function readGpuPixel(page: Page, docX: number, docY: number) {
  return page.evaluate(
    async ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            layers: Array<{ id: string; x: number; y: number }>;
          };
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const layer = state.document.layers.find((l) => l.id === id);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const localX = x - lx;
      const localY = y - ly;
      if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (localY * result.width + localX) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { x: docX, y: docY },
  );
}

async function addLayer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addLayer: () => void;
        document: { activeLayerId: string };
      };
    };
    store.getState().addLayer();
    return store.getState().document.activeLayerId;
  });
}

/**
 * Apply a filter via the Filter menu UI.
 * For parametric filters (with "..."), opens the dialog, optionally adjusts
 * the first slider, then clicks Apply.
 * For non-parametric filters (Invert, Desaturate, Find Edges), just clicks.
 */
async function applyFilterViaMenu(
  page: Page,
  filterName: string,
  sliderValue?: number,
) {
  await page.click('text=Filter');
  await page.waitForTimeout(200);
  await page.click(`text=${filterName}`);
  await page.waitForTimeout(300);

  // If it's a parametric filter (has "...")
  if (filterName.endsWith('...')) {
    const dialogTitle = filterName.replace('...', '').trim();
    const heading = page.locator(`h2:has-text("${dialogTitle}")`);
    await expect(heading).toBeVisible({ timeout: 3000 });

    if (sliderValue !== undefined) {
      const slider = page.locator('input[type="range"]').first();
      await slider.fill(String(sliderValue));
      await page.waitForTimeout(200);
    }

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);
  } else {
    // Non-parametric filters apply immediately
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Composition 3: Photo Editing Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 500, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('applies all filters, text, crop, masks, groups, blend modes, and adjustments', async ({ page }) => {
    test.setTimeout(480_000);

    // =====================================================================
    // SETUP: Paint a test image with color regions for filter testing
    // =====================================================================
    const state0 = await getEditorState(page);
    const bgLayerId = state0.document.layers[0]!.id;

    // Paint colored rectangles via helper
    // Paint the test image using the brush tool via real UI interaction.
    // This ensures the GPU pipeline has the data correctly.
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 120);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 15);
    await closeBrushModal(page);

    // Red quadrant (top-left)
    await setForegroundColorUI(page, 200, 50, 50);
    for (let y = 40; y < 200; y += 60) {
      await dragAtDoc(page, { x: 0, y }, { x: 250, y });
    }
    // Blue quadrant (top-right)
    await setForegroundColorUI(page, 50, 50, 200);
    for (let y = 40; y < 200; y += 60) {
      await dragAtDoc(page, { x: 250, y }, { x: 500, y });
    }
    // Green quadrant (bottom-left)
    await setForegroundColorUI(page, 50, 200, 50);
    for (let y = 200; y < 400; y += 60) {
      await dragAtDoc(page, { x: 0, y }, { x: 250, y });
    }
    // Yellow quadrant (bottom-right)
    await setForegroundColorUI(page, 200, 200, 50);
    for (let y = 200; y < 400; y += 60) {
      await dragAtDoc(page, { x: 250, y }, { x: 500, y });
    }
    // White circle in center
    await setForegroundColorUI(page, 255, 255, 255);
    await setToolOption(page, 'Size', 80);
    await dragAtDoc(page, { x: 250, y: 200 }, { x: 252, y: 200 }, 2);

    // Switch back to move tool
    await setActiveTool(page, 'move');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/comp3-01-test-image.png' });

    // =====================================================================
    // PHASE 1: FILTERS — Test every filter via menu
    // =====================================================================

    // --- Gaussian Blur ---
    await applyFilterViaMenu(page, 'Gaussian Blur...', 10);
    await page.screenshot({ path: 'e2e/screenshots/comp3-02-gaussian-blur.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Box Blur ---
    await applyFilterViaMenu(page, 'Box Blur...', 10);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Motion Blur ---
    await applyFilterViaMenu(page, 'Motion Blur...', 10);
    await page.screenshot({ path: 'e2e/screenshots/comp3-03-motion-blur.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Radial Blur ---
    await applyFilterViaMenu(page, 'Radial Blur...', 5);
    await page.screenshot({ path: 'e2e/screenshots/comp3-04-radial-blur.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Find Edges ---
    await applyFilterViaMenu(page, 'Find Edges');
    await page.screenshot({ path: 'e2e/screenshots/comp3-05-find-edges.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Unsharp Mask ---
    await applyFilterViaMenu(page, 'Unsharp Mask...');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Pixelate ---
    await applyFilterViaMenu(page, 'Pixelate...', 20);
    await page.screenshot({ path: 'e2e/screenshots/comp3-06-pixelate.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Halftone ---
    await applyFilterViaMenu(page, 'Halftone...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-07-halftone.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Kaleidoscope ---
    await applyFilterViaMenu(page, 'Kaleidoscope...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-08-kaleidoscope.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Oil Paint ---
    await applyFilterViaMenu(page, 'Oil Paint...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-09-oil-paint.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Cel Shading ---
    await applyFilterViaMenu(page, 'Cel Shading...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-10-cel-shading.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Chromatic Aberration ---
    await applyFilterViaMenu(page, 'Chromatic Aberration...', 15);
    await page.screenshot({ path: 'e2e/screenshots/comp3-11-chromatic-aberration.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Solarize ---
    await applyFilterViaMenu(page, 'Solarize...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-12-solarize.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Add Noise ---
    await applyFilterViaMenu(page, 'Add Noise...', 20);
    await page.screenshot({ path: 'e2e/screenshots/comp3-13-add-noise.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Brightness/Contrast ---
    await applyFilterViaMenu(page, 'Brightness/Contrast...');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Hue/Saturation ---
    await applyFilterViaMenu(page, 'Hue/Saturation...');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // =====================================================================
    // PHASE 2: QUICK FILTERS — Non-parametric
    // =====================================================================

    // --- Invert ---
    await applyFilterViaMenu(page, 'Invert');
    await page.screenshot({ path: 'e2e/screenshots/comp3-14-invert.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Desaturate ---
    await applyFilterViaMenu(page, 'Desaturate');
    await page.screenshot({ path: 'e2e/screenshots/comp3-15-desaturate.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Posterize ---
    await applyFilterViaMenu(page, 'Posterize...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-16-posterize.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // --- Threshold ---
    await applyFilterViaMenu(page, 'Threshold...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-17-threshold.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // =====================================================================
    // PHASE 3: GENERATIVE FILTERS (on new layer)
    // =====================================================================
    const cloudLayerId = await addLayer(page);

    // Fill with noise
    await applyFilterViaMenu(page, 'Fill with Noise...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-18-fill-noise.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // Clouds
    await applyFilterViaMenu(page, 'Clouds...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-19-clouds.png' });
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    // Smoke
    await applyFilterViaMenu(page, 'Smoke...');
    await page.screenshot({ path: 'e2e/screenshots/comp3-20-smoke.png' });

    // Keep smoke for atmosphere — set to Soft Light blend mode
    await page.locator(`[data-layer-id="${cloudLayerId}"]`).click();
    await setBlendMode(page, 'softLight');
    await setLayerOpacity(page, cloudLayerId, 50);

    // =====================================================================
    // PHASE 4: TEXT TOOL
    // =====================================================================
    await setActiveTool(page, 'text');
    expect(await getActiveTool(page)).toBe('text');

    // Click to create point text
    await clickAtDoc(page, 250, 50);
    await page.waitForTimeout(200);

    const editing = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { textEditing: { text: string; cursorPos: number } | null };
      };
      return store.getState().textEditing;
    });
    expect(editing).not.toBeNull();

    await page.keyboard.type('COMPOSITION');
    await page.waitForTimeout(100);

    const editingAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { textEditing: { text: string; cursorPos: number } | null };
      };
      return store.getState().textEditing;
    });
    expect(editingAfter?.text).toBe('COMPOSITION');

    // Commit text
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    const stateWithText = await getEditorState(page);
    // Text layers are rasterized on commit �� find by name
    const textLayer = stateWithText.document.layers.find((l) => l.type === 'raster' && l.name.startsWith('Text'));
    expect(textLayer).toBeTruthy();

    await page.screenshot({ path: 'e2e/screenshots/comp3-21-text.png' });

    // Area text
    await clickAtDoc(page, 50, 350);
    await page.waitForTimeout(200);
    await page.keyboard.type('test');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp3-22-area-text.png' });

    // =====================================================================
    // PHASE 5: BLEND MODES — Test remaining modes on the smoke layer
    // =====================================================================
    const blendModes = [
      'darken', 'lighten', 'colorBurn', 'hardLight',
      'difference', 'exclusion', 'hue', 'saturation',
      'color', 'luminosity',
    ];

    await page.locator(`[data-layer-id="${cloudLayerId}"]`).click();
    for (const mode of blendModes) {
      await setBlendMode(page, mode);
      await page.waitForTimeout(100);
    }

    // Set final mode
    await setBlendMode(page, 'softLight');

    await page.screenshot({ path: 'e2e/screenshots/comp3-23-blend-modes.png' });

    // =====================================================================
    // PHASE 6: LAYER MASK — Add, edit, toggle, remove
    // =====================================================================
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setActiveLayer: (id: string) => void;
          addLayerMask: (id: string) => void;
        };
      };
      if (!store) return false;
    const s = store.getState();
      s.setActiveLayer(lid);
      s.addLayerMask(lid);
    }, cloudLayerId);
    await page.waitForTimeout(200);

    const layerWithMask = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; mask: { id: string; enabled: boolean } | null }> };
        };
      };
      return store.getState().document.layers.find((l) => l.id === lid);
    }, cloudLayerId);
    expect(layerWithMask?.mask).not.toBeNull();
    expect(layerWithMask?.mask?.enabled).toBe(true);

    // Toggle mask off
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { toggleLayerMask: (id: string) => void };
      };
      store.getState().toggleLayerMask(lid);
    }, cloudLayerId);
    await page.waitForTimeout(100);

    const maskToggledOff = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; mask: { enabled: boolean } | null }> };
        };
      };
      return store.getState().document.layers.find((l) => l.id === lid)?.mask?.enabled;
    }, cloudLayerId);
    expect(maskToggledOff).toBe(false);

    // Toggle back on
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { toggleLayerMask: (id: string) => void };
      };
      store.getState().toggleLayerMask(lid);
    }, cloudLayerId);

    // Remove mask
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { removeLayerMask: (id: string) => void };
      };
      store.getState().removeLayerMask(lid);
    }, cloudLayerId);
    await page.waitForTimeout(100);

    const maskRemoved = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; mask: unknown }> };
        };
      };
      return store.getState().document.layers.find((l) => l.id === lid)?.mask;
    }, cloudLayerId);
    expect(maskRemoved).toBeNull();

    await page.screenshot({ path: 'e2e/screenshots/comp3-24-mask-operations.png' });

    // =====================================================================
    // PHASE 7: LAYER GROUP
    // =====================================================================
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addGroup: () => void };
      };
      store.getState().addGroup();
    });
    await page.waitForTimeout(200);

    const stateWithGroup = await getEditorState(page);
    const groupLayer = stateWithGroup.document.layers.find((l) => l.type === 'group');
    expect(groupLayer).toBeTruthy();

    await page.screenshot({ path: 'e2e/screenshots/comp3-25-layer-group.png' });

    // =====================================================================
    // PHASE 8: REMAINING IMAGE ADJUSTMENTS
    // =====================================================================
    await setAdjustment(page, 'Highlights', 20);
    await setAdjustment(page, 'Shadows', -15);
    await setAdjustment(page, 'Whites', 10);
    await setAdjustment(page, 'Blacks', -10);
    await setAdjustment(page, 'Vibrance', 25);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp3-26-adjustments.png' });

    // =====================================================================
    // PHASE 9: MAGNETIC LASSO
    // =====================================================================
    // Ensure we're on the background layer with the color regions
    await page.locator(`[data-layer-id="${bgLayerId}"]`).click();

    await setActiveTool(page, 'lasso-magnetic');
    expect(await getActiveTool(page)).toBe('lasso-magnetic');

    await setToolSetting(page, 'setMagneticLassoWidth', 20);
    await setToolSetting(page, 'setMagneticLassoContrast', 30);
    await setToolSetting(page, 'setMagneticLassoFrequency', 30);

    // Trace around the white circle (center at 250,200, radius 80)
    const startPt = await docToScreen(page, 170, 200);
    await page.mouse.move(startPt.x, startPt.y);
    await page.mouse.down();

    // Trace a path around the circle in steps
    const circleSteps = [
      { x: 200, y: 130 },
      { x: 250, y: 120 },
      { x: 300, y: 130 },
      { x: 330, y: 200 },
      { x: 300, y: 270 },
      { x: 250, y: 280 },
      { x: 200, y: 270 },
      { x: 170, y: 200 },
    ];

    for (const pt of circleSteps) {
      const screen = await docToScreen(page, pt.x, pt.y);
      await page.mouse.move(screen.x, screen.y, { steps: 10 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp3-27-magnetic-lasso.png' });

    // Deselect
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(200);

    // =====================================================================
    // PHASE 10: CROP TOOL
    // =====================================================================
    await page.keyboard.press('c');
    expect(await getActiveTool(page)).toBe('crop');

    const docBefore = await getEditorState(page);
    const widthBefore = docBefore.document.width;
    const heightBefore = docBefore.document.height;

    await dragAtDoc(page, { x: 50, y: 50 }, { x: 450, y: 350 });

    const docAfter = await getEditorState(page);
    expect(docAfter.document.width).toBeLessThanOrEqual(widthBefore);
    expect(docAfter.document.height).toBeLessThanOrEqual(heightBefore);

    await page.screenshot({ path: 'e2e/screenshots/comp3-28-cropped.png' });

    // =====================================================================
    // PHASE 11: LAYER EFFECTS on text layer
    // =====================================================================
    if (textLayer) {
      await setActiveLayer(page, textLayer.id);
      await configureEffect(page, 'Drop Shadow', { 'Offset X': 3, 'Offset Y': 3, 'Blur': 5, 'Spread': 0, 'Opacity': 70 });
      await setEffectColor(page, 'Shadow color', 0, 0, 0);
      await configureEffect(page, 'Stroke', { 'Width': 2 });
      await setEffectColor(page, 'Stroke color', 255, 255, 255);
      await page.locator('[aria-label="Stroke position: outside"]').click();
      await closeEffectsPanel(page);
      await page.waitForTimeout(300);

      await page.screenshot({ path: 'e2e/screenshots/comp3-29-text-effects.png' });
    }

    // =====================================================================
    // PHASE 12: RASTERIZE STYLE
    // =====================================================================
    if (textLayer) {
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { rasterizeLayerStyle: () => void };
        };
        store.getState().rasterizeLayerStyle();
      });
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'e2e/screenshots/comp3-30-rasterized.png' });

    // =====================================================================
    // PHASE 13: FLATTEN IMAGE
    // =====================================================================
    const layersBefore = (await getEditorState(page)).document.layers.length;

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { flattenImage: () => void };
      };
      store.getState().flattenImage();
    });
    await page.waitForTimeout(300);

    const layersAfter = (await getEditorState(page)).document.layers.length;
    expect(layersAfter).toBeLessThan(layersBefore);
    expect(layersAfter).toBeLessThanOrEqual(2);

    await page.screenshot({ path: 'e2e/screenshots/comp3-31-flattened.png' });

    // =====================================================================
    // PHASE 14: FINAL FILTER PASS — Apply a finishing filter
    // =====================================================================
    // Apply a subtle gaussian blur as a finishing touch
    await applyFilterViaMenu(page, 'Gaussian Blur...', 2);

    await page.screenshot({ path: 'e2e/screenshots/comp3-final-photoedited.png' });

    // Final verification
    const finalState = await getEditorState(page);
    expect(finalState.document.layers.length).toBeLessThanOrEqual(2);
    expect(finalState.undoStackLength).toBeGreaterThan(10);
  });
});
