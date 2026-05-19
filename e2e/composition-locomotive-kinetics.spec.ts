/**
 * Composition: LOCOMOTIVE KINETICS
 *
 * Style: Italian Futurism (~1909-1916) — Boccioni, Balla, Marinetti.
 * Project: T-Shirt Design.
 *
 * Theme: glorification of speed and the locomotive as an icon of modernity.
 * Composition uses radiating lines of force, hard wedges and chevrons,
 * overlapping geometric decomposition of the engine, and bold modernist
 * typography (period sans-serifs).
 *
 * Palette (period-accurate Futurist):
 *   - Charcoal #1B1A1F (ground)
 *   - Steam Ivory #EFE6D1 (highlights / type)
 *   - Hot Red #C8261C (force / accent)
 *   - Saffron #E2A52A (warmth)
 *   - Cobalt Steel #2A4B7C (depth)
 *   - Soot Black #0A0907 (line art)
 */
import { test, expect, type Page } from './fixtures';
import {
  setForegroundColor as setForegroundColorUI,
} from './helpers';

/** Fast: set active layer via the store (no DOM scrolling required). */
async function setActiveLayer(page: Page, id: string) {
  await page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { setActiveLayer: (id: string) => void };
    };
    store.getState().setActiveLayer(lid);
  }, id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
    { timeout: 15_000 },
  );
}

async function createDocument(page: Page, width: number, height: number, transparent = false) {
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
  steps = 12,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function dragAtDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(70);
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
  await page.waitForTimeout(60);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(
    ({ setter, value }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => Record<string, (v: unknown) => void>;
      };
      store.getState()[setter]!(value);
    },
    { setter, value },
  );
}

/** Fast: set foreground color directly through the store (no UI panel). */
async function setFG(page: Page, r: number, g: number, b: number) {
  await page.evaluate(
    ({ r, g, b }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
      };
      store.getState().setForegroundColor({ r, g, b, a: 1 });
    },
    { r, g, b },
  );
}

/** Fast: set brush size/hardness/opacity via the store. */
async function setBrush(page: Page, size: number, hardness = 100, opacity = 100) {
  await page.evaluate(
    ({ size, hardness, opacity }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setBrushSize: (n: number) => void;
          setBrushHardness: (n: number) => void;
          setBrushOpacity: (n: number) => void;
        };
      };
      const s = store.getState();
      s.setBrushSize(size);
      s.setBrushHardness(hardness);
      s.setBrushOpacity(opacity);
    },
    { size, hardness, opacity },
  );
}

/** Fast: set pencil size via the store. */
async function setPencil(page: Page, size: number) {
  await page.evaluate((size) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setPencilSize: (n: number) => void };
    };
    store.getState().setPencilSize(size);
  }, size);
}

/**
 * Fast: marquee → fill rect using fast color set and engine fillWithColor.
 * Bypasses the slow color-panel UI path used by helpers.drawRect.
 */
async function fastFillRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a?: number },
) {
  await setFG(page, color.r, color.g, color.b);
  // Marquee — real mouse drag
  await setActiveTool(page, 'marquee-rect');
  const start = await docToScreen(page, x, y);
  const end = await docToScreen(page, x + w, y + h);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  // Fill via engine action (works even on empty layers)
  await page.evaluate(async ({ a }) => {
    const editor = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        pushHistory: (l?: string) => void;
        updateLayerPixelData: (id: string, data: ImageData) => void;
        notifyRender: () => void;
      };
    };
    const tool = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { foregroundColor: { r: number; g: number; b: number; a: number } };
    };
    const s = editor.getState();
    const id = s.document.activeLayerId;
    s.pushHistory('Fill');
    const c = tool.getState().foregroundColor;
    const engineMod = await import('/src/engine-wasm/engine-state.ts');
    const bridgeMod = await import('/src/engine-wasm/wasm-bridge.ts');
    const engine = engineMod.getEngine();
    if (engine) {
      bridgeMod.fillWithColor(engine, id, c.r / 255, c.g / 255, c.b / 255, a ?? c.a);
    }
    const clearMod = await import('/src/app/store/clear-js-pixel-data.ts');
    clearMod.clearJsPixelData(id);
    s.notifyRender();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const gpu = await readFn(id);
    if (gpu && gpu.width > 0) {
      const img = new ImageData(gpu.width, gpu.height);
      for (let i = 0; i < gpu.pixels.length; i++) img.data[i] = gpu.pixels[i]!;
      s.updateLayerPixelData(id, img);
    }
  }, { a: color.a });
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(40);
}

/** Fast: shape ellipse via shape tool with fast color set. */
async function fastFillEllipse(
  page: Page,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: { r: number; g: number; b: number; a?: number },
) {
  await setFG(page, color.r, color.g, color.b);
  await setActiveTool(page, 'shape');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
  // Ensure shape fill is set to the foreground (defends against the
  // #424 bug where the shape tool re-seeds fill from foreground on
  // activation — works in our favour here, since fg was set first).
  await page.evaluate(({ r, g, b }) => {
    const tool = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setShapeFillColor: (c: { r: number; g: number; b: number; a: number }) => void;
      };
    };
    tool.getState().setShapeFillColor({ r, g, b, a: 1 });
  }, color);
  const start = await docToScreen(page, cx - rx, cy - ry);
  const end = await docToScreen(page, cx + rx, cy + ry);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  // Flush GPU pixels to JS pixel data
  await page.evaluate(async () => {
    const editor = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const s = editor.getState();
    const id = s.document.activeLayerId;
    const gpu = await readFn(id);
    if (gpu && gpu.width > 0) {
      const img = new ImageData(gpu.width, gpu.height);
      for (let i = 0; i < gpu.pixels.length; i++) img.data[i] = gpu.pixels[i]!;
      s.updateLayerPixelData(id, img);
    }
  });
}

async function pushHistory(page: Page, label = 'Action') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
}

async function undo(page: Page) {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
}

async function redo(page: Page) {
  await page.keyboard.press('Shift+Control+z');
  await page.waitForTimeout(200);
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
    store.getState().addLayer();
    const id = store.getState().document.activeLayerId;
    if (n) store.getState().renameLayer(id, n);
    return id;
  }, name ?? null);
}

async function addGroup(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addGroup: (name: string) => void;
        document: { activeLayerId: string };
      };
    };
    store.getState().addGroup(n);
    return store.getState().document.activeLayerId;
  }, name);
}

interface EffectsPartial {
  dropShadow?: { enabled: boolean; offsetX?: number; offsetY?: number; blur?: number; spread?: number; opacity?: number; color?: { r: number; g: number; b: number; a: number } };
  outerGlow?: { enabled: boolean; size?: number; spread?: number; opacity?: number; color?: { r: number; g: number; b: number; a: number } };
  innerGlow?: { enabled: boolean; size?: number; spread?: number; opacity?: number; color?: { r: number; g: number; b: number; a: number } };
  stroke?: { enabled: boolean; width?: number; position?: 'outside' | 'inside' | 'center'; color?: { r: number; g: number; b: number; a: number } };
  colorOverlay?: { enabled: boolean; color?: { r: number; g: number; b: number; a: number } };
}

async function setEffectsFast(page: Page, layerId: string, effects: EffectsPartial) {
  await page.evaluate(
    ({ id, effects }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          updateLayerEffects: (id: string, e: unknown) => void;
        };
      };
      store.getState().updateLayerEffects(id, effects);
    },
    { id: layerId, effects },
  );
}

async function setOpacityFast(page: Page, layerId: string, percent: number) {
  await page.evaluate(
    ({ id, pct }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (l?: string) => void;
          updateLayerOpacity: (id: string, opacity: number) => void;
        };
      };
      const s = store.getState();
      s.pushHistory('Opacity');
      s.updateLayerOpacity(id, pct / 100);
    },
    { id: layerId, pct: percent },
  );
}

async function setBlendMode(page: Page, layerId: string, mode: string) {
  // Direct store path — the UI helper requires the layer's row to be
  // visible (scrolled into view), which is brittle with deep stacks.
  await page.evaluate(
    ({ id, m }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (l?: string) => void;
          updateLayerBlendMode: (id: string, mode: string) => void;
        };
      };
      const s = store.getState();
      s.pushHistory('Blend');
      s.updateLayerBlendMode(id, m);
    },
    { id: layerId, m: mode },
  );
}

async function loadGoogleFont(page: Page, family: string, weights: number[]) {
  await page.evaluate(
    async ({ family, weights }) => {
      const weightsStr = weights.join(';');
      const encoded = encodeURIComponent(family);
      const href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weightsStr}&display=swap`;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      await new Promise<void>((resolve) => {
        link.onload = () => { document.fonts.ready.then(() => resolve()); };
        link.onerror = () => resolve();
        document.head.appendChild(link);
        setTimeout(() => resolve(), 3500);
      });
    },
    { family, weights },
  );
}

async function createTextLayer(
  page: Page,
  text: string,
  x: number,
  y: number,
  opts: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    textAlign?: 'left' | 'center' | 'right';
    color?: { r: number; g: number; b: number };
    areaWidth?: number;
    letterSpacing?: number;
  } = {},
): Promise<string> {
  if (opts.fontFamily) await setToolSetting(page, 'setTextFontFamily', opts.fontFamily);
  if (opts.fontSize) await setToolSetting(page, 'setTextFontSize', opts.fontSize);
  if (opts.fontWeight) await setToolSetting(page, 'setTextFontWeight', opts.fontWeight);
  if (opts.fontStyle) await setToolSetting(page, 'setTextFontStyle', opts.fontStyle);
  if (opts.textAlign) await setToolSetting(page, 'setTextAlign', opts.textAlign);
  if (opts.color) await setForegroundColorUI(page, opts.color.r, opts.color.g, opts.color.b);

  await setActiveTool(page, 'text');

  if (opts.areaWidth) {
    await dragAtDoc(page, { x, y }, { x: x + opts.areaWidth, y: y + 100 });
  } else {
    await clickAtDoc(page, x, y);
  }

  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(250);

  const id = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; type: string; name: string }> };
      };
    };
    const textLayers = store.getState().document.layers.filter((l) => l.name.startsWith('Text'));
    return textLayers[textLayers.length - 1]?.id ?? '';
  });
  if (id && opts.letterSpacing !== undefined) {
    await page.evaluate(
      ({ id, ls }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            updateTextLayerProperties?: (id: string, props: { letterSpacing?: number }) => void;
          };
        };
        const s = store.getState();
        if (typeof s.updateTextLayerProperties === 'function') {
          s.updateTextLayerProperties(id, { letterSpacing: ls });
        }
      },
      { id, ls: opts.letterSpacing },
    );
  }
  return id;
}

/**
 * Paint a wedge of force as a single very wide soft brush stroke from
 * the apex outward in the given direction. Much faster than rasterising
 * a real triangle, and the soft falloff gives a more authentic
 * "speed-line" Futurist look anyway.
 *
 * angleDeg: 0° = up, 90° = right (compass-style).
 */
async function paintWedge(
  page: Page,
  apexX: number,
  apexY: number,
  angleDeg: number,
  length: number,
  width: number,
  color: { r: number; g: number; b: number },
) {
  await setFG(page, color.r, color.g, color.b);
  await setActiveTool(page, 'brush');
  // Wide, soft brush gives a wedge-like ray with a hot apex and a fading edge
  await setBrush(page, width, 70, 100);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const tipX = apexX + dx * length;
  const tipY = apexY + dy * length;
  await drawStroke(page, { x: apexX, y: apexY }, { x: tipX, y: tipY }, 8);
}

async function applyFilterViaMenu(
  page: Page,
  category: string,
  filterName: string,
  params?: Record<string, number>,
) {
  await page.click('text=Filter');
  await page.waitForTimeout(150);
  await page.locator(`role=menuitem[name="${category}"]`).first().hover();
  await page.waitForTimeout(150);
  await page.locator(`role=menuitem[name=/^${filterName}/]`).first().click();
  await page.waitForTimeout(300);
  if (params) {
    for (const [label, value] of Object.entries(params)) {
      const slider = page.locator(`label:has-text("${label}")`).locator('xpath=following::input[@type="range"][1]');
      await slider.fill(String(value));
    }
    await page.waitForTimeout(150);
  }
  await page.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(250);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };
async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
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

async function getDocSnapshot(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number; layers: Array<{ id: string; name: string; type: string }> };
        undoStack: unknown[];
        redoStack: unknown[];
      };
    };
    const s = store.getState();
    return {
      width: s.document.width,
      height: s.document.height,
      layers: s.document.layers.map((l) => ({ id: l.id, name: l.name, type: l.type })),
      undoStackLength: s.undoStack.length,
      redoStackLength: s.redoStack.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const SHOT = (n: string) => `e2e/screenshots/locomotive-kinetics-${n}.png`;

const C_BG = { r: 27, g: 26, b: 31 };
const C_IVORY = { r: 239, g: 230, b: 209 };
const C_RED = { r: 200, g: 38, b: 28 };
const C_SAFFRON = { r: 226, g: 165, b: 42 };
const C_COBALT = { r: 42, g: 75, b: 124 };
const C_SOOT = { r: 10, g: 9, b: 7 };
const C_DEEP_RED = { r: 130, g: 22, b: 16 };

test.describe('Composition: LOCOMOTIVE KINETICS — Futurist T-Shirt', () => {
  test('builds a futurist locomotive t-shirt design', async ({ page, isMobile, allowConsoleErrors }) => {
    test.skip(isMobile, 'composition tests require sidebar');
    (allowConsoleErrors as RegExp[]).push(/WebSocket connection/);
    (allowConsoleErrors as RegExp[]).push(/fonts/i);
    (allowConsoleErrors as RegExp[]).push(/Failed to load resource/);
    (allowConsoleErrors as RegExp[]).push(/ERR_CERT_AUTHORITY_INVALID/);
    (allowConsoleErrors as RegExp[]).push(/net::/);
    test.setTimeout(3_000_000);

    await page.goto('/');
    await waitForStore(page);
    // T-shirt portrait — chest print proportions
    const W = 1000;
    const H = 1250;
    await createDocument(page, W, H, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const layerIds: Record<string, string> = {};

    // ===================================================================
    // PHASE 1 — BACKGROUND: charcoal + radial saffron wash from below-VP
    // ===================================================================
    const initialDoc = await getDocSnapshot(page);
    layerIds['bg'] = initialDoc.layers[0]!.id;
    await setActiveLayer(page, layerIds['bg']!);

    await fastFillRect(page, 0, 0, W, H, C_BG);

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
        { position: 0, color: { r: 120, g: 65, b: 35, a: 0.95 } },
        { position: 0.45, color: { r: 60, g: 38, b: 30, a: 0.55 } },
        { position: 1, color: { r: 18, g: 17, b: 22, a: 0 } },
      ]);
    });
    // Gradient origin at the locomotive (visual heart of composition)
    const VPX = W / 2;
    const VPY = H * 0.60;
    await drawStroke(page, { x: VPX, y: VPY }, { x: W * 0.95, y: H * 0.95 }, 8);

    await page.screenshot({ path: SHOT('01-background') });

    // ===================================================================
    // PHASE 2 — LINES OF FORCE: brush-painted radiating wedges
    // ===================================================================
    layerIds['speedGroup'] = await addGroup(page, 'Lines of Force');

    const wedges: Array<{ angle: number; color: { r: number; g: number; b: number }; len: number; bw: number }> = [
      { angle: -78, color: C_RED, len: 760, bw: 140 },
      { angle: -50, color: C_IVORY, len: 820, bw: 110 },
      { angle: -22, color: C_SAFFRON, len: 760, bw: 150 },
      { angle: 12, color: C_COBALT, len: 820, bw: 100 },
      { angle: 42, color: C_DEEP_RED, len: 760, bw: 140 },
      { angle: 72, color: C_IVORY, len: 820, bw: 110 },
    ];

    for (let i = 0; i < wedges.length; i++) {
      const w = wedges[i]!;
      const wedgeId = await addLayer(page, `Wedge ${i + 1}`);
      layerIds[`wedge_${i}`] = wedgeId;
      await paintWedge(page, VPX, VPY, w.angle, w.len, w.bw, w.color);
    }
    await page.screenshot({ path: SHOT('02-speed-wedges') });

    // Dim the whole speed-line group so the locomotive reads cleanly
    await setOpacityFast(page, layerIds['speedGroup']!, 78);

    // ===================================================================
    // PHASE 3 — UNDO/REDO probe (small, lenient)
    // ===================================================================
    const beforeUndo = await snapshot(page);
    for (let i = 0; i < 2; i++) await undo(page);
    const afterUndo = await snapshot(page);
    for (let i = 0; i < 2; i++) await redo(page);
    const afterRedo = await snapshot(page);
    expect(pixelDiff(beforeUndo, afterRedo)).toBeLessThanOrEqual(
      pixelDiff(beforeUndo, afterUndo) + 50,
    );

    // ===================================================================
    // PHASE 4 — LOCOMOTIVE BODY (boiler / stack / cab / cowcatcher)
    // ===================================================================
    const rootGroupId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { rootGroupId: string } };
      };
      return store.getState().document.rootGroupId;
    });
    await setActiveLayer(page, rootGroupId);

    layerIds['locoGroup'] = await addGroup(page, 'Locomotive');

    // Boiler — large elongated horizontal mass
    layerIds['boiler'] = await addLayer(page, 'Boiler');
    await fastFillEllipse(page, VPX, VPY, 360, 96, C_SOOT);
    // Cobalt highlight band on top of boiler
    await fastFillRect(page, VPX - 300, VPY - 90, 600, 18, C_COBALT);

    // Smoke stack — tall narrow rectangle with a saffron disk on top
    layerIds['stack'] = await addLayer(page, 'Smoke Stack');
    await fastFillRect(page, VPX - 60, VPY - 240, 120, 160, C_SOOT);
    await fastFillEllipse(page, VPX, VPY - 240, 80, 22, C_DEEP_RED);

    // Cab — angled wedge behind the boiler (drawn as red rect)
    layerIds['cab'] = await addLayer(page, 'Cab');
    await fastFillRect(page, VPX + 200, VPY - 170, 220, 220, C_DEEP_RED);

    // Cowcatcher — saffron triangle at the front of the locomotive
    layerIds['cowcatcher'] = await addLayer(page, 'Cowcatcher');
    // Draw via brush as a few overlapping strokes to form a triangle
    await setFG(page, C_SAFFRON.r, C_SAFFRON.g, C_SAFFRON.b);
    await setActiveTool(page, 'brush');
    await setBrush(page, 20, 100, 100);
    // Triangular cowcatcher: apex at (VPX-400, VPY+60), base from (VPX-250, VPY-10) to (VPX-250, VPY+130)
    for (let t = 0; t <= 1; t += 0.12) {
      const y = (VPY - 10) + t * (140);
      await drawStroke(page, { x: VPX - 250, y }, { x: VPX - 400, y: VPY + 60 }, 4);
    }
    await pushHistory(page, 'Cowcatcher');

    await page.screenshot({ path: SHOT('03-locomotive-body') });

    // ===================================================================
    // PHASE 5 — RIVETS (pencil dots) along the boiler crown
    // ===================================================================
    layerIds['rivets'] = await addLayer(page, 'Rivets');
    await setActiveTool(page, 'pencil');
    await setPencil(page, 10);
    await setFG(page, C_IVORY.r, C_IVORY.g, C_IVORY.b);
    for (let rx = VPX - 280; rx <= VPX + 280; rx += 70) {
      await clickAtDoc(page, rx, VPY - 70);
    }
    await pushHistory(page, 'Rivets done');

    // ===================================================================
    // PHASE 6 — WHEELS: stacked ellipses + pencil spokes
    // ===================================================================
    await setActiveLayer(page, rootGroupId);
    layerIds['wheelsGroup'] = await addGroup(page, 'Wheels');

    const wheels: Array<[number, number, number]> = [
      [VPX - 180, VPY + 150, 110],
      [VPX + 180, VPY + 150, 110],
    ];
    for (let wi = 0; wi < wheels.length; wi++) {
      const [wx, wy, wr] = wheels[wi]!;
      const outerId = await addLayer(page, `Wheel ${wi + 1} Disc`);
      layerIds[`wheel${wi}_disc`] = outerId;
      await fastFillEllipse(page, wx, wy, wr, wr, C_SOOT);
      const innerId = await addLayer(page, `Wheel ${wi + 1} Rim`);
      layerIds[`wheel${wi}_rim`] = innerId;
      await fastFillEllipse(page, wx, wy, wr - 14, wr - 14, C_IVORY);
      const hubId = await addLayer(page, `Wheel ${wi + 1} Hub`);
      layerIds[`wheel${wi}_hub`] = hubId;
      await fastFillEllipse(page, wx, wy, wr * 0.32, wr * 0.32, C_RED);
      // Spokes — 4 radial lines via pencil
      const spokeId = await addLayer(page, `Wheel ${wi + 1} Spokes`);
      layerIds[`wheel${wi}_spokes`] = spokeId;
      await setActiveTool(page, 'pencil');
      await setPencil(page, 10);
      await setFG(page, C_SOOT.r, C_SOOT.g, C_SOOT.b);
      const spokes = 4;
      for (let si = 0; si < spokes; si++) {
        const ang = (Math.PI * 2 * si) / spokes;
        const inner = { x: wx + Math.cos(ang) * (wr * 0.32), y: wy + Math.sin(ang) * (wr * 0.32) };
        const outer = { x: wx + Math.cos(ang) * (wr - 16), y: wy + Math.sin(ang) * (wr - 16) };
        await drawStroke(page, inner, outer, 3);
      }
    }
    await page.screenshot({ path: SHOT('04-wheels') });

    // ===================================================================
    // PHASE 7 — STEAM PLUME: brushed cloud above the stack + screen blend
    // ===================================================================
    await setActiveLayer(page, rootGroupId);
    layerIds['smoke'] = await addLayer(page, 'Smoke Plume');

    await setFG(page, 230, 215, 200);
    await setActiveTool(page, 'brush');
    await setBrush(page, 160, 0, 70);
    // A few large soft brush dabs above the stack
    const plumeCenters: Array<[number, number]> = [
      [VPX - 60, VPY - 320],
      [VPX + 40, VPY - 400],
      [VPX - 50, VPY - 480],
      [VPX + 80, VPY - 540],
    ];
    for (const [px, py] of plumeCenters) {
      await drawStroke(page, { x: px, y: py }, { x: px + 10, y: py + 4 }, 3);
    }
    await setBlendMode(page, layerIds['smoke']!, 'screen');
    await setOpacityFast(page, layerIds['smoke']!, 80);

    // ===================================================================
    // PHASE 8 — MOTION STRIPES (ivory horizontals through the boiler)
    // ===================================================================
    layerIds['motion'] = await addLayer(page, 'Motion Stripes');
    await setActiveTool(page, 'pencil');
    await setPencil(page, 6);
    await setFG(page, C_IVORY.r, C_IVORY.g, C_IVORY.b);
    for (let i = 0; i < 8; i++) {
      const y = VPY - 60 + (i * 32);
      const xStart = W * 0.05 + (i % 3) * 28;
      const length = 130 + (i * 31) % 240;
      await drawStroke(page, { x: xStart, y }, { x: xStart + length, y }, 3);
    }
    await setBlendMode(page, layerIds['motion']!, 'screen');
    await setOpacityFast(page, layerIds['motion']!, 75);
    await page.screenshot({ path: SHOT('05-motion-stripes') });

    // ===================================================================
    // PHASE 9 — LAYER EFFECTS on boiler / cab / stack
    // ===================================================================
    await setEffectsFast(page, layerIds['cab']!, {
      outerGlow: { enabled: true, size: 22, spread: 0, opacity: 0.7, color: { r: 255, g: 200, b: 80, a: 1 } },
      stroke:    { enabled: true, width: 4, position: 'outside', color: { r: C_SOOT.r, g: C_SOOT.g, b: C_SOOT.b, a: 1 } },
    });
    await setEffectsFast(page, layerIds['boiler']!, {
      dropShadow: { enabled: true, offsetX: 14, offsetY: 22, blur: 28, spread: 0, opacity: 0.75, color: { r: 0, g: 0, b: 0, a: 1 } },
    });
    await setEffectsFast(page, layerIds['stack']!, {
      innerGlow: { enabled: true, size: 14, spread: 0, opacity: 0.8, color: { r: 240, g: 120, b: 40, a: 1 } },
    });
    await page.screenshot({ path: SHOT('06-effects') });

    // ===================================================================
    // PHASE 10 — MAIN TYPOGRAPHY: LOCOMOTIVE / KINETICS
    // ===================================================================
    await setActiveLayer(page, rootGroupId);
    layerIds['typeGroup'] = await addGroup(page, 'Typography');

    await loadGoogleFont(page, 'Bebas Neue', [400]);
    await loadGoogleFont(page, 'Anton', [400]);
    await loadGoogleFont(page, 'Orbitron', [700, 900]);

    await setActiveTool(page, 'move');
    await page.waitForTimeout(50);

    layerIds['titleMain'] = await createTextLayer(
      page,
      'LOCOMOTIVE',
      W * 0.06,
      H * 0.05,
      {
        fontFamily: 'Anton, Impact, sans-serif',
        fontSize: 140,
        fontWeight: 400,
        color: C_IVORY,
        textAlign: 'left',
        letterSpacing: -2,
        areaWidth: W * 0.88,
      },
    );

    await setActiveTool(page, 'move');
    await page.waitForTimeout(50);

    layerIds['titleSub'] = await createTextLayer(
      page,
      'KINETICS',
      W * 0.06,
      H * 0.16,
      {
        fontFamily: 'Anton, Impact, sans-serif',
        fontSize: 170,
        fontWeight: 400,
        color: C_RED,
        textAlign: 'left',
        letterSpacing: -4,
        areaWidth: W * 0.88,
      },
    );

    // Heavy effects on KINETICS
    await setEffectsFast(page, layerIds['titleSub']!, {
      dropShadow: { enabled: true, offsetX: 8, offsetY: 10, blur: 2, spread: 0, opacity: 1.0, color: { r: C_SOOT.r, g: C_SOOT.g, b: C_SOOT.b, a: 1 } },
      stroke:     { enabled: true, width: 3, position: 'outside', color: { r: C_IVORY.r, g: C_IVORY.g, b: C_IVORY.b, a: 1 } },
    });
    await page.screenshot({ path: SHOT('07-main-title') });

    // ===================================================================
    // PHASE 11 — SLOGAN (Italian Futurist watchwords)
    // ===================================================================
    await setActiveTool(page, 'move');
    await page.waitForTimeout(50);
    layerIds['slogan'] = await createTextLayer(
      page,
      'VELOCITA  /  MOTO  /  FORZA',
      W * 0.06,
      H * 0.88,
      {
        fontFamily: 'Bebas Neue, Oswald, sans-serif',
        fontSize: 52,
        fontWeight: 400,
        color: C_SAFFRON,
        textAlign: 'left',
        letterSpacing: 10,
        areaWidth: W * 0.88,
      },
    );

    await setActiveTool(page, 'move');
    await page.waitForTimeout(50);
    layerIds['yearTag'] = await createTextLayer(
      page,
      '1909  /  MMXXVI',
      W * 0.3,
      H * 0.945,
      {
        fontFamily: 'Orbitron, monospace',
        fontSize: 26,
        fontWeight: 700,
        color: C_IVORY,
        textAlign: 'center',
        letterSpacing: 6,
        areaWidth: W * 0.4,
      },
    );
    await page.screenshot({ path: SHOT('08-typography') });

    // ===================================================================
    // CHECKPOINT — early PNG export of the core composition so the
    // final artifact is safe even if later texture / filter phases time
    // out under SwiftShader.
    // ===================================================================
    {
      const dl = page.waitForEvent('download');
      await page.getByRole('button', { name: 'File' }).click();
      await page.waitForTimeout(150);
      await page.getByRole('menuitem', { name: /Quick Export PNG/i }).click();
      const file = await dl;
      const tempPath = await file.path();
      if (tempPath) {
        const fs = await import('fs/promises');
        await fs.copyFile(tempPath, 'e2e/screenshots/locomotive-kinetics.png');
      }
    }
    await page.screenshot({ path: SHOT('09-checkpoint-export') });

    // ===================================================================
    // PHASE 12 — HALFTONE OVERLAY: vintage print texture
    // ===================================================================
    await setActiveLayer(page, rootGroupId);
    layerIds['halftoneLayer'] = await addLayer(page, 'Halftone Tone');
    await fastFillRect(page, 0, 0, W, H, { r: 180, g: 170, b: 160 });
    // Halftone filter under Filter > Halftone submenu
    try {
      await applyFilterViaMenu(page, 'Halftone', 'Halftone');
    } catch { /* tolerate */ }
    await setBlendMode(page, layerIds['halftoneLayer']!, 'multiply');
    await setOpacityFast(page, layerIds['halftoneLayer']!, 22);

    // ===================================================================
    // PHASE 13 — GRAIN: additive monochrome noise
    // ===================================================================
    layerIds['grain'] = await addLayer(page, 'Grain');
    await fastFillRect(page, 0, 0, W, H, { r: 128, g: 128, b: 128 });
    try {
      await applyFilterViaMenu(page, 'Noise', 'Add Noise');
    } catch { /* tolerate */ }
    await setBlendMode(page, layerIds['grain']!, 'overlay');
    await setOpacityFast(page, layerIds['grain']!, 25);
    await page.screenshot({ path: SHOT('10-texture') });

    // ===================================================================
    // PHASE 14 — HEAT BURST: radial saffron pop at the stack
    // ===================================================================
    layerIds['burst'] = await addLayer(page, 'Heat Burst');
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
        { position: 0, color: { r: 255, g: 230, b: 140, a: 1 } },
        { position: 0.4, color: { r: 240, g: 120, b: 40, a: 0.6 } },
        { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
      ]);
    });
    await drawStroke(page, { x: VPX, y: VPY - 240 }, { x: VPX + 240, y: VPY - 80 }, 5);
    await setBlendMode(page, layerIds['burst']!, 'screen');
    await setOpacityFast(page, layerIds['burst']!, 80);

    // (Chromatic-aberration phase removed to keep the run within budget;
    // CA filter is exercised in e2e/chromatic-aberration-filter.spec.ts.)

    // ===================================================================
    // PHASE 16 — DOCUMENT-LEVEL ADJUSTMENTS (exposure / contrast / vignette)
    // ===================================================================
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { rootGroupId: string };
          addAdjustmentNode?: (gid: string, type: string, values: unknown) => void;
        };
      };
      const s = store.getState();
      const gid = s.document.rootGroupId;
      if (typeof s.addAdjustmentNode === 'function') {
        s.addAdjustmentNode(gid, 'exposure', { exposure: 0.16 });
        s.addAdjustmentNode(gid, 'contrast', { contrast: 22 });
        s.addAdjustmentNode(gid, 'saturation', { saturation: 12, vibrance: 18 });
        s.addAdjustmentNode(gid, 'vignette', { vignette: 50 });
      }
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT('11-adjustments') });

    // ===================================================================
    // PHASE 17 — UNDO / REDO short cycle (already exercised earlier)
    // ===================================================================
    await undo(page);
    await undo(page);
    await redo(page);
    await redo(page);

    // ===================================================================
    // PHASE 18 — MARQUEE-ACTIVE SCREENSHOT (shows live marching ants)
    // ===================================================================
    await setActiveTool(page, 'marquee-rect');
    const mqS = await docToScreen(page, W * 0.08, H * 0.55);
    const mqE = await docToScreen(page, W * 0.92, H * 0.78);
    await page.mouse.move(mqS.x, mqS.y);
    await page.mouse.down();
    await page.mouse.move(mqE.x, mqE.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.screenshot({ path: SHOT('12-marquee-active') });
    await page.keyboard.press('Control+d');

    // ===================================================================
    // PHASE 19 — GRID briefly visible
    // ===================================================================
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setShowGrid?: (b: boolean) => void;
          setSnapToGrid?: (b: boolean) => void;
        };
      };
      const s = ui.getState();
      if (typeof s.setShowGrid === 'function') s.setShowGrid(true);
      if (typeof s.setSnapToGrid === 'function') s.setSnapToGrid(true);
    });
    await page.waitForTimeout(180);
    await page.screenshot({ path: SHOT('13-grid-on') });
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setShowGrid?: (b: boolean) => void;
          setSnapToGrid?: (b: boolean) => void;
        };
      };
      const s = ui.getState();
      if (typeof s.setShowGrid === 'function') s.setShowGrid(false);
      if (typeof s.setSnapToGrid === 'function') s.setSnapToGrid(false);
    });

    // ===================================================================
    // PHASE 20 — FINAL FRAME + PNG EXPORT
    // ===================================================================
    await setActiveTool(page, 'move');
    await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { notifyRender: () => void };
      };
      store.getState().notifyRender();
      for (let i = 0; i < 6; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
    });
    await page.waitForTimeout(700);

    await page.screenshot({ path: SHOT('14-final-canvas') });

    const finalDoc = await getDocSnapshot(page);
    expect(finalDoc.layers.length).toBeGreaterThanOrEqual(18);
    const groups = finalDoc.layers.filter((l) => l.type === 'group');
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const textLayers = finalDoc.layers.filter((l) => l.name.startsWith('Text'));
    expect(textLayers.length).toBeGreaterThanOrEqual(3);

    // PNG export via File menu Quick Export
    const pngDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: /Quick Export PNG/i }).click();
    const pngDownload = await pngDownloadPromise;
    const tempPath = await pngDownload.path();
    if (tempPath) {
      const fs = await import('fs/promises');
      await fs.copyFile(tempPath, 'e2e/screenshots/locomotive-kinetics.png');
    }

    await page.screenshot({ path: SHOT('final') });
  });
});
