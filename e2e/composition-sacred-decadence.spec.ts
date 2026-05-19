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
    // PHASE 1: Document + background. Batched fill.
    // -------------------------------------------------------------------
    await createDocument(page, 800, 1100, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await renameActiveLayer(page, 'BG cream');

    await paintBatch(page, [
      { kind: 'rect', x: 0, y: 0, w: 800, h: 1100, color: { r: 247, g: 230, b: 210 } },
      { kind: 'circle', x: 400, y: 380, r: 420, color: { r: 234, g: 191, b: 194 } },
    ]);
    await pushHistory(page, 'Background');
    await page.screenshot({ path: shot('01-background') });

    // -------------------------------------------------------------------
    // PHASE 2: Gilded outer frame (8 rects in one batch).
    // -------------------------------------------------------------------
    const frameId = await addLayer(page);
    await renameActiveLayer(page, 'Gilt frame');

    const gold = { r: 196, g: 154, b: 76 };
    const lightGold = { r: 240, g: 215, b: 130 };

    await paintBatch(page, [
      { kind: 'rect', x: 40, y: 50, w: 720, h: 14, color: gold },
      { kind: 'rect', x: 40, y: 1036, w: 720, h: 14, color: gold },
      { kind: 'rect', x: 40, y: 50, w: 14, h: 1000, color: gold },
      { kind: 'rect', x: 746, y: 50, w: 14, h: 1000, color: gold },
      { kind: 'rect', x: 64, y: 74, w: 672, h: 4, color: lightGold },
      { kind: 'rect', x: 64, y: 1022, w: 672, h: 4, color: lightGold },
      { kind: 'rect', x: 64, y: 74, w: 4, h: 952, color: lightGold },
      { kind: 'rect', x: 732, y: 74, w: 4, h: 952, color: lightGold },
      // Decorative corner medallions
      { kind: 'circle', x: 80, y: 90, r: 14, color: gold },
      { kind: 'circle', x: 720, y: 90, r: 14, color: gold },
      { kind: 'circle', x: 80, y: 1010, r: 14, color: gold },
      { kind: 'circle', x: 720, y: 1010, r: 14, color: gold },
    ]);
    await pushHistory(page, 'Frame');
    await page.screenshot({ path: shot('02-frame') });

    // -------------------------------------------------------------------
    // PHASE 3: Central ornate oval (rococo cartouche), batched rings.
    // -------------------------------------------------------------------
    const cartoucheId = await addLayer(page);
    await renameActiveLayer(page, 'Cartouche');

    await paintBatch(page, [
      { kind: 'circle', x: 400, y: 600, r: 220, color: gold },
      { kind: 'circle', x: 400, y: 600, r: 200, color: { r: 247, g: 230, b: 210 } },
      { kind: 'circle', x: 400, y: 600, r: 190, color: gold },
      { kind: 'circle', x: 400, y: 600, r: 184, color: { r: 234, g: 191, b: 194 } },
    ]);

    // Exercise the elliptical-marquee UI path: select an inner ellipse,
    // screenshot with the marquee active, then deselect.
    await selectTool(page, 'marquee-ellipse');
    const ms = await docToScreen(page, 280, 530);
    const me = await docToScreen(page, 520, 670);
    await page.mouse.move(ms.x, ms.y);
    await page.mouse.down();
    await page.mouse.move(me.x, me.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    await page.screenshot({ path: shot('03-cartouche-marquee') });
    await page.keyboard.press('Control+d');
    await pushHistory(page, 'Cartouche');
    await page.screenshot({ path: shot('03-cartouche') });

    // -------------------------------------------------------------------
    // PHASE 4: Cherub silhouette inside cartouche
    // -------------------------------------------------------------------
    const cherubId = await addLayer(page);
    await renameActiveLayer(page, 'Cherub');

    await selectTool(page, 'brush');
    await setForegroundColor(page, 60, 40, 60);
    await setToolOption(page, 'Size', 40);
    await setToolOption(page, 'Hardness', 70);
    await setToolOption(page, 'Opacity', 100);
    // Head
    await brushStroke(page, [
      { x: 400, y: 540 }, { x: 420, y: 545 }, { x: 425, y: 565 },
      { x: 410, y: 580 }, { x: 385, y: 575 }, { x: 380, y: 555 }, { x: 400, y: 540 },
    ]);
    // Torso
    await setToolOption(page, 'Size', 55);
    await brushStroke(page, [
      { x: 400, y: 590 }, { x: 415, y: 615 }, { x: 420, y: 645 },
      { x: 400, y: 665 }, { x: 380, y: 645 }, { x: 385, y: 615 },
    ]);
    // Wings — quick swooshes
    await setToolOption(page, 'Size', 28);
    await brushStroke(page, [
      { x: 430, y: 595 }, { x: 470, y: 585 }, { x: 480, y: 615 }, { x: 455, y: 620 },
    ]);
    await brushStroke(page, [
      { x: 370, y: 595 }, { x: 330, y: 585 }, { x: 320, y: 615 }, { x: 345, y: 620 },
    ]);
    await pushHistory(page, 'Cherub');
    await page.screenshot({ path: shot('04-cherub') });

    // -------------------------------------------------------------------
    // PHASE 5: Rococo scrollwork — gold sinusoidal curls.
    // -------------------------------------------------------------------
    const scrollId = await addLayer(page);
    await renameActiveLayer(page, 'Scrollwork');

    await selectTool(page, 'brush');
    await setForegroundColor(page, gold.r, gold.g, gold.b);
    await setToolOption(page, 'Size', 8);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    const swoop = (cx: number, cy: number, length: number, amp: number, phase: number) => {
      const pts: Array<{ x: number; y: number }> = [];
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push({
          x: cx + (t - 0.5) * length,
          y: cy + Math.sin(t * Math.PI * 2 + phase) * amp,
        });
      }
      return pts;
    };

    await brushStroke(page, swoop(400, 130, 380, 14, 0));
    await brushStroke(page, swoop(400, 155, 300, 8, Math.PI / 2));
    await brushStroke(page, swoop(400, 970, 380, 16, Math.PI));
    await brushStroke(page, swoop(400, 1000, 300, 9, Math.PI * 1.5));

    const curl = (cx: number, cy: number, r: number, sweep: number, decay = 0.4) => {
      const pts: Array<{ x: number; y: number }> = [];
      const steps = 18;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * sweep;
        const rr = r * (1 - t * decay);
        pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
      }
      return pts;
    };
    await brushStroke(page, curl(140, 600, 70, Math.PI * 2.5));
    await brushStroke(page, curl(660, 600, -70, Math.PI * 2.5));
    await brushStroke(page, curl(220, 260, 36, Math.PI * 1.8));
    await brushStroke(page, curl(580, 260, -36, Math.PI * 1.8));
    await brushStroke(page, curl(220, 850, 36, -Math.PI * 1.8));
    await brushStroke(page, curl(580, 850, -36, -Math.PI * 1.8));

    await pushHistory(page, 'Scrollwork');
    await page.screenshot({ path: shot('05-scrollwork') });

    // -------------------------------------------------------------------
    // PHASE 6: Undo/redo sanity check
    // -------------------------------------------------------------------
    await undo(page);
    await page.waitForTimeout(120);
    await page.screenshot({ path: shot('06-after-undo') });
    await redo(page);
    await page.waitForTimeout(120);
    await page.screenshot({ path: shot('07-after-redo') });

    // -------------------------------------------------------------------
    // PHASE 7: Pink rose dabs in the corners — brush only
    // -------------------------------------------------------------------
    const rosesId = await addLayer(page);
    await renameActiveLayer(page, 'Roses');

    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 32);
    await setToolOption(page, 'Hardness', 40);
    await setToolOption(page, 'Opacity', 90);
    await setForegroundColor(page, 207, 132, 137);

    const rose = async (cx: number, cy: number) => {
      await brushStroke(page, [
        { x: cx - 18, y: cy - 6 }, { x: cx + 4, y: cy - 16 }, { x: cx + 18, y: cy },
        { x: cx + 8, y: cy + 16 }, { x: cx - 14, y: cy + 10 }, { x: cx - 20, y: cy - 4 },
      ]);
    };
    await rose(155, 260);
    await rose(645, 260);
    await rose(155, 880);
    await rose(645, 880);
    await rose(140, 540);
    await rose(660, 540);

    // Bright centers
    await setForegroundColor(page, 240, 175, 180);
    await setToolOption(page, 'Size', 18);
    for (const p of [
      { x: 155, y: 260 }, { x: 645, y: 260 }, { x: 155, y: 880 },
      { x: 645, y: 880 }, { x: 140, y: 540 }, { x: 660, y: 540 },
    ]) {
      await brushStroke(page, [p, { x: p.x + 1, y: p.y + 1 }]);
    }

    await pushHistory(page, 'Roses');
    await page.screenshot({ path: shot('08-roses') });

    // -------------------------------------------------------------------
    // PHASE 8: Ribbon banner under the cartouche (batched)
    // -------------------------------------------------------------------
    const ribbonId = await addLayer(page);
    await renameActiveLayer(page, 'Ribbon');

    const darkGold = { r: 158, g: 120, b: 50 };
    await paintBatch(page, [
      { kind: 'rect', x: 200, y: 760, w: 400, h: 70, color: gold },
      { kind: 'rect', x: 200, y: 782, w: 400, h: 14, color: lightGold },
      { kind: 'rect', x: 170, y: 770, w: 50, h: 50, color: darkGold },
      { kind: 'rect', x: 580, y: 770, w: 50, h: 50, color: darkGold },
    ]);
    await pushHistory(page, 'Ribbon');
    await page.screenshot({ path: shot('09-ribbon') });

    // -------------------------------------------------------------------
    // PHASE 9: Typography — SACRED / decadence. / issue tag
    // -------------------------------------------------------------------
    const sacredId = await addRasterizedText(page, 'SACRED', 88, 130, {
      fontFamily: 'Garamond',
      fontSize: 140,
      fontWeight: 700,
      fontStyle: 'normal',
      color: { r: 86, g: 32, b: 48 },
      letterSpacing: 8,
    });
    await page.waitForTimeout(60);

    const decId = await addRasterizedText(page, 'decadence.', 130, 860, {
      fontFamily: 'Brush Script MT',
      fontSize: 120,
      fontWeight: 400,
      fontStyle: 'italic',
      color: { r: 86, g: 32, b: 48 },
      letterSpacing: 2,
    });
    await page.waitForTimeout(60);

    const issueId = await addRasterizedText(page, 'ISSUE IV  ·  MMXXVI', 256, 780, {
      fontFamily: 'Palatino',
      fontSize: 22,
      fontWeight: 700,
      fontStyle: 'italic',
      color: { r: 247, g: 230, b: 210 },
      letterSpacing: 4,
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

    // -------------------------------------------------------------------
    // PHASE 11: Transform — open transform on the cherub and commit
    // (exercises the float/transform path)
    // -------------------------------------------------------------------
    await setActiveLayer(page, cherubId);
    await selectTool(page, 'move');
    await page.keyboard.press('Control+t');
    await page.waitForTimeout(200);
    await page.screenshot({ path: shot('12-transform-active') });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);

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
      { x: 240, y: 320 }, { x: 560, y: 320 }, { x: 170, y: 470 },
      { x: 630, y: 470 }, { x: 200, y: 720 }, { x: 600, y: 720 }, { x: 400, y: 280 },
    ]) {
      const sp = await docToScreen(page, p.x, p.y);
      await page.mouse.move(sp.x, sp.y);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
      await page.waitForTimeout(40);
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
    await setLayerOpacity(page, grainId, 18);
    await page.screenshot({ path: shot('15-grain') });

    // -------------------------------------------------------------------
    // PHASE 15: Multi-undo / multi-redo sanity
    // -------------------------------------------------------------------
    for (let i = 0; i < 4; i++) {
      await undo(page);
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: shot('16-multi-undo') });
    for (let i = 0; i < 4; i++) {
      await redo(page);
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: shot('17-multi-redo') });

    // -------------------------------------------------------------------
    // PHASE 16: Final composite assertion + PNG export
    // -------------------------------------------------------------------
    await pushHistory(page, 'Final');
    await page.waitForTimeout(150);

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
