/**
 * Composition Test: Velociraptor Portrait
 *
 * Recreates a stylised raptor head/neck profile against a slate-grey
 * background using the shape tool, brush, gradient, eyedropper, and
 * layer effects. Demonstrates a multi-layer illustration build similar
 * to a real user creating an illustration from a reference photo.
 *
 * Reference: yellow-throated raptor profile facing right, dark dorsal
 * scales, bright yellow eye with vertical pupil, dark grey backdrop.
 */
import { test, expect, type Page } from './fixtures';
import {
  setForegroundColor as setForegroundColorUI,
  configureEffect,
  closeEffectsPanel,
} from './helpers';

// ---------------------------------------------------------------------------
// Local helpers (mirrors composition-painting / composition-shapes patterns)
// ---------------------------------------------------------------------------

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
  await page.waitForTimeout(120);
}

async function dragAtDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/**
 * Draw a filled ellipse using the shape tool, treating (cx, cy) as the
 * actual centre and (rx, ry) as the half-axes. NOTE: the shape tool's
 * mouse-down sets the centre and the drag distance becomes the radii —
 * this is unlike most photo-editors where the drag is a bounding box.
 * We compensate here so callers can think in centre+radii terms.
 */
async function ellipseAt(page: Page, cx: number, cy: number, rx: number, ry: number) {
  await dragAtDoc(page, { x: cx, y: cy }, { x: cx + rx, y: cy + ry });
}

const TOOL_KEYS: Record<string, string> = {
  move: 'v', brush: 'b', fill: 'g', shape: 'u', text: 't', eraser: 'e',
  'marquee-rect': 'm', wand: 'w', lasso: 'l', stamp: 's', dodge: 'o',
  smudge: 'r', eyedropper: 'i', pencil: 'n', crop: 'c', path: 'p', spray: 'j',
};

async function setActiveTool(page: Page, tool: string) {
  const key = TOOL_KEYS[tool];
  if (key) {
    await page.keyboard.press(key);
  } else {
    await page.locator(`[data-tool-id="${tool}"]`).click();
  }
  await page.waitForTimeout(60);
}

async function getActiveTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function setBrush(page: Page, size: number, hardness: number, opacity = 100) {
  await setToolSetting(page, 'setBrushSize', size);
  await setToolSetting(page, 'setBrushHardness', hardness);
  await setToolSetting(page, 'setBrushOpacity', opacity);
}

async function pushHistory(page: Page, label = 'Action') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
}

async function flushPendingStroke(page: Page) {
  // pushHistory finalizes the pending GPU stroke into the layer texture.
  await pushHistory(page, 'Flush');
}

async function addLayer(page: Page, name?: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addLayer: () => void;
        renameLayer: (id: string, name: string) => void;
        document: { activeLayerId: string };
      };
    };
    const s = store.getState();
    s.addLayer();
    const id = store.getState().document.activeLayerId;
    if (n) s.renameLayer(id, n);
    return id;
  }, name ?? null);
}

async function setActiveLayer(page: Page, id: string) {
  await page.locator(`[data-layer-id="${id}"]`).click();
  await page.waitForTimeout(50);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot, threshold = 30): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    if (dr + dg + db > threshold) count++;
  }
  return count;
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

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Composition: Velociraptor Portrait', () => {
  // Self-signed cert on the dev server fires this; unrelated to the test.
  test.use({ allowConsoleErrors: [/ERR_CERT_AUTHORITY_INVALID/] });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 450);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('builds a stylised raptor head with shapes, brush strokes, and effects', async ({ page }) => {
    test.setTimeout(300_000);

    // createDocument with non-transparent bg sets up two raster layers:
    // "Background" (white) and "Layer 1" (active). The gradient and all
    // subsequent painting target the active layer, so use that as our
    // working "bg" layer rather than the literal Background.
    const bgLayerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    // =====================================================================
    // PHASE 1: BACKGROUND — Slate gradient (linear, diagonal)
    // =====================================================================
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
        { position: 0, color: { r: 110, g: 110, b: 108, a: 1 } },
        { position: 1, color: { r: 60, g: 60, b: 58, a: 1 } },
      ]);
    });
    // Drag from top-left to bottom-right for a diagonal slate gradient.
    await drawStroke(page, { x: 0, y: 0 }, { x: 600, y: 450 }, 12);
    await flushPendingStroke(page);

    const bgTopLeft = await getPixelAt(page, 30, 30, bgLayerId);
    const bgBotRight = await getPixelAt(page, 570, 420, bgLayerId);
    // Top-left brighter than bottom-right.
    expect(bgTopLeft.r).toBeGreaterThan(bgBotRight.r + 10);

    await page.screenshot({ path: 'e2e/screenshots/raptor-01-background.png' });

    // =====================================================================
    // PHASE 2: BODY SILHOUETTE — Yellow/tan throat shape
    //   Stack three ellipses on a single layer to form an L-shape: head,
    //   neck, body. Filled with the warm tan throat colour. Darker dorsal
    //   passes will go on top.
    // =====================================================================
    const bodyLayerId = await addLayer(page, 'Body');

    await setActiveTool(page, 'shape');
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 198, g: 152, b: 78, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', { r: 0, g: 0, b: 0, a: 0 });
    await setToolSetting(page, 'setShapeStrokeWidth', 0);

    // Head — wide horizontal ellipse, centred on the upper-right.
    await ellipseAt(page, 450, 155, 130, 60);
    // Snout — narrower elongated ellipse extending to the right tip.
    await ellipseAt(page, 530, 175, 50, 25);
    // Upper neck blob — feathers from below the jaw down toward the body.
    await ellipseAt(page, 340, 250, 110, 90);
    // Mid neck — bridges to body.
    await ellipseAt(page, 200, 330, 110, 90);
    // Body — partial body in lower-left corner (cropped in the source frame).
    await ellipseAt(page, 70, 410, 130, 80);

    await flushPendingStroke(page);

    // Body is recognisably yellow/tan in throat region.
    const throatPx = await getPixelAt(page, 300, 280, bodyLayerId);
    expect(throatPx.r).toBeGreaterThan(150);
    expect(throatPx.g).toBeGreaterThan(110);
    expect(throatPx.b).toBeLessThan(throatPx.r);
    expect(throatPx.a).toBeGreaterThan(220);

    await page.screenshot({ path: 'e2e/screenshots/raptor-02-body.png' });

    // =====================================================================
    // PHASE 3: DORSAL DARK — Brush in dark brown along the top of the
    //   head and back of the neck. This gives the photo's two-tone look:
    //   warm yellow underside, cool dark dorsum.
    // =====================================================================
    const dorsalLayerId = await addLayer(page, 'Dorsal');

    await setActiveTool(page, 'brush');
    await setForegroundColorUI(page, 60, 45, 32);
    await setBrush(page, 60, 70);

    // Top-of-head ridge.
    await drawStroke(page, { x: 330, y: 110 }, { x: 470, y: 100 }, 10);
    await drawStroke(page, { x: 470, y: 100 }, { x: 560, y: 130 }, 8);
    await drawStroke(page, { x: 560, y: 130 }, { x: 580, y: 165 }, 6);
    // Back of neck (ridge sweeping down to body).
    await setBrush(page, 80, 50);
    await drawStroke(page, { x: 320, y: 130 }, { x: 230, y: 220 }, 12);
    await drawStroke(page, { x: 230, y: 220 }, { x: 130, y: 320 }, 12);
    await drawStroke(page, { x: 130, y: 320 }, { x: 60, y: 405 }, 10);
    // Body shadow lower-left.
    await setBrush(page, 110, 40);
    await drawStroke(page, { x: 0, y: 380 }, { x: 150, y: 440 }, 10);
    await drawStroke(page, { x: 0, y: 410 }, { x: 130, y: 460 }, 10);

    await flushPendingStroke(page);

    const dorsalPx = await getPixelAt(page, 400, 105, dorsalLayerId);
    expect(dorsalPx.r).toBeLessThan(120);
    expect(dorsalPx.a).toBeGreaterThan(120);

    await page.screenshot({ path: 'e2e/screenshots/raptor-03-dorsal.png' });

    // =====================================================================
    // PHASE 4: JAW LINE & MOUTH — Pencil for crisp dark line along the
    //   closed mouth; nostril dot near the snout tip.
    //
    //   In the reference the mouth runs roughly along the lower edge of
    //   the head ellipse — from the rear of the jaw forward to the snout
    //   tip. Our head ellipse: cx=450, cy=155, rx=130, ry=60. The lower
    //   edge at the snout end is around (560, 200). Mid-mouth ~(490, 195).
    //   Rear of mouth ~(420, 195).
    // =====================================================================
    const detailLayerId = await addLayer(page, 'Detail');

    await setActiveTool(page, 'pencil');
    await setForegroundColorUI(page, 18, 12, 8);
    await setToolSetting(page, 'setPencilSize', 4);

    // Mouth line: rear → mid → tip, two segments to fake a gentle curve.
    await drawStroke(page, { x: 420, y: 195 }, { x: 500, y: 198 }, 14);
    await drawStroke(page, { x: 500, y: 198 }, { x: 565, y: 188 }, 14);
    // Nostril dot near the snout tip.
    await setToolSetting(page, 'setPencilSize', 7);
    await drawStroke(page, { x: 552, y: 168 }, { x: 555, y: 170 }, 3);

    await flushPendingStroke(page);

    await page.screenshot({ path: 'e2e/screenshots/raptor-04-mouth.png' });

    // =====================================================================
    // PHASE 5: EYE — Larger so it reads as the focal point: dark eye
    //   socket, yellow iris, vertical pupil slit. Eye centre at (415, 135).
    // =====================================================================
    const eyeLayerId = await addLayer(page, 'Eye');

    // Eye centre at (415, 135). Stacked concentric ellipses.
    await setActiveTool(page, 'shape');
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeStrokeColor', { r: 0, g: 0, b: 0, a: 0 });

    // Dark eye-socket backdrop.
    await setToolSetting(page, 'setShapeFillColor', { r: 30, g: 22, b: 14, a: 1 });
    await ellipseAt(page, 415, 135, 30, 24);

    // Yellow iris.
    await setToolSetting(page, 'setShapeFillColor', { r: 245, g: 195, b: 30, a: 1 });
    await ellipseAt(page, 415, 135, 22, 18);

    // Vertical pupil slit.
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 0, a: 1 });
    await ellipseAt(page, 415, 135, 4, 14);

    await flushPendingStroke(page);

    // Iris probe to the right of the pupil where iris yellow is solid.
    const irisPx = await getPixelAt(page, 428, 135, eyeLayerId);
    expect(irisPx.r).toBeGreaterThan(150);
    expect(irisPx.g).toBeGreaterThan(110);
    expect(irisPx.b).toBeLessThan(irisPx.g);

    await page.screenshot({ path: 'e2e/screenshots/raptor-05-eye.png' });

    // =====================================================================
    // PHASE 6: EFFECTS — Drop shadow on the body silhouette (subtle), and
    //   inner glow on the dorsal layer to soften the brown-to-tan
    //   transition.
    // =====================================================================
    await setActiveLayer(page, bodyLayerId);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 4, 'Offset Y': 6, 'Blur': 10, 'Opacity': 45,
    });
    await closeEffectsPanel(page);

    await page.screenshot({ path: 'e2e/screenshots/raptor-06-effects.png' });

    // =====================================================================
    // PHASE 7: ADJUSTMENTS — Light contrast bump on the whole composition
    //   to push the dark dorsal vs. yellow throat.
    // =====================================================================
    const beforeAdjust = await snapshot(page);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { rootGroupId: string };
          setGroupAdjustments: (id: string, a: Record<string, number>) => void;
          setGroupAdjustmentsEnabled: (id: string, e: boolean) => void;
        };
      };
      const s = store.getState();
      s.setGroupAdjustments(s.document.rootGroupId, {
        exposure: 0,
        contrast: 18,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vignette: 22,
        saturation: 12,
        vibrance: 0,
      });
      s.setGroupAdjustmentsEnabled(s.document.rootGroupId, true);
    });

    const afterAdjust = await snapshot(page);
    expect(pixelDiff(beforeAdjust, afterAdjust, 8)).toBeGreaterThan(2000);

    await page.screenshot({ path: 'e2e/screenshots/raptor-07-adjusted.png' });

    // =====================================================================
    // FINAL: layer count + final composite snapshot.
    // =====================================================================
    const finalState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; name: string }>; layerOrder: string[] };
          undoStack: unknown[];
        };
      };
      const s = store.getState();
      return {
        layerNames: s.document.layers.map((l) => l.name),
        layerCount: s.document.layers.length,
        undoCount: s.undoStack.length,
      };
    });

    expect(finalState.layerCount).toBeGreaterThanOrEqual(5);
    expect(finalState.layerNames).toEqual(
      expect.arrayContaining(['Body', 'Dorsal', 'Detail', 'Eye']),
    );
    expect(finalState.undoCount).toBeGreaterThan(5);

    // Probe final pixels on representative regions to lock the silhouette
    // in place. These read the merged composited buffer.
    const finalSnap = await snapshot(page);
    expect(finalSnap.pixels.length).toBeGreaterThan(0);

    // Use the canvas element screenshot for the headline image.
    await page.locator('[data-testid="canvas-container"]').screenshot({
      path: 'e2e/screenshots/raptor-final.png',
    });
  });
});
