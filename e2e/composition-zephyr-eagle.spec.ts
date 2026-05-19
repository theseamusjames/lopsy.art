/**
 * Composition Test: Zephyr & Eagle Heritage Outdoor Co. Logo
 *
 * Style: Etching / vintage engraving aesthetic
 * Project: Logo (circular badge)
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  selectTool,
  setToolOption,
  addLayer,
  setActiveLayer,
  configureEffect,
  setEffectColor,
  setBlendMode,
  setLayerOpacity,
  closeEffectsPanel,
  undo,
  redo,
  setForegroundColor,
} from './helpers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
const PREFIX = 'zephyr-eagle';

// Etching palette: parchment + dark ink brown + accent crimson + gold
const PARCHMENT = { r: 234, g: 219, b: 188 };
const INK = { r: 36, g: 24, b: 16 };
const CRIMSON = { r: 145, g: 38, b: 32 };
const GOLD = { r: 188, g: 144, b: 76 };

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${PREFIX}-${name}.png`) });
}

async function pushHistory(page: Page, label = 'Action') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
}

async function commitPendingStroke(page: Page) {
  await pushHistory(page, 'Commit stroke');
  await page.waitForTimeout(100);
}

async function brushStroke(page: Page, pts: { x: number; y: number }[]) {
  if (pts.length < 1) return;
  const first = await docToScreen(page, pts[0]!.x, pts[0]!.y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const p = await docToScreen(page, pts[i]!.x, pts[i]!.y);
    await page.mouse.move(p.x, p.y, { steps: 8 });
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function renameLayer(page: Page, name: string) {
  await page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        renameLayer: (id: string, n: string) => void;
      };
    };
    const s = store.getState();
    s.renameLayer(s.document.activeLayerId, n);
  }, name);
}

/** Configure the shape tool fill and stroke via tool settings store. */
async function setShapeStyle(page: Page, opts: {
  fill: { r: number; g: number; b: number } | null;
  stroke?: { r: number; g: number; b: number } | null;
  strokeWidth?: number;
  mode?: 'polygon' | 'ellipse';
  sides?: number;
  output?: 'pixels' | 'path';
}) {
  await page.evaluate((o) => {
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setShapeFillColor: (c: { r: number; g: number; b: number; a: number } | null) => void;
        setShapeStrokeColor: (c: { r: number; g: number; b: number; a: number } | null) => void;
        setShapeStrokeWidth: (w: number) => void;
        setShapeMode: (m: string) => void;
        setShapePolygonSides: (n: number) => void;
        setShapeOutput: (out: string) => void;
        setShapeCornerRadius: (r: number) => void;
        setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
      };
    };
    const s = ts.getState();
    if (o.fill !== undefined) {
      if (o.fill) {
        const c = { r: o.fill.r, g: o.fill.g, b: o.fill.b, a: 1 };
        s.setShapeFillColor(c);
        // Also set foreground in case any code path uses it
        s.setForegroundColor(c);
      } else {
        s.setShapeFillColor(null);
      }
    }
    if (o.stroke !== undefined) {
      if (o.stroke) {
        s.setShapeStrokeColor({ r: o.stroke.r, g: o.stroke.g, b: o.stroke.b, a: 1 });
      } else {
        s.setShapeStrokeColor(null);
      }
    }
    if (o.strokeWidth !== undefined) s.setShapeStrokeWidth(o.strokeWidth);
    if (o.mode) s.setShapeMode(o.mode);
    if (o.sides) s.setShapePolygonSides(o.sides);
    if (o.output) s.setShapeOutput(o.output);
  }, opts);
}

// Shape tool draws CENTERED at the start of the drag, with size = drag*2.
// IMPORTANT: shape tool's onActivate resets shapeFillColor to foreground,
// so style must be applied AFTER selectTool.
type ShapeStyle = {
  fill: { r: number; g: number; b: number } | null;
  stroke?: { r: number; g: number; b: number } | null;
  strokeWidth?: number;
  mode?: 'polygon' | 'ellipse';
  sides?: number;
  output?: 'pixels' | 'path';
};

async function drawShapeRect(page: Page, x: number, y: number, w: number, h: number, style: ShapeStyle) {
  await selectTool(page, 'shape');
  await setShapeStyle(page, style);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const a = await docToScreen(page, cx, cy);
  const b = await docToScreen(page, cx + w / 2, cy + h / 2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function drawShapeEllipse(page: Page, cx: number, cy: number, rx: number, ry: number, style: ShapeStyle) {
  await selectTool(page, 'shape');
  await setShapeStyle(page, style);
  const a = await docToScreen(page, cx, cy);
  const b = await docToScreen(page, cx + rx, cy + ry);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe('Composition: Zephyr & Eagle Heritage Logo', () => {
  test('creates an etching-style heritage outdoor brand badge logo', async ({ page, isMobile, allowConsoleErrors }) => {
    test.skip(isMobile, 'composition tests require sidebar');
    // Allow benign console errors BEFORE navigating (Google Fonts cert errors,
    // WebSocket noise from HMR in test env)
    (allowConsoleErrors as RegExp[]).push(/ERR_CERT_AUTHORITY_INVALID/);
    (allowConsoleErrors as RegExp[]).push(/Failed to load resource/);
    (allowConsoleErrors as RegExp[]).push(/WebSocket/);
    (allowConsoleErrors as RegExp[]).push(/fonts\.gstatic/);
    (allowConsoleErrors as RegExp[]).push(/fonts\.googleapis/);
    await page.goto('/');
    await waitForStore(page);
    test.setTimeout(1_200_000);

    // =====================================================================
    // PHASE 1: Document + parchment fill
    // =====================================================================
    await createDocument(page, 900, 900, false);
    await shot(page, '01-blank');

    await selectTool(page, 'fill');
    await setForegroundColor(page, PARCHMENT.r, PARCHMENT.g, PARCHMENT.b);
    const cMid = await docToScreen(page, 450, 450);
    await page.mouse.click(cMid.x, cMid.y);
    await page.waitForTimeout(200);
    await pushHistory(page, 'Parchment Fill');
    await renameLayer(page, 'Parchment');
    await shot(page, '02-parchment');

    // =====================================================================
    // PHASE 2: Paper texture via spray tool for aged feel
    // =====================================================================
    const grainLayer = await addLayer(page);
    await renameLayer(page, 'Paper Grain');
    await selectTool(page, 'spray');
    await setForegroundColor(page, 178, 158, 124); // darker parchment
    await setToolOption(page, 'Size', 80);
    await setToolOption(page, 'Density', 30);
    await setToolOption(page, 'Opacity', 35);
    // Sweep the spray across the canvas in 4 strokes
    await brushStroke(page, [{ x: 100, y: 100 }, { x: 800, y: 100 }]);
    await brushStroke(page, [{ x: 100, y: 350 }, { x: 800, y: 350 }]);
    await brushStroke(page, [{ x: 100, y: 600 }, { x: 800, y: 600 }]);
    await brushStroke(page, [{ x: 100, y: 800 }, { x: 800, y: 800 }]);
    await commitPendingStroke(page);
    await setLayerOpacity(page, grainLayer, 50);
    await shot(page, '03-grain');

    // =====================================================================
    // PHASE 3: Outer dark badge — large filled ellipse (will get inner cut)
    // =====================================================================
    const outerCircleLayer = await addLayer(page);
    await renameLayer(page, 'Outer Badge');
    await drawShapeEllipse(page, 450, 450, 420, 420, {
      fill: INK,
      stroke: null,
      mode: 'ellipse',
      output: 'pixels',
    });
    await shot(page, '04-outer-badge');

    // Inner parchment-colored ellipse to create a ring
    const innerCircleLayer = await addLayer(page);
    await renameLayer(page, 'Inner Field');
    await drawShapeEllipse(page, 450, 450, 400, 400, {
      fill: PARCHMENT, stroke: null, mode: 'ellipse',
    });
    await shot(page, '05-inner-field');

    // Thin gold middle ring (just decorative stroked ellipse)
    const goldRingLayer = await addLayer(page);
    await renameLayer(page, 'Gold Ring');
    await drawShapeEllipse(page, 450, 450, 388, 388, {
      fill: null, stroke: GOLD, strokeWidth: 3, mode: 'ellipse',
    });
    await shot(page, '06-gold-ring');

    // Innermost dark ring (just a stroke)
    const innerRingLayer = await addLayer(page);
    await renameLayer(page, 'Inner Ring');
    await drawShapeEllipse(page, 450, 450, 360, 360, {
      fill: null, stroke: INK, strokeWidth: 6, mode: 'ellipse',
    });
    await shot(page, '07-inner-ring');

    // =====================================================================
    // PHASE 4: Sun rays (radiating gold lines) — BEHIND mountains
    // =====================================================================
    const raysLayer = await addLayer(page);
    await renameLayer(page, 'Sun Rays');
    await selectTool(page, 'pencil');
    await setForegroundColor(page, GOLD.r, GOLD.g, GOLD.b);
    await setToolOption(page, 'Size', 2);
    const rayCenter = { x: 450, y: 560 };
    for (let i = 1; i < 9; i++) {
      const angle = Math.PI + (i / 9) * Math.PI;
      const dx = Math.cos(angle) * 260;
      const dy = Math.sin(angle) * 260;
      await brushStroke(page, [
        rayCenter,
        { x: rayCenter.x + dx, y: rayCenter.y + dy },
      ]);
    }
    await commitPendingStroke(page);
    await setLayerOpacity(page, raysLayer, 55);
    await shot(page, '08-rays');

    // =====================================================================
    // PHASE 5: Mountain range silhouette (overlapping triangles)
    // =====================================================================
    const mountainLayer = await addLayer(page);
    await renameLayer(page, 'Mountains');
    const mtnStyle: ShapeStyle = { fill: INK, stroke: null, mode: 'polygon', sides: 3 };
    // Left peak (taller)
    await drawShapeRect(page, 240, 410, 230, 200, mtnStyle);
    // Middle peak (shorter, slightly forward)
    await drawShapeRect(page, 380, 470, 180, 150, mtnStyle);
    // Right peak (similar to left)
    await drawShapeRect(page, 480, 420, 230, 200, mtnStyle);
    await shot(page, '09-mountains');

    // Snow caps — smaller parchment triangles
    const snowLayer = await addLayer(page);
    await renameLayer(page, 'Snow Caps');
    const snowStyle: ShapeStyle = { fill: PARCHMENT, stroke: null, mode: 'polygon', sides: 3 };
    await drawShapeRect(page, 305, 410, 100, 60, snowStyle);  // left snow
    await drawShapeRect(page, 545, 420, 100, 60, snowStyle);  // right snow
    await shot(page, '10-snow');

    // =====================================================================
    // PHASE 6: Eagle silhouette — circles + brush detail
    // =====================================================================
    const eagleLayer = await addLayer(page);
    await renameLayer(page, 'Eagle');
    const eagleStyle: ShapeStyle = { fill: INK, stroke: null, mode: 'ellipse' };
    // Body
    await drawShapeEllipse(page, 450, 410, 26, 50, eagleStyle);
    // Head
    await drawShapeEllipse(page, 450, 345, 22, 24, eagleStyle);
    // Left wing
    await drawShapeEllipse(page, 365, 380, 80, 22, eagleStyle);
    // Right wing
    await drawShapeEllipse(page, 535, 380, 80, 22, eagleStyle);
    // Tail feathers (small ellipse at bottom)
    await drawShapeEllipse(page, 450, 470, 16, 26, eagleStyle);
    await shot(page, '11-eagle');

    // Beak (gold triangle)
    await drawShapeRect(page, 444, 345, 18, 18, {
      fill: GOLD, stroke: null, mode: 'polygon', sides: 3,
    });
    await shot(page, '12-beak');

    // Eagle eye — tiny parchment ellipse
    await drawShapeEllipse(page, 458, 343, 3, 3, {
      fill: PARCHMENT, stroke: null, mode: 'ellipse',
    });

    // Wing detail pencil lines for feather texture
    await selectTool(page, 'pencil');
    await setForegroundColor(page, PARCHMENT.r, PARCHMENT.g, PARCHMENT.b);
    await setToolOption(page, 'Size', 1);
    for (let i = 0; i < 4; i++) {
      const y0 = 374 + i * 4;
      await brushStroke(page, [
        { x: 295, y: y0 },
        { x: 430, y: y0 + 4 },
      ]);
      await brushStroke(page, [
        { x: 470, y: y0 + 4 },
        { x: 605, y: y0 },
      ]);
    }
    await commitPendingStroke(page);
    await shot(page, '13-eagle-feathers');

    // =====================================================================
    // PHASE 7: Crosshatching texture under mountains (multiply blend)
    // =====================================================================
    const hatchLayer = await addLayer(page);
    await renameLayer(page, 'Crosshatch');
    await selectTool(page, 'brush');
    await setForegroundColor(page, INK.r, INK.g, INK.b);
    await setToolOption(page, 'Size', 3);
    await setToolOption(page, 'Opacity', 35);
    await setToolOption(page, 'Hardness', 95);

    // Diagonal hatch
    for (let i = 0; i < 8; i++) {
      const y0 = 600 + i * 10;
      await brushStroke(page, [
        { x: 130, y: y0 },
        { x: 770, y: y0 + 36 },
      ]);
    }
    // Cross diagonal
    for (let i = 0; i < 7; i++) {
      const y0 = 600 + i * 12;
      await brushStroke(page, [
        { x: 770, y: y0 },
        { x: 150, y: y0 + 40 },
      ]);
    }
    await commitPendingStroke(page);
    await setBlendMode(page, 'multiply');
    await closeEffectsPanel(page);
    await shot(page, '14-crosshatch');

    // =====================================================================
    // PHASE 8: Crimson banner across the bottom
    // =====================================================================
    const bannerLayer = await addLayer(page);
    await renameLayer(page, 'Banner');
    await drawShapeRect(page, 230, 640, 440, 70, {
      fill: CRIMSON,
      stroke: null,
      mode: 'polygon',
      sides: 4,
    });
    await shot(page, '15-banner');

    // =====================================================================
    // PHASE 9: Text — banner "EST. 1893" + top arc + bottom
    // =====================================================================
    // Banner text (centered, white)
    await selectTool(page, 'move');
    const banTextLayer = await addLayer(page);
    await renameLayer(page, 'Banner Text');
    await selectTool(page, 'text');
    // Set font size
    const fontSizeIn = page.locator('input[aria-label="Font size value"], input[aria-label="Font Size value"]').first();
    if (await fontSizeIn.isVisible({ timeout: 500 }).catch(() => false)) {
      await fontSizeIn.fill('44');
      await fontSizeIn.press('Enter');
    }
    // Font family
    const fontSel = page.locator('[aria-labelledby="font-family-label"]').first();
    if (await fontSel.isVisible({ timeout: 500 }).catch(() => false)) {
      await fontSel.selectOption({ label: 'Garamond' }).catch(async () => {
        await fontSel.selectOption({ label: 'Times New Roman' }).catch(() => {});
      });
    }
    await setForegroundColor(page, PARCHMENT.r, PARCHMENT.g, PARCHMENT.b);
    const banPos = await docToScreen(page, 300, 660);
    await page.mouse.click(banPos.x, banPos.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('EST. 1893');
    await page.waitForTimeout(200);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    await shot(page, '16-banner-text');

    // Top text — "ZEPHYR & EAGLE CO."
    await selectTool(page, 'move');
    const topTextLayer = await addLayer(page);
    await renameLayer(page, 'Top Text');
    await selectTool(page, 'text');
    if (await fontSizeIn.isVisible({ timeout: 500 }).catch(() => false)) {
      await fontSizeIn.fill('46');
      await fontSizeIn.press('Enter');
    }
    await setForegroundColor(page, INK.r, INK.g, INK.b);
    const topPos = await docToScreen(page, 190, 215);
    await page.mouse.click(topPos.x, topPos.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('ZEPHYR · EAGLE · CO.');
    await page.waitForTimeout(200);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    await shot(page, '17-top-text');

    // Bottom text — "WILDERNESS OUTFITTERS"
    await selectTool(page, 'move');
    const botTextLayer = await addLayer(page);
    await renameLayer(page, 'Bottom Text');
    await selectTool(page, 'text');
    if (await fontSizeIn.isVisible({ timeout: 500 }).catch(() => false)) {
      await fontSizeIn.fill('26');
      await fontSizeIn.press('Enter');
    }
    await setForegroundColor(page, INK.r, INK.g, INK.b);
    const botPos = await docToScreen(page, 250, 745);
    await page.mouse.click(botPos.x, botPos.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('WILDERNESS OUTFITTERS');
    await page.waitForTimeout(200);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    await shot(page, '18-bottom-text');

    // =====================================================================
    // PHASE 10: Decorative stars on sides
    // =====================================================================
    await selectTool(page, 'move');
    const starLayer = await addLayer(page);
    await renameLayer(page, 'Stars');
    const starStyle: ShapeStyle = { fill: GOLD, stroke: null, mode: 'polygon', sides: 5 };
    await drawShapeRect(page, 145, 730, 30, 30, starStyle);
    await drawShapeRect(page, 720, 730, 30, 30, starStyle);
    // Decorative dots between top text
    const dotStyle: ShapeStyle = { fill: INK, stroke: null, mode: 'ellipse' };
    await drawShapeEllipse(page, 130, 200, 5, 5, dotStyle);
    await drawShapeEllipse(page, 770, 200, 5, 5, dotStyle);
    await shot(page, '19-stars');

    // =====================================================================
    // PHASE 11: Undo/Redo verification
    // =====================================================================
    await undo(page);
    await page.waitForTimeout(150);
    await undo(page);
    await page.waitForTimeout(150);
    await shot(page, '20-undo');
    await redo(page);
    await page.waitForTimeout(150);
    await redo(page);
    await page.waitForTimeout(150);
    await shot(page, '21-redo');

    // =====================================================================
    // PHASE 12: Layer effects — Stroke on banner, Drop Shadow on outer ring
    // =====================================================================
    await setActiveLayer(page, bannerLayer);
    await configureEffect(page, 'Stroke', {
      'Width': 4,
    });
    await setEffectColor(page, 'Stroke color', PARCHMENT.r, PARCHMENT.g, PARCHMENT.b).catch(() => {});
    await closeEffectsPanel(page);
    await shot(page, '22-banner-stroke');

    await setActiveLayer(page, outerCircleLayer);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 0,
      'Offset Y': 6,
      'Blur': 18,
    });
    await setEffectColor(page, 'Shadow color', 0, 0, 0).catch(() => {});
    await closeEffectsPanel(page);
    await shot(page, '23-outer-shadow');

    // Outer Glow on the eagle for emphasis
    await setActiveLayer(page, eagleLayer);
    await configureEffect(page, 'Outer Glow', {
      'Size': 10,
      'Spread': 20,
    });
    await setEffectColor(page, 'Glow color', GOLD.r, GOLD.g, GOLD.b).catch(() => {});
    await closeEffectsPanel(page);
    await shot(page, '24-eagle-glow');

    // =====================================================================
    // PHASE 13: Add stipple highlight on mountains using brush
    // =====================================================================
    await setActiveLayer(page, mountainLayer);
    const mountainStippleLayer = await addLayer(page);
    await renameLayer(page, 'Mountain Stipple');
    await selectTool(page, 'brush');
    await setForegroundColor(page, PARCHMENT.r, PARCHMENT.g, PARCHMENT.b);
    await setToolOption(page, 'Size', 2);
    await setToolOption(page, 'Opacity', 60);
    // Stipple using spray for speed
    await selectTool(page, 'spray');
    await setToolOption(page, 'Size', 60);
    await setToolOption(page, 'Density', 15);
    await setToolOption(page, 'Opacity', 40);
    await brushStroke(page, [{ x: 300, y: 510 }, { x: 410, y: 580 }]);
    await brushStroke(page, [{ x: 510, y: 510 }, { x: 620, y: 580 }]);
    await commitPendingStroke(page);
    await shot(page, '25-stipple');

    // =====================================================================
    // PHASE 14: Marquee transformation — show active marquee on banner
    // =====================================================================
    await setActiveLayer(page, bannerLayer);
    await selectTool(page, 'marquee-rect');
    const ma = await docToScreen(page, 230, 640);
    const mb = await docToScreen(page, 670, 710);
    await page.mouse.move(ma.x, ma.y);
    await page.mouse.down();
    await page.mouse.move(mb.x, mb.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    await shot(page, '26-marquee-active');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    // =====================================================================
    // PHASE 15: Export final composition (BEFORE grouping)
    // =====================================================================
    await pushHistory(page, 'Final');
    await page.waitForTimeout(300);

    const pngB64 = await page.evaluate(async () => {
      const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await read();
      const w = result.width;
      const h = result.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const srcRow = (h - 1 - y) * w * 4;
        const dstRow = y * w * 4;
        for (let i = 0; i < w * 4; i++) {
          img.data[dstRow + i] = result.pixels[srcRow + i]!;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    });

    const pngBuffer = Buffer.from(pngB64.replace(/^data:image\/png;base64,/, ''), 'base64');
    const fs = await import('fs');
    fs.writeFileSync(path.join(SCREENSHOT_DIR, `${PREFIX}-FINAL.png`), pngBuffer);

    await shot(page, '27-final-screen');

    // =====================================================================
    // PHASE 16: Group all logo elements (after export — tests the feature)
    // =====================================================================
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: { id: string; name: string; type: string }[] };
          setLayerSelection: (ids: string[]) => void;
          groupSelectedLayers: () => void;
          pushHistory: (l?: string) => void;
        };
      };
      const s = store.getState();
      const ids = s.document.layers
        .filter((l) => l.name !== 'Parchment' && l.type !== 'group')
        .map((l) => l.id);
      s.setLayerSelection(ids);
      s.pushHistory('Group');
      s.groupSelectedLayers();
    });
    await page.waitForTimeout(200);
    await shot(page, '28-grouped');

    // Sanity
    const sample = await page.evaluate(async () => {
      const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const r = await read();
      return { w: r.width, h: r.height, len: r.pixels.length };
    });
    expect(sample.w).toBeGreaterThan(100);
    expect(sample.len).toBeGreaterThan(1000);
  });
});
