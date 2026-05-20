/**
 * Composition: "Sacred Decadence" — Rococo Zine Cover
 *
 * Theme: pastel pinks, cream, gilded gold, asymmetric ornate frames,
 * a cherub silhouette, frilly scrollwork — rococo iconography
 * subverted into a punk zine cover with grain and a hard
 * typographic title.
 *
 * Document: 800 x 1100 portrait.
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
  setForegroundColor,
  setBlendMode,
  setLayerOpacity,
  configureEffect,
  setEffectColor,
  closeEffectsPanel,
  undo,
  redo,
  getRootGroupId,
  addAdjustment,
} from './helpers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
const PREFIX = 'sacred-decadence';
const shot = (name: string) => path.join(SCREENSHOT_DIR, `${PREFIX}-${name}.png`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pushHistory(page: Page, label = 'Step') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
}

async function brushStroke(
  page: Page,
  points: Array<{ x: number; y: number }>,
  steps = 6,
) {
  if (points.length < 2) return;
  const start = await docToScreen(page, points[0]!.x, points[0]!.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    const p = await docToScreen(page, points[i]!.x, points[i]!.y);
    await page.mouse.move(p.x, p.y, { steps });
  }
  await page.mouse.up();
  await page.waitForTimeout(40);
}


/**
 * Add a raster layer with text rendered into it via Canvas2D.  Sidesteps
 * the text-layer GPU rendering pipeline (which requires UI editing flow
 * to populate the GPU texture) so the text actually appears in the
 * composite.
 */
async function addRasterizedText(
  page: Page,
  text: string,
  docX: number,
  docY: number,
  options: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    color?: { r: number; g: number; b: number };
    letterSpacing?: number;
  } = {},
): Promise<string> {
  // Add a layer through the UI first so we exercise the Add Layer button.
  const id = await addLayer(page);
  await renameActiveLayer(page, text.slice(0, 18) || 'Text');

  await page.evaluate(
    ({ text, docX, docY, options, id }) => {
      const editor = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const s = editor.getState();
      const docW = s.document.width;
      const docH = s.document.height;
      const cnv = document.createElement('canvas');
      cnv.width = docW;
      cnv.height = docH;
      const ctx = cnv.getContext('2d')!;
      const style = options.fontStyle ?? 'normal';
      const weight = options.fontWeight ?? 400;
      const size = options.fontSize ?? 80;
      const family = options.fontFamily ?? 'Garamond';
      ctx.font = `${style} ${weight} ${size}px ${family}`;
      const c = options.color ?? { r: 0, g: 0, b: 0 };
      ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      ctx.textBaseline = 'top';
      // Manual letterSpacing emulation
      const ls = options.letterSpacing ?? 0;
      let cx = docX;
      for (const ch of text) {
        ctx.fillText(ch, cx, docY);
        cx += ctx.measureText(ch).width + ls;
      }
      const img = ctx.getImageData(0, 0, docW, docH);
      s.pushHistory('Add Text');
      s.updateLayerPixelData(id, img);
    },
    { text, docX, docY, options, id },
  );
  return id;
}

interface DrawOp {
  kind: 'rect' | 'circle';
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  color: { r: number; g: number; b: number; a?: number };
}

/**
 * Paint multiple shapes onto the active layer in a single ImageData
 * update.  This works around the auto-crop pitfall (helpers.ts paintRect
 * crops between calls so subsequent calls fall outside the layer
 * bounds).
 */
async function paintBatch(page: Page, ops: DrawOp[], docW = 800, docH = 1100): Promise<void> {
  await page.evaluate(
    ({ ops, docW, docH }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => ImageData | undefined;
      };
      const s = store.getState();
      const id = s.document.activeLayerId;
      s.pushHistory('Paint');
      const existing = pixelData.get(id);
      const data = existing && existing.width === docW && existing.height === docH
        ? existing
        : new ImageData(docW, docH);
      for (const op of ops) {
        const a = op.color.a ?? 255;
        if (op.kind === 'rect') {
          const x0 = Math.max(0, op.x), y0 = Math.max(0, op.y);
          const x1 = Math.min(docW, op.x + (op.w ?? 0));
          const y1 = Math.min(docH, op.y + (op.h ?? 0));
          for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
              const idx = (py * docW + px) * 4;
              data.data[idx] = op.color.r;
              data.data[idx + 1] = op.color.g;
              data.data[idx + 2] = op.color.b;
              data.data[idx + 3] = a;
            }
          }
        } else {
          const r = op.r ?? 0;
          const cx = op.x, cy = op.y;
          const x0 = Math.max(0, Math.floor(cx - r));
          const y0 = Math.max(0, Math.floor(cy - r));
          const x1 = Math.min(docW, Math.ceil(cx + r));
          const y1 = Math.min(docH, Math.ceil(cy + r));
          const r2 = r * r;
          for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
              const dx = px - cx, dy = py - cy;
              if (dx * dx + dy * dy <= r2) {
                const idx = (py * docW + px) * 4;
                data.data[idx] = op.color.r;
                data.data[idx + 1] = op.color.g;
                data.data[idx + 2] = op.color.b;
                data.data[idx + 3] = a;
              }
            }
          }
        }
      }
      s.updateLayerPixelData(id, data);
    },
    { ops, docW, docH },
  );
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function renameActiveLayer(page: Page, name: string): Promise<void> {
  await page.evaluate((nm) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        renameLayer: (id: string, name: string) => void;
      };
    };
    const s = store.getState();
    s.renameLayer(s.document.activeLayerId, nm);
  }, name);
}

async function exportPng(page: Page, savePath: string): Promise<void> {
  const dataUrl: string = await page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const composite = await readFn();
    const cnv = document.createElement('canvas');
    cnv.width = composite.width;
    cnv.height = composite.height;
    const ctx = cnv.getContext('2d')!;
    const img = ctx.createImageData(cnv.width, cnv.height);
    const W = cnv.width;
    const H = cnv.height;
    // The buffer is bottom-up — flip y.
    for (let y = 0; y < H; y++) {
      const srcRow = (H - 1 - y) * W * 4;
      const dstRow = y * W * 4;
      for (let i = 0; i < W * 4; i++) {
        img.data[dstRow + i] = composite.pixels[srcRow + i] ?? 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cnv.toDataURL('image/png');
  });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const fs = await import('node:fs/promises');
  await fs.writeFile(savePath, Buffer.from(base64, 'base64'));
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Composition: Sacred Decadence (Rococo Zine Cover)', () => {
  test.use({ allowConsoleErrors: [/ERR_CERT_AUTHORITY_INVALID/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'composition tests require sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('paints a rococo zine cover with frames, ornaments, and typography', async ({ page }) => {
    test.setTimeout(1_800_000);

    // -------------------------------------------------------------------
    // PHASE 1: Background — cream + SOFT pink radial gradient (stacked
    // discs at decreasing alpha for a true falloff, not a hard ellipse).
    // -------------------------------------------------------------------
    await createDocument(page, 800, 1100, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await renameActiveLayer(page, 'BG cream');

    const bgOps: DrawOp[] = [
      { kind: 'rect', x: 0, y: 0, w: 800, h: 1100, color: { r: 247, g: 230, b: 210 } },
    ];
    // Approximate a radial gradient: 12 concentric circles, pink at center
    // fading to cream at the edges.
    const cxBg = 360, cyBg = 480; // off-center, anticipating asymmetry
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const radius = 480 - i * 30;
      const cream = { r: 247, g: 230, b: 210 };
      const pink = { r: 232, g: 184, b: 188 };
      bgOps.push({
        kind: 'circle',
        x: cxBg,
        y: cyBg,
        r: radius,
        color: {
          r: Math.round(cream.r * t + pink.r * (1 - t)),
          g: Math.round(cream.g * t + pink.g * (1 - t)),
          b: Math.round(cream.b * t + pink.b * (1 - t)),
        },
      });
    }
    await paintBatch(page, bgOps);
    await pushHistory(page, 'Background');
    await page.screenshot({ path: shot('01-background') });

    // -------------------------------------------------------------------
    // PHASE 2: Gilded outer frame (8 rects in one batch).
    // -------------------------------------------------------------------
    const frameId = await addLayer(page);
    await renameActiveLayer(page, 'Gilt frame');

    const gold = { r: 196, g: 154, b: 76 };
    const lightGold = { r: 240, g: 215, b: 130 };
    const darkGold = { r: 158, g: 120, b: 50 };
    const verdigris = { r: 60, g: 122, b: 116 }; // saturated accent

    await paintBatch(page, [
      // Outer thick gold border
      { kind: 'rect', x: 40, y: 50, w: 720, h: 14, color: gold },
      { kind: 'rect', x: 40, y: 1036, w: 720, h: 14, color: gold },
      { kind: 'rect', x: 40, y: 50, w: 14, h: 1000, color: gold },
      { kind: 'rect', x: 746, y: 50, w: 14, h: 1000, color: gold },
      // Highlight inner stripe
      { kind: 'rect', x: 64, y: 74, w: 672, h: 4, color: lightGold },
      { kind: 'rect', x: 64, y: 1022, w: 672, h: 4, color: lightGold },
      { kind: 'rect', x: 64, y: 74, w: 4, h: 952, color: lightGold },
      { kind: 'rect', x: 732, y: 74, w: 4, h: 952, color: lightGold },
      // Corner medallions: gold disc + verdigris inset + light gold pip
      { kind: 'circle', x: 80, y: 90, r: 18, color: gold },
      { kind: 'circle', x: 80, y: 90, r: 11, color: verdigris },
      { kind: 'circle', x: 80, y: 90, r: 4, color: lightGold },
      { kind: 'circle', x: 720, y: 90, r: 18, color: gold },
      { kind: 'circle', x: 720, y: 90, r: 11, color: verdigris },
      { kind: 'circle', x: 720, y: 90, r: 4, color: lightGold },
      { kind: 'circle', x: 80, y: 1010, r: 18, color: gold },
      { kind: 'circle', x: 80, y: 1010, r: 11, color: verdigris },
      { kind: 'circle', x: 80, y: 1010, r: 4, color: lightGold },
      { kind: 'circle', x: 720, y: 1010, r: 18, color: gold },
      { kind: 'circle', x: 720, y: 1010, r: 11, color: verdigris },
      { kind: 'circle', x: 720, y: 1010, r: 4, color: lightGold },
    ]);
    await pushHistory(page, 'Frame');
    await page.screenshot({ path: shot('02-frame') });

    // -------------------------------------------------------------------
    // PHASE 3: Cartouche — SHIFTED off-centre (down-left for asymmetry),
    // with a verdigris inner ring (the single saturated chord) and a
    // beveled bright/dark gold gradient on the outer ring.
    // -------------------------------------------------------------------
    const cartoucheId = await addLayer(page);
    await renameActiveLayer(page, 'Cartouche');

    const cx = 360; // shifted from 400
    const cy = 640; // shifted from 600

    await paintBatch(page, [
      // Bevel ring: outer dark gold (drop shadow), then bright gold
      { kind: 'circle', x: cx, y: cy, r: 234, color: darkGold },
      { kind: 'circle', x: cx, y: cy, r: 222, color: gold },
      // Highlight rim on upper-left (slight offset)
      { kind: 'circle', x: cx - 4, y: cy - 6, r: 218, color: lightGold },
      // Outer gold ring
      { kind: 'circle', x: cx, y: cy, r: 210, color: gold },
      // Verdigris middle ring (the saturated punctuation)
      { kind: 'circle', x: cx, y: cy, r: 198, color: verdigris },
      // Inner gold rim
      { kind: 'circle', x: cx, y: cy, r: 188, color: gold },
      // Interior — soft pink
      { kind: 'circle', x: cx, y: cy, r: 182, color: { r: 232, g: 184, b: 188 } },
      // Top-left highlight crescent on interior (lighter)
      { kind: 'circle', x: cx - 30, y: cy - 40, r: 110, color: { r: 244, g: 212, b: 215 } },
    ]);

    await pushHistory(page, 'Cartouche');
    await page.screenshot({ path: shot('03-cartouche') });

    // -------------------------------------------------------------------
    // PHASE 4: S&D monogram inside the cartouche — replaces the cherub
    // blob with high-contrast gilded typography.
    // -------------------------------------------------------------------
    await addRasterizedText(page, 'S&D', cx - 120 + 4, cy - 90 + 6, {
      fontFamily: 'Brush Script MT',
      fontSize: 180,
      fontWeight: 700,
      fontStyle: 'italic',
      color: { r: 30, g: 8, b: 16 }, // deep wine shadow
    });
    const monogramId = await addRasterizedText(page, 'S&D', cx - 120, cy - 90, {
      fontFamily: 'Brush Script MT',
      fontSize: 180,
      fontWeight: 700,
      fontStyle: 'italic',
      color: { r: 196, g: 154, b: 76 }, // gilt
    });
    // Bright highlight pass on top
    await addRasterizedText(page, 'S&D', cx - 120 - 2, cy - 90 - 2, {
      fontFamily: 'Brush Script MT',
      fontSize: 180,
      fontWeight: 700,
      fontStyle: 'italic',
      color: { r: 240, g: 215, b: 130 },
    });
    await pushHistory(page, 'Monogram');
    await page.screenshot({ path: shot('04-monogram') });

    // -------------------------------------------------------------------
    // PHASE 5: Dense, asymmetric scrollwork — mass clustered upper-right
    // and lower-left to counterweight the off-centre cartouche.
    // -------------------------------------------------------------------
    const scrollId = await addLayer(page);
    await renameActiveLayer(page, 'Scrollwork');

    await selectTool(page, 'brush');
    await setForegroundColor(page, gold.r, gold.g, gold.b);
    await setToolOption(page, 'Size', 8);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    const swoop = (cxS: number, cyS: number, length: number, amp: number, phase: number, steps = 14) => {
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push({
          x: cxS + (t - 0.5) * length,
          y: cyS + Math.sin(t * Math.PI * 2 + phase) * amp,
        });
      }
      return pts;
    };
    const curl = (cxS: number, cyS: number, r: number, sweep: number, decay = 0.4, steps = 18) => {
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * sweep;
        const rr = r * (1 - t * decay);
        pts.push({ x: cxS + Math.cos(a) * rr, y: cyS + Math.sin(a) * rr });
      }
      return pts;
    };

    // Banner swooshes top/bottom
    await brushStroke(page, swoop(400, 130, 380, 14, 0));
    await brushStroke(page, swoop(420, 155, 240, 8, Math.PI / 2));
    await brushStroke(page, swoop(380, 970, 380, 16, Math.PI));
    await brushStroke(page, swoop(420, 1000, 280, 9, Math.PI * 1.5));

    // Upper-right mass — counterweight to off-centre cartouche
    await brushStroke(page, curl(620, 270, 50, Math.PI * 2.8));
    await brushStroke(page, curl(580, 320, -36, Math.PI * 2));
    await brushStroke(page, curl(640, 360, 28, Math.PI * 1.6));
    await brushStroke(page, curl(560, 230, -24, Math.PI * 1.5));
    await brushStroke(page, swoop(610, 200, 160, 12, 0, 12));

    // Lower-left mass — same idea, opposite corner
    await brushStroke(page, curl(180, 900, 50, -Math.PI * 2.8));
    await brushStroke(page, curl(230, 870, -34, -Math.PI * 2));
    await brushStroke(page, curl(160, 950, 26, -Math.PI * 1.6));
    await brushStroke(page, curl(250, 820, -22, -Math.PI * 1.5));
    await brushStroke(page, swoop(200, 940, 170, 14, Math.PI, 12));

    // Cartouche outlines — overlapping curls hugging the gold ring
    await brushStroke(page, curl(cx - 250, cy, 60, Math.PI * 2.5));
    await brushStroke(page, curl(cx + 250, cy, -60, Math.PI * 2.5));

    // Hairline darker pass — vary the line weight
    await setForegroundColor(page, darkGold.r, darkGold.g, darkGold.b);
    await setToolOption(page, 'Size', 3);
    await brushStroke(page, swoop(400, 142, 360, 12, 0, 16));
    await brushStroke(page, swoop(400, 985, 360, 14, Math.PI, 16));
    await brushStroke(page, curl(620, 280, 40, Math.PI * 2.4, 0.3, 14));
    await brushStroke(page, curl(190, 905, 40, -Math.PI * 2.4, 0.3, 14));

    await pushHistory(page, 'Scrollwork');
    await page.screenshot({ path: shot('05-scrollwork') });

    // -------------------------------------------------------------------
    // PHASE 6: Undo/redo sanity
    // -------------------------------------------------------------------
    await undo(page);
    await page.waitForTimeout(80);
    await redo(page);
    await page.waitForTimeout(80);
    await page.screenshot({ path: shot('07-after-redo') });

    // -------------------------------------------------------------------
    // PHASE 7: Rose clusters — asymmetric (3 upper-left, 2 lower-right,
    // 1 by the cartouche) built as stacked circles for speed.
    // -------------------------------------------------------------------
    const rosesId = await addLayer(page);
    await renameActiveLayer(page, 'Roses');

    const roseOps = (cxR: number, cyR: number, scale = 1): DrawOp[] => {
      const s = scale;
      return [
        // Leaves (behind)
        { kind: 'circle', x: cxR - 36 * s, y: cyR + 18 * s, r: 14 * s, color: { r: 96, g: 124, b: 84 } },
        { kind: 'circle', x: cxR - 30 * s, y: cyR + 10 * s, r: 10 * s, color: { r: 110, g: 138, b: 96 } },
        { kind: 'circle', x: cxR + 38 * s, y: cyR - 10 * s, r: 14 * s, color: { r: 96, g: 124, b: 84 } },
        { kind: 'circle', x: cxR + 30 * s, y: cyR - 4 * s, r: 10 * s, color: { r: 110, g: 138, b: 96 } },
        // Outer petal disc — dusty pink
        { kind: 'circle', x: cxR, y: cyR, r: 26 * s, color: { r: 200, g: 124, b: 130 } },
        // Petal offsets — overlapping discs
        { kind: 'circle', x: cxR - 12 * s, y: cyR - 8 * s, r: 18 * s, color: { r: 218, g: 148, b: 154 } },
        { kind: 'circle', x: cxR + 12 * s, y: cyR - 10 * s, r: 18 * s, color: { r: 218, g: 148, b: 154 } },
        { kind: 'circle', x: cxR + 14 * s, y: cyR + 8 * s, r: 16 * s, color: { r: 200, g: 124, b: 130 } },
        // Mid petal
        { kind: 'circle', x: cxR, y: cyR - 2 * s, r: 13 * s, color: { r: 236, g: 168, b: 172 } },
        // Bright center highlight
        { kind: 'circle', x: cxR - 2 * s, y: cyR - 3 * s, r: 6 * s, color: { r: 248, g: 200, b: 200 } },
        // Shadow accent
        { kind: 'circle', x: cxR + 8 * s, y: cyR + 6 * s, r: 4 * s, color: { r: 120, g: 50, b: 60 } },
      ];
    };

    await paintBatch(page, [
      ...roseOps(135, 230, 1.2),
      ...roseOps(205, 290, 0.95),
      ...roseOps(110, 330, 0.75),
      ...roseOps(680, 900, 1.1),
      ...roseOps(620, 970, 0.85),
      ...roseOps(cx + 230, cy + 60, 0.7),
    ]);

    await pushHistory(page, 'Roses');
    await page.screenshot({ path: shot('08-roses') });

    // -------------------------------------------------------------------
    // PHASE 8: Ribbon banner — tilted parallelogram with visible inscription
    // -------------------------------------------------------------------
    const ribbonId = await addLayer(page);
    await renameActiveLayer(page, 'Ribbon');

    // Tilted ribbon via paintBatch row-by-row shear.
    const ribbonY = 870;
    const ribbonH = 76;
    const ribbonCenterX = 400;
    const ribbonW = 460;
    const tiltPerRow = -0.08; // rises to the right
    const ribbonOps: DrawOp[] = [];
    for (let row = 0; row < ribbonH; row++) {
      const shiftX = (row - ribbonH / 2) * 0;
      const yMid = (ribbonH / 2);
      const xOffset = (row - yMid) * tiltPerRow * 10;
      // Body
      ribbonOps.push({
        kind: 'rect',
        x: Math.round(ribbonCenterX - ribbonW / 2 + xOffset + shiftX),
        y: ribbonY + row,
        w: ribbonW,
        h: 1,
        color: gold,
      });
      // Light gold inner stripe
      if (row > ribbonH * 0.32 && row < ribbonH * 0.48) {
        ribbonOps.push({
          kind: 'rect',
          x: Math.round(ribbonCenterX - ribbonW / 2 + xOffset + shiftX),
          y: ribbonY + row,
          w: ribbonW,
          h: 1,
          color: lightGold,
        });
      }
    }
    // Tail notches
    ribbonOps.push({
      kind: 'rect', x: ribbonCenterX - ribbonW / 2 - 40, y: ribbonY + 6, w: 50, h: 56, color: darkGold,
    });
    ribbonOps.push({
      kind: 'rect', x: ribbonCenterX + ribbonW / 2 - 14, y: ribbonY - 10, w: 50, h: 56, color: darkGold,
    });
    await paintBatch(page, ribbonOps);
    await pushHistory(page, 'Ribbon');
    await page.screenshot({ path: shot('09-ribbon') });

    // -------------------------------------------------------------------
    // PHASE 9: Typography — tightened title pair with subtitle bridge
    // -------------------------------------------------------------------
    const sacredId = await addRasterizedText(page, 'SACRED', 130, 130, {
      fontFamily: 'Garamond',
      fontSize: 150,
      fontWeight: 700,
      fontStyle: 'normal',
      color: { r: 86, g: 32, b: 48 },
      letterSpacing: 3,
    });
    await page.waitForTimeout(50);

    // Tertiary bridge subtitle in italic Garamond
    await addRasterizedText(
      page, '~ a quarterly on indulgent virtues ~', 162, 310, {
        fontFamily: 'Garamond',
        fontSize: 26,
        fontWeight: 400,
        fontStyle: 'italic',
        color: { r: 86, g: 32, b: 48 },
        letterSpacing: 2,
      },
    );
    await page.waitForTimeout(50);

    const decId = await addRasterizedText(page, 'decadence.', 200, 990, {
      fontFamily: 'Brush Script MT',
      fontSize: 110,
      fontWeight: 400,
      fontStyle: 'italic',
      color: { r: 86, g: 32, b: 48 },
      letterSpacing: 2,
    });
    await page.waitForTimeout(50);

    // Issue tag — large and legible on the tilted ribbon
    const issueId = await addRasterizedText(page, 'ISSUE  IV  ·  MMXXVI', 240, 895, {
      fontFamily: 'Palatino',
      fontSize: 32,
      fontWeight: 700,
      fontStyle: 'italic',
      color: { r: 30, g: 8, b: 16 },
      letterSpacing: 6,
    });
    await page.waitForTimeout(60);

    await page.screenshot({ path: shot('10-text') });

    // -------------------------------------------------------------------
    // PHASE 10: Layer effects on the SACRED title
    // -------------------------------------------------------------------
    await setActiveLayer(page, sacredId);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 4, 'Offset Y': 6, 'Blur': 10, 'Spread': 0, 'Opacity': 60,
    });
    await setEffectColor(page, 'Shadow color', 30, 8, 20);

    await configureEffect(page, 'Outer Glow', {
      'Size': 18, 'Spread': 0, 'Opacity': 55,
    });
    await setEffectColor(page, 'Glow color', 240, 215, 130);

    await configureEffect(page, 'Stroke', {
      'Width': 2,
    });
    await setEffectColor(page, 'Stroke color', 196, 154, 76);

    await closeEffectsPanel(page);
    await page.waitForTimeout(80);

    // Effects on "decadence."
    await setActiveLayer(page, decId);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 3, 'Offset Y': 5, 'Blur': 8, 'Spread': 0, 'Opacity': 55,
    });
    await setEffectColor(page, 'Shadow color', 60, 25, 35);
    await closeEffectsPanel(page);
    await page.waitForTimeout(80);
    await page.screenshot({ path: shot('11-title-effects') });

    // (transform exercise removed — Ctrl+T isn't a shortcut in this app)

    // -------------------------------------------------------------------
    // PHASE 12: Sparkle layer with Screen blend mode
    // -------------------------------------------------------------------
    const sparkleId = await addLayer(page);
    await renameActiveLayer(page, 'Sparkles');

    await selectTool(page, 'spray');
    const sprayBar = page.locator(`role=toolbar >> [aria-label="Size value"]`).first();
    if (await sprayBar.isVisible().catch(() => false)) {
      await sprayBar.fill('40');
      await sprayBar.press('Enter');
    }
    await setForegroundColor(page, 255, 240, 200);
    for (const p of [
      { x: 260, y: 320 }, { x: 580, y: 320 }, { x: 170, y: 480 }, { x: 640, y: 720 },
    ]) {
      const sp = await docToScreen(page, p.x, p.y);
      await page.mouse.move(sp.x, sp.y);
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
    }
    await pushHistory(page, 'Sparkles');
    await setBlendMode(page, 'screen');
    await closeEffectsPanel(page);
    await page.screenshot({ path: shot('13-sparkles') });

    // -------------------------------------------------------------------
    // PHASE 13: Document-level adjustments — vignette, contrast, vibrance
    // -------------------------------------------------------------------
    const rootGroup = await getRootGroupId(page);
    await addAdjustment(page, rootGroup, 'vignette', { vignette: 35 });
    await page.waitForTimeout(100);
    await addAdjustment(page, rootGroup, 'contrast', { contrast: 14 });
    await page.waitForTimeout(100);
    await addAdjustment(page, rootGroup, 'saturation', { saturation: -10, vibrance: 18 });
    await page.waitForTimeout(100);
    await closeEffectsPanel(page);
    await page.screenshot({ path: shot('14-adjustments') });

    // -------------------------------------------------------------------
    // PHASE 14: Grain overlay (Add Noise filter on a gray layer + Overlay)
    // -------------------------------------------------------------------
    const grainId = await addLayer(page);
    await renameActiveLayer(page, 'Grain');
    await paintBatch(page, [
      { kind: 'rect', x: 0, y: 0, w: 800, h: 1100, color: { r: 128, g: 128, b: 128 } },
    ]);

    await page.click('text=Filter');
    await page.waitForTimeout(80);
    const noiseSub = page.getByRole('menuitem', { name: /^Noise/i }).first();
    if (await noiseSub.isVisible().catch(() => false)) {
      await noiseSub.hover();
      await page.waitForTimeout(80);
    }
    const addNoise = page.getByRole('menuitem', { name: /Add Noise/i }).first();
    if (await addNoise.isVisible().catch(() => false)) {
      await addNoise.click();
      await page.waitForTimeout(120);
      const applyBtn = page.locator('button:has-text("Apply")').first();
      if (await applyBtn.isVisible().catch(() => false)) {
        await applyBtn.click();
      }
      await page.waitForTimeout(120);
    } else {
      await page.keyboard.press('Escape');
    }
    await setBlendMode(page, 'overlay');
    await closeEffectsPanel(page);
    await setLayerOpacity(page, grainId, 38);
    await page.screenshot({ path: shot('15-grain') });

    // -------------------------------------------------------------------
    // PHASE 15: Final composite + PNG export
    // -------------------------------------------------------------------
    await pushHistory(page, 'Final');
    await page.waitForTimeout(100);

    const stats = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const c = await readFn();
      let opaque = 0;
      let rSum = 0, gSum = 0, bSum = 0;
      for (let i = 0; i < c.pixels.length; i += 4) {
        const a = c.pixels[i + 3] ?? 0;
        if (a > 200) {
          opaque++;
          rSum += c.pixels[i] ?? 0;
          gSum += c.pixels[i + 1] ?? 0;
          bSum += c.pixels[i + 2] ?? 0;
        }
      }
      return {
        w: c.width, h: c.height, opaque,
        rAvg: rSum / Math.max(1, opaque),
        gAvg: gSum / Math.max(1, opaque),
        bAvg: bSum / Math.max(1, opaque),
      };
    });

    expect(stats.opaque).toBeGreaterThan(stats.w * stats.h * 0.6);
    expect(stats.rAvg).toBeGreaterThan(stats.bAvg);

    await exportPng(page, path.join(SCREENSHOT_DIR, 'sacred-decadence.png'));
    await page.screenshot({ path: shot('18-final') });
  });
});
