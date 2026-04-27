/**
 * Composition Test 1: Painted Landscape
 *
 * Covers: Brush (multiple presets), Pencil, Eraser, Smudge, Dodge/Burn,
 * Gradient (linear + radial), Clone Stamp, Eyedropper,
 * Layer effects (shadow, glow, stroke, color overlay),
 * Blend modes (Multiply, Screen, Overlay, Color Dodge),
 * Image adjustments (exposure, contrast, saturation, vignette),
 * Layer operations (add, duplicate, merge, opacity, visibility, reorder),
 * Undo/redo, keyboard shortcuts, brush presets.
 */
import { test, expect, type Page } from './fixtures';
import {
  setToolOption,
  setForegroundColor as setForegroundColorUI,
  setBlendMode,
  setLayerOpacity,
  setAdjustment,
  closeEffectsPanel,
  configureEffect,
  setEffectColor,
  enableEffect,
  setBrushModalOption,
  closeBrushModal,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 600, height = 400, transparent = false) {
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

async function drawStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 15,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
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
            visible: boolean;
            opacity: number;
            blendMode: string;
            x: number;
            y: number;
            width: number;
            height: number;
            effects: Record<string, { enabled: boolean }>;
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

async function pushHistory(page: Page, label = 'Action') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
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

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Composition 1: Painted Landscape', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('paints a multi-layer landscape with all painting tools, effects, and adjustments', async ({ page }) => {
    test.setTimeout(300_000);

    // =====================================================================
    // PHASE 1: SKY — Gradient tool (linear)
    // =====================================================================
    const state0 = await getEditorState(page);
    const bgLayerId = state0.document.layers[0]!.id;

    await setActiveTool(page, 'gradient');
    expect(await getActiveTool(page)).toBe('gradient');

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setGradientType: (t: string) => void;
          setGradientStops: (s: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>) => void;
        };
      };
      const s = store.getState();
      s.setGradientType('linear');
      s.setGradientStops([
        { position: 0, color: { r: 25, g: 25, b: 112, a: 1 } },
        { position: 0.4, color: { r: 135, g: 206, b: 235, a: 1 } },
        { position: 0.7, color: { r: 255, g: 165, b: 0, a: 1 } },
        { position: 1, color: { r: 255, g: 69, b: 0, a: 1 } },
      ]);
    });

    await drawStroke(page, { x: 300, y: 0 }, { x: 300, y: 399 }, 10);

    const skySnap = await snapshot(page);
    const baselineSnap = { width: skySnap.width, height: skySnap.height, pixels: new Array(skySnap.pixels.length).fill(255) };
    expect(pixelDiff(baselineSnap, skySnap)).toBeGreaterThan(1000);

    const topPixel = await getPixelAt(page, 300, 10);
    expect(topPixel.b).toBeGreaterThan(80);

    await page.screenshot({ path: 'e2e/screenshots/comp1-01-sky-gradient.png' });

    // =====================================================================
    // PHASE 2: SUN — Radial gradient on new layer
    // =====================================================================
    const sunLayerId = await addLayer(page);

    await setActiveTool(page, 'gradient');
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setGradientType: (t: string) => void;
          setGradientStops: (s: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>) => void;
        };
      };
      const s = store.getState();
      s.setGradientType('radial');
      s.setGradientStops([
        { position: 0, color: { r: 255, g: 255, b: 200, a: 1 } },
        { position: 0.5, color: { r: 255, g: 200, b: 50, a: 0.6 } },
        { position: 1, color: { r: 255, g: 100, b: 0, a: 0 } },
      ]);
    });

    await drawStroke(page, { x: 480, y: 80 }, { x: 560, y: 160 }, 5);

    const sunPixel = await getPixelAt(page, 480, 80, sunLayerId);
    expect(sunPixel.r).toBeGreaterThan(200);

    // Set sun layer to Screen blend mode
    await page.locator(`[data-layer-id="${sunLayerId}"]`).click();
    await setBlendMode(page, 'screen');

    await page.screenshot({ path: 'e2e/screenshots/comp1-02-sun-radial.png' });

    // =====================================================================
    // PHASE 3: MOUNTAINS — Brush tool with hard brush
    // =====================================================================
    const mountainLayerId = await addLayer(page);

    await page.keyboard.press('b');
    expect(await getActiveTool(page)).toBe('brush');

    await setToolOption(page, 'Size', 60);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 15);
    await closeBrushModal(page);

    await setForegroundColorUI(page, 50, 60, 80);

    // Draw mountain silhouette
    await drawStroke(page, { x: 0, y: 280 }, { x: 100, y: 200 }, 8);
    await drawStroke(page, { x: 100, y: 200 }, { x: 180, y: 160 }, 8);
    await drawStroke(page, { x: 180, y: 160 }, { x: 260, y: 220 }, 8);
    await drawStroke(page, { x: 260, y: 220 }, { x: 350, y: 140 }, 8);
    await drawStroke(page, { x: 350, y: 140 }, { x: 450, y: 200 }, 8);
    await drawStroke(page, { x: 450, y: 200 }, { x: 550, y: 180 }, 8);
    await drawStroke(page, { x: 550, y: 180 }, { x: 600, y: 250 }, 8);

    // Fill below mountains
    await setToolOption(page, 'Size', 120);
    for (let y = 250; y < 400; y += 60) {
      await drawStroke(page, { x: 0, y }, { x: 600, y }, 6);
    }

    await page.screenshot({ path: 'e2e/screenshots/comp1-03-mountains.png' });

    // =====================================================================
    // PHASE 4: PENCIL — Draw mountain snow caps
    // =====================================================================
    await page.keyboard.press('n');
    expect(await getActiveTool(page)).toBe('pencil');

    await setToolOption(page, 'Size', 4);
    await setForegroundColorUI(page, 240, 240, 255);

    await drawStroke(page, { x: 170, y: 162 }, { x: 190, y: 170 }, 5);
    await drawStroke(page, { x: 340, y: 142 }, { x: 360, y: 150 }, 5);

    await page.screenshot({ path: 'e2e/screenshots/comp1-04-pencil-snowcaps.png' });

    // =====================================================================
    // PHASE 5: ERASER — Clean up mountain edges
    // =====================================================================
    await page.keyboard.press('e');
    expect(await getActiveTool(page)).toBe('eraser');

    await setToolOption(page, 'Size', 20);
    await setToolOption(page, 'Opacity', 80);

    const beforeErase = await snapshot(page);
    await drawStroke(page, { x: 580, y: 180 }, { x: 600, y: 200 }, 5);
    const afterErase = await snapshot(page);

    expect(pixelDiff(beforeErase, afterErase)).toBeGreaterThan(10);

    await page.screenshot({ path: 'e2e/screenshots/comp1-05-eraser.png' });

    // =====================================================================
    // PHASE 6: GROUND — Soft brush with low opacity for depth
    // =====================================================================
    const groundLayerId = await addLayer(page);

    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 100);
    await setToolOption(page, 'Hardness', 0);
    await setToolOption(page, 'Opacity', 60);
    await setBrushModalOption(page, 'Spacing', 20);
    await closeBrushModal(page);

    await setForegroundColorUI(page, 34, 80, 34);

    for (let y = 300; y < 400; y += 50) {
      await drawStroke(page, { x: 0, y }, { x: 600, y }, 6);
    }

    // Set ground to Multiply blend mode
    await page.locator(`[data-layer-id="${groundLayerId}"]`).click();
    await setBlendMode(page, 'multiply');

    await page.screenshot({ path: 'e2e/screenshots/comp1-06-ground.png' });

    // =====================================================================
    // PHASE 7: SMUDGE — Blend mountain edges
    // =====================================================================
    await page.locator(`[data-layer-id="${mountainLayerId}"]`).click();

    await page.keyboard.press('r');
    expect(await getActiveTool(page)).toBe('smudge');

    await setToolOption(page, 'Size', 40);
    await setToolOption(page, 'Strength', 70);

    const beforeSmudge = await snapshot(page);
    await drawStroke(page, { x: 180, y: 170 }, { x: 220, y: 200 }, 10);
    await drawStroke(page, { x: 350, y: 150 }, { x: 380, y: 180 }, 10);
    const afterSmudge = await snapshot(page);

    expect(pixelDiff(beforeSmudge, afterSmudge)).toBeGreaterThan(50);

    await page.screenshot({ path: 'e2e/screenshots/comp1-07-smudge.png' });

    // =====================================================================
    // PHASE 8: DODGE/BURN — Add lighting to mountains
    // =====================================================================
    await page.keyboard.press('o');
    expect(await getActiveTool(page)).toBe('dodge');

    // Dodge (lighten) the left side of mountains
    await setToolOption(page, 'Size', 50);
    await setToolOption(page, 'Exposure', 60);
    await setToolSetting(page, 'setDodgeMode', 'dodge');

    const beforeDodge = await snapshot(page);
    await drawStroke(page, { x: 160, y: 180 }, { x: 200, y: 240 }, 8);
    const afterDodge = await snapshot(page);

    expect(pixelDiff(beforeDodge, afterDodge)).toBeGreaterThan(20);

    // Burn (darken) the right side
    await setToolSetting(page, 'setDodgeMode', 'burn');
    const beforeBurn = await snapshot(page);
    await drawStroke(page, { x: 370, y: 160 }, { x: 420, y: 220 }, 8);
    const afterBurn = await snapshot(page);

    expect(pixelDiff(beforeBurn, afterBurn)).toBeGreaterThan(20);

    await page.screenshot({ path: 'e2e/screenshots/comp1-08-dodge-burn.png' });

    // =====================================================================
    // PHASE 9: CLONE STAMP — Duplicate a mountain feature
    // =====================================================================
    await page.keyboard.press('s');
    expect(await getActiveTool(page)).toBe('stamp');

    await setToolOption(page, 'Size', 30);

    // Alt+click to set source
    const sourceScreen = await docToScreen(page, 180, 200);
    await page.keyboard.down('Alt');
    await page.mouse.click(sourceScreen.x, sourceScreen.y);
    await page.keyboard.up('Alt');
    await page.waitForTimeout(100);

    const beforeStamp = await snapshot(page);
    await drawStroke(page, { x: 400, y: 250 }, { x: 440, y: 280 }, 8);
    const afterStamp = await snapshot(page);

    expect(pixelDiff(beforeStamp, afterStamp)).toBeGreaterThan(10);

    await page.screenshot({ path: 'e2e/screenshots/comp1-09-clone-stamp.png' });

    // =====================================================================
    // PHASE 10: EYEDROPPER — Sample a color from the painting
    // =====================================================================
    await page.keyboard.press('i');
    expect(await getActiveTool(page)).toBe('eyedropper');

    const sampleScreen = await docToScreen(page, 300, 50);
    await page.mouse.click(sampleScreen.x, sampleScreen.y);
    await page.waitForTimeout(200);

    const sampledColor = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { foregroundColor: { r: number; g: number; b: number; a: number } };
      };
      return store.getState().foregroundColor;
    });
    expect(sampledColor.a).toBe(1);
    expect(sampledColor.r + sampledColor.g + sampledColor.b).toBeGreaterThan(0);

    // =====================================================================
    // PHASE 11: LAYER EFFECTS — Drop shadow, outer glow, stroke
    // =====================================================================
    await page.locator(`[data-layer-id="${mountainLayerId}"]`).click();
    await configureEffect(page, 'Drop Shadow', { 'Offset X': 4, 'Offset Y': 6, 'Blur': 8, 'Spread': 0, 'Opacity': 50 });
    await setEffectColor(page, 'Shadow color', 0, 0, 0);
    await configureEffect(page, 'Outer Glow', { 'Size': 10, 'Spread': 0, 'Opacity': 30 });
    await setEffectColor(page, 'Glow color', 255, 200, 100);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp1-10-mountain-effects.png' });

    // Inner glow and stroke on ground
    await page.locator(`[data-layer-id="${groundLayerId}"]`).click();
    await configureEffect(page, 'Inner Glow', { 'Size': 6, 'Spread': 0, 'Opacity': 40 });
    await setEffectColor(page, 'Glow color', 200, 255, 200);
    await configureEffect(page, 'Stroke', { 'Width': 2 });
    await setEffectColor(page, 'Stroke color', 20, 60, 20);
    await page.locator('[aria-label="Stroke position: outside"]').click();
    await page.waitForTimeout(300);

    // Color overlay on sun layer
    await page.locator(`[data-layer-id="${sunLayerId}"]`).click();
    await enableEffect(page, 'Color Overlay');
    await setEffectColor(page, 'Overlay color', 255, 230, 150);
    await closeEffectsPanel(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp1-11-all-effects.png' });

    // Verify effects are set
    const stateWithEffects = await getEditorState(page);
    const mtnLayer = stateWithEffects.document.layers.find((l) => l.id === mountainLayerId)!;
    expect(mtnLayer.effects.dropShadow.enabled).toBe(true);
    expect(mtnLayer.effects.outerGlow.enabled).toBe(true);

    // =====================================================================
    // PHASE 12: BLEND MODES — Overlay and Color Dodge
    // =====================================================================
    const overlayLayerId = await addLayer(page);

    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 200);
    await setToolOption(page, 'Hardness', 0);
    await setToolOption(page, 'Opacity', 100);

    await setForegroundColorUI(page, 255, 220, 100);
    await drawStroke(page, { x: 400, y: 100 }, { x: 500, y: 150 }, 5);

    await page.locator(`[data-layer-id="${overlayLayerId}"]`).click();
    await setBlendMode(page, 'overlay');
    await setLayerOpacity(page, overlayLayerId, 60);

    await page.screenshot({ path: 'e2e/screenshots/comp1-12-blend-modes.png' });

    // =====================================================================
    // PHASE 13: LAYER OPERATIONS — Duplicate, visibility, opacity
    // =====================================================================
    // Duplicate the mountain layer
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setActiveLayer: (id: string) => void;
          duplicateLayer: () => void;
        };
      };
      const s = store.getState();
      s.setActiveLayer(lid);
      s.duplicateLayer();
    }, mountainLayerId);
    await page.waitForTimeout(200);

    const stateAfterDupe = await getEditorState(page);
    const dupeLayer = stateAfterDupe.document.layers.find(
      (l) => l.id !== mountainLayerId && l.name.includes('copy'),
    );
    expect(dupeLayer).toBeTruthy();

    // Toggle visibility on duplicate
    await page.locator(`[data-layer-id="${dupeLayer!.id}"]`).locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]').click();

    const dupLayerState = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; visible: boolean }> };
        };
      };
      return store.getState().document.layers.find((l) => l.id === lid)?.visible;
    }, dupeLayer!.id);
    expect(dupLayerState).toBe(false);

    // Turn it back on and set low opacity
    await page.locator(`[data-layer-id="${dupeLayer!.id}"]`).locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]').click();
    await setLayerOpacity(page, dupeLayer!.id, 30);

    await page.screenshot({ path: 'e2e/screenshots/comp1-13-layer-ops.png' });

    // =====================================================================
    // PHASE 14: IMAGE ADJUSTMENTS — Exposure, contrast, saturation, vignette
    // =====================================================================
    await setAdjustment(page, 'Exposure', 0.15);
    await setAdjustment(page, 'Contrast', 20);
    await setAdjustment(page, 'Saturation', 15);
    await setAdjustment(page, 'Vignette', 30);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp1-14-adjustments.png' });

    // =====================================================================
    // PHASE 15: BRUSH PRESETS — Scatter brush for stars
    // =====================================================================
    const starsLayerId = await addLayer(page);

    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 4);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 150);
    await setBrushModalOption(page, 'Scatter', 100);
    await closeBrushModal(page);
    await setToolOption(page, 'Opacity', 100);

    await setForegroundColorUI(page, 255, 255, 240);

    for (let y = 20; y < 150; y += 30) {
      await drawStroke(page, { x: 20, y }, { x: 400, y }, 8);
    }

    await page.locator(`[data-layer-id="${starsLayerId}"]`).click();
    await setBlendMode(page, 'screen');

    await page.screenshot({ path: 'e2e/screenshots/comp1-15-stars.png' });

    // =====================================================================
    // PHASE 16: UNDO/REDO — Verify history works
    // =====================================================================
    const beforeUndo = await snapshot(page);

    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    const afterUndo = await snapshot(page);
    expect(pixelDiff(beforeUndo, afterUndo)).toBeGreaterThan(0);

    // Redo
    await page.keyboard.press('Shift+Meta+z');
    await page.waitForTimeout(300);

    const afterRedo = await snapshot(page);
    expect(pixelDiff(beforeUndo, afterRedo)).toBeLessThan(50);

    // =====================================================================
    // PHASE 17: MERGE DOWN — Merge duplicate into mountain layer
    // =====================================================================
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setActiveLayer: (id: string) => void;
          mergeDown: () => void;
        };
      };
      const s = store.getState();
      s.setActiveLayer(lid);
      s.mergeDown();
    }, dupeLayer!.id);
    await page.waitForTimeout(200);

    const stateAfterMerge = await getEditorState(page);
    const mergedLayerStillExists = stateAfterMerge.document.layers.some((l) => l.id === dupeLayer!.id);
    expect(mergedLayerStillExists).toBe(false);

    // =====================================================================
    // PHASE 18: KEYBOARD SHORTCUTS — Color swap, default colors
    // =====================================================================
    await setForegroundColorUI(page, 255, 0, 0);

    await page.keyboard.press('x');
    await page.waitForTimeout(100);

    const afterSwap = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          foregroundColor: { r: number; g: number; b: number; a: number };
          backgroundColor: { r: number; g: number; b: number; a: number };
        };
      };
      return store.getState();
    });
    expect(afterSwap.backgroundColor.r).toBe(255);

    await page.keyboard.press('d');
    await page.waitForTimeout(100);

    const afterDefault = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { foregroundColor: { r: number; g: number; b: number; a: number } };
      };
      return store.getState().foregroundColor;
    });
    expect(afterDefault.r).toBe(0);
    expect(afterDefault.g).toBe(0);
    expect(afterDefault.b).toBe(0);

    // =====================================================================
    // FINAL SCREENSHOT
    // =====================================================================
    await page.screenshot({ path: 'e2e/screenshots/comp1-final-landscape.png' });

    // Final state verification
    const finalState = await getEditorState(page);
    expect(finalState.document.layers.length).toBeGreaterThanOrEqual(4);
    expect(finalState.undoStackLength).toBeGreaterThan(5);
  });
});
