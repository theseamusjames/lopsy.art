import { test, expect, type Page } from './fixtures';
import {
  addLayer, closeEffectsPanel, configureEffect, createDocument, docToScreen, openEffectsPanel, selectTool,
  setEffectColor, setForegroundColor, waitForStore,
} from './helpers';

// Drop Shadow and Outer Glow used to be built from the layer's own pixels
// only, ignoring its Stroke effect. On a layer with an outside stroke the
// shadow started inside the outline — it peeked out past the stroke by
// (offset − stroke width) and left a notch at the corner nearest the
// layer — and the glow was buried under the stroke. Both now follow the
// layer's full silhouette, stroke included, in the live view, the export
// and Rasterize Layer Style.

type Rgba = { r: number; g: number; b: number; a: number };

// Red square 200..400 × 150..250 with a 12 px outside stroke, so the
// stroked silhouette spans 188..412 × 138..262. A stroke reaching more than
// 10 px past the edge is built by dilation, a narrower one by a per-pixel
// distance search; the centre-stroke test covers the second path.
const SQUARE = { x0: 200, y0: 150, x1: 400, y1: 250 };
const STROKE_W = 12;

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Composited canvas pixels at doc points, from a single readback. */
async function compositeAt(page: Page, points: Array<[number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const w = window as unknown as Record<string, unknown>;
    const readFn = w.__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const snap = await readFn();
    if (!snap) return [];
    const state = (w.__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    }).getState();
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const ratio = snap.width / container.clientWidth;
    const cssW = snap.width / ratio;
    const cssH = snap.height / ratio;
    return pts.map(([x, y]) => {
      const sx = Math.floor(((x + 0.5 - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cssW / 2) * ratio);
      const sy = Math.floor(((y + 0.5 - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cssH / 2) * ratio);
      const idx = ((snap.height - 1 - sy) * snap.width + sx) * 4;
      return { r: snap.pixels[idx] ?? 0, g: snap.pixels[idx + 1] ?? 0, b: snap.pixels[idx + 2] ?? 0, a: snap.pixels[idx + 3] ?? 0 };
    });
  }, points);
}

/** Quick Export PNG through the File menu and decode the requested pixels. */
async function exportedAt(page: Page, points: Array<[number, number]>): Promise<Rgba[]> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const png = Buffer.concat(chunks);

  return page.evaluate(async ({ bytes, pts }) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return pts.map(([x, y]) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! };
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }, { bytes: Array.from(png), pts: points });
}

async function drawStrokedSquare(
  page: Page,
  stroke: { width: number; position: 'outside' | 'center' } = { width: STROKE_W, position: 'outside' },
): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);
  await page.waitForSelector('[data-testid="canvas-container"]');

  const layerId = await addLayer(page);
  await setForegroundColor(page, 220, 30, 30);
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, SQUARE.x0, SQUARE.y0, SQUARE.x1, SQUARE.y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);

  await configureEffect(page, 'Stroke', { Width: stroke.width });
  await setEffectColor(page, 'Stroke color', 0, 208, 255);
  await page.locator(`[aria-label="Stroke position: ${stroke.position}"]`).click();
  return layerId;
}

const isRed = (p: Rgba): boolean => p.r > 180 && p.g < 80 && p.b < 80;
const isCyan = (p: Rgba): boolean => p.r < 90 && p.g > 150 && p.b > 180;
const isWhite = (p: Rgba): boolean => p.r > 245 && p.g > 245 && p.b > 245;
const isBlack = (p: Rgba): boolean => p.r < 30 && p.g < 30 && p.b < 30;

// Shadow offset (20, 20), no blur: the stroked silhouette's shadow spans
// 208..432 × 158..282. Built from the bare square it would span only
// 220..420 × 170..270.
const SHADOW_PROBES: Array<[number, number]> = [
  [300, 200], // the square
  [194, 200], // the stroke, left of the square
  [425, 220], // right of the stroke: shadow of the stroke's right edge
  [300, 277], // below the stroke: shadow of the stroke's bottom edge
  [212, 266], // bottom-left corner — the notch when the stroke is ignored
  [300, 134], // above the stroke: no shadow up here
  [436, 220], // beyond the shadow's right edge
];

function expectStrokedShadow(px: Rgba[]): void {
  expect(isRed(px[0]!)).toBe(true);
  expect(isCyan(px[1]!)).toBe(true);
  expect(isBlack(px[2]!)).toBe(true);
  expect(isBlack(px[3]!)).toBe(true);
  expect(isBlack(px[4]!)).toBe(true);
  expect(isWhite(px[5]!)).toBe(true);
  expect(isWhite(px[6]!)).toBe(true);
}

test.describe('Drop Shadow and Outer Glow include the Stroke effect', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('a drop shadow is cast by the stroked silhouette — live, export and rasterized', async ({ page }) => {
    test.setTimeout(300_000);
    await drawStrokedSquare(page);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 20, 'Offset Y': 20, Blur: 0, Spread: 0, Opacity: 100,
    });
    await setEffectColor(page, 'Shadow color', 0, 0, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(150);

    await page.screenshot({ path: 'e2e/screenshots/shadow-includes-stroke.png' });
    expectStrokedShadow(await compositeAt(page, SHADOW_PROBES));
    expectStrokedShadow(await exportedAt(page, SHADOW_PROBES));

    await openEffectsPanel(page);
    await page.locator('button:has-text("Rasterize Layer Style")').click();
    await page.waitForTimeout(200);
    await closeEffectsPanel(page);
    await page.screenshot({ path: 'e2e/screenshots/shadow-includes-stroke-rasterized.png' });
    expectStrokedShadow(await compositeAt(page, SHADOW_PROBES));
  });

  test('a centre stroke grows the shadow by half its width', async ({ page }) => {
    test.setTimeout(300_000);
    // 16 px centred: the silhouette spans 192..408 × 142..258, and the
    // (20, 20) shadow 212..428 × 162..278.
    await drawStrokedSquare(page, { width: 16, position: 'center' });
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 20, 'Offset Y': 20, Blur: 0, Spread: 0, Opacity: 100,
    });
    await setEffectColor(page, 'Shadow color', 0, 0, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/shadow-includes-stroke-center.png' });

    const px = await compositeAt(page, [
      [300, 200], [195, 200], [424, 220], [300, 275], [215, 268], [300, 138], [432, 220],
    ]);
    expect(isRed(px[0]!)).toBe(true);
    expect(isCyan(px[1]!)).toBe(true);
    expect(isBlack(px[2]!)).toBe(true);
    expect(isBlack(px[3]!)).toBe(true);
    expect(isBlack(px[4]!)).toBe(true);
    expect(isWhite(px[5]!)).toBe(true);
    expect(isWhite(px[6]!)).toBe(true);
  });

  test('a blurred drop shadow surrounds the stroke instead of starting inside it', async ({ page }) => {
    test.setTimeout(300_000);
    await drawStrokedSquare(page);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': 0, 'Offset Y': 0, Blur: 12, Spread: 0, Opacity: 100,
    });
    await setEffectColor(page, 'Shadow color', 0, 0, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/shadow-includes-stroke-blurred.png' });

    // Just outside the stroke, 14 px from the square: the blurred stroke
    // silhouette darkens it (~27 % black); the square's own blur (radius
    // 12) cannot reach that far and leaves it white.
    const [right, below] = await compositeAt(page, [[SQUARE.x1 + STROKE_W + 2, 200], [300, SQUARE.y1 + STROKE_W + 2]]);
    expect(right!.r).toBeLessThan(215);
    expect(below!.r).toBeLessThan(215);
  });

  test('an outer glow starts at the stroke, not underneath it', async ({ page }) => {
    test.setTimeout(300_000);
    await drawStrokedSquare(page);
    await configureEffect(page, 'Outer Glow', { Size: 16, Spread: 0, Opacity: 100 });
    await setEffectColor(page, 'Glow color', 0, 160, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/glow-includes-stroke.png' });

    // Just outside the stroke, 14–15 px from the square: beyond the reach
    // of a size-16 glow around the square, well inside one around the stroke.
    const probes: Array<[number, number]> = [
      [SQUARE.x1 + STROKE_W + 2, 200],
      [300, SQUARE.y0 - STROKE_W - 3],
      [194, 200],
      [300, 200],
    ];
    const isGlow = (p: Rgba): boolean => p.r < 220 && p.b < 220 && p.g > p.r + 20;
    const expectGlowOutsideStroke = (px: Rgba[]): void => {
      expect(isGlow(px[0]!)).toBe(true);
      expect(isGlow(px[1]!)).toBe(true);
      expect(isCyan(px[2]!)).toBe(true);
      expect(isRed(px[3]!)).toBe(true);
    };
    // The export is colour-managed differently from the canvas readback, so
    // the two are compared by what each pixel shows, not by exact values.
    expectGlowOutsideStroke(await compositeAt(page, probes));
    expectGlowOutsideStroke(await exportedAt(page, probes));
  });
});
