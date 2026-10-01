import { test, expect, type Page } from './fixtures';
import {
  addLayer, closeEffectsPanel, configureEffect, createDocument, docToScreen, selectTool,
  setEffectColor, setForegroundColor, waitForStore,
} from './helpers';

// Drop Shadow and Outer Glow are now cast from the layer plus its Stroke.
// A project saved before that change (format v1) stored settings tuned for
// the old rendering, where the stroke hid the first `width` px of both. On
// open, v1 effects are migrated so the document keeps its look: the shadow
// offset is pulled back by the stroke's reach per axis, and the glow's
// opacity scaled so its first pixel past the stroke keeps its old strength.
//
// The pre-change file is built here from a current save by rewriting its
// format version to 1 — the container was otherwise unchanged — which is
// byte-for-byte what the old app wrote for the same settings.

type Rgba = { r: number; g: number; b: number; a: number };

// Red square 200..400 × 150..250 with a 12 px outside stroke (188..412 ×
// 138..262 with the ring).
const SQUARE = { x0: 200, y0: 150, x1: 400, y1: 250 };
const STROKE_W = 12;
const OFFSET = 20;

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

const isRed = (p: Rgba): boolean => p.r > 180 && p.g < 80 && p.b < 80;
const isCyan = (p: Rgba): boolean => p.r < 90 && p.g > 150 && p.b > 180;
const isBlack = (p: Rgba): boolean => p.r < 30 && p.g < 30 && p.b < 30;
const isGlow = (p: Rgba): boolean => p.r < 220 && p.b < 220 && p.g > p.r + 20;

/**
 * The shadow's right and bottom edges: the first non-black pixel scanning
 * outward from inside the stroke along y = 220 and x = 300.
 */
async function shadowEdges(page: Page): Promise<{ right: number; bottom: number }> {
  const xs = Array.from({ length: 50 }, (_, i) => SQUARE.x1 + STROKE_W + 1 + i);
  const ys = Array.from({ length: 50 }, (_, i) => SQUARE.y1 + STROKE_W + 1 + i);
  const px = await compositeAt(page, [...xs.map((x): [number, number] => [x, 220]), ...ys.map((y): [number, number] => [300, y])]);
  const row = px.slice(0, xs.length);
  const col = px.slice(xs.length);
  const firstLit = (line: Rgba[], coords: number[]): number => {
    const i = line.findIndex((p) => !isBlack(p));
    return i < 0 ? Number.NaN : coords[i]!;
  };
  return { right: firstLit(row, xs), bottom: firstLit(col, ys) };
}

async function drawStrokedSquare(page: Page): Promise<void> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);
  await page.waitForSelector('[data-testid="canvas-container"]');

  await addLayer(page);
  await setForegroundColor(page, 220, 30, 30);
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, SQUARE.x0, SQUARE.y0, SQUARE.x1, SQUARE.y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);

  await configureEffect(page, 'Stroke', { Width: STROKE_W });
  await setEffectColor(page, 'Stroke color', 0, 208, 255);
  await page.locator('[aria-label="Stroke position: outside"]').click();
}

async function saveProject(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Save Project' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function formatVersion(file: Buffer): number {
  return file.readUInt16LE(6);
}

function manifestOf(file: Buffer): { version: number; layers: Array<{ effects: unknown }> } {
  const len = file.readUInt32LE(8);
  return JSON.parse(file.subarray(12, 12 + len).toString('utf8'));
}

/** Rewrite a saved project as the pre-change app wrote it: format v1. */
function asFormatV1(file: Buffer): Buffer {
  const manifest = { ...manifestOf(file), version: 1 };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const rest = file.subarray(12 + file.readUInt32LE(8));
  const header = Buffer.from(file.subarray(0, 12));
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(manifestBytes.length, 8);
  return Buffer.concat([header, manifestBytes, rest]);
}

async function openProject(page: Page, file: Buffer): Promise<void> {
  await page.reload();
  await waitForStore(page);
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open File")'),
  ]);
  await chooser.setFiles({ name: 'legacy.lopsy', mimeType: 'application/octet-stream', buffer: file });
  await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 20_000 });
  await expect.poll(() => layerEffects(page).then((e) => e !== null), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(500);
}

interface Fx {
  dropShadow: { offsetX: number; offsetY: number; opacity: number };
  outerGlow: { size: number; opacity: number };
}

/** Effects of the document's only stroked layer. */
async function layerEffects(page: Page): Promise<Fx | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ effects?: { stroke: { enabled: boolean } } }> } };
    };
    const l = store.getState().document.layers.find((x) => x.effects?.stroke.enabled);
    return (l?.effects as unknown as Fx | undefined) ?? null;
  });
}

test.describe('projects saved before shadows included the stroke keep their look', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('a v1 drop shadow opens with its edges where the old renderer put them', async ({ page }) => {
    test.setTimeout(300_000);
    await drawStrokedSquare(page);
    await configureEffect(page, 'Drop Shadow', {
      'Offset X': OFFSET, 'Offset Y': OFFSET, Blur: 0, Spread: 0, Opacity: 100,
    });
    await setEffectColor(page, 'Shadow color', 0, 0, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(150);

    // Cast from the stroked silhouette, these settings put the edges at the
    // ring + 20 = 432 / 282 ...
    expect(await shadowEdges(page)).toEqual({ right: SQUARE.x1 + STROKE_W + OFFSET, bottom: SQUARE.y1 + STROKE_W + OFFSET });

    const saved = await saveProject(page);
    expect(formatVersion(saved)).toBe(2);

    // ... while the old renderer cast them from the bare square: 420 / 270.
    await openProject(page, asFormatV1(saved));
    await page.screenshot({ path: 'e2e/screenshots/shadow-stroke-legacy-v1.png' });
    const [square, ring] = await compositeAt(page, [[300, 200], [194, 200]]);
    expect(isRed(square!)).toBe(true);
    expect(isCyan(ring!)).toBe(true);
    const legacy = await shadowEdges(page);
    expect(Math.abs(legacy.right - (SQUARE.x1 + OFFSET))).toBeLessThanOrEqual(1);
    expect(Math.abs(legacy.bottom - (SQUARE.y1 + OFFSET))).toBeLessThanOrEqual(1);
    expect((await layerEffects(page))!.dropShadow).toMatchObject({ offsetX: OFFSET - STROKE_W, offsetY: OFFSET - STROKE_W });

    // Saving writes the current version with the migrated values, and
    // reopening it doesn't migrate them a second time.
    const resaved = await saveProject(page);
    expect(formatVersion(resaved)).toBe(2);
    await openProject(page, resaved);
    expect((await layerEffects(page))!.dropShadow).toMatchObject({ offsetX: OFFSET - STROKE_W, offsetY: OFFSET - STROKE_W });
    expect(await shadowEdges(page)).toEqual(legacy);
  });

  test('a v1 outer glow the stroke used to hide stays hidden', async ({ page }) => {
    test.setTimeout(300_000);
    await drawStrokedSquare(page);
    await configureEffect(page, 'Outer Glow', { Size: 16, Spread: 0, Opacity: 100 });
    await setEffectColor(page, 'Glow color', 0, 160, 0);
    await closeEffectsPanel(page);
    await page.waitForTimeout(150);

    // Just outside the ring, 14 px from the square: lit by a glow around the
    // ring, beyond the reach of a size-16 glow around the bare square.
    const probe: [number, number] = [SQUARE.x1 + STROKE_W + 2, 200];
    const [current] = await compositeAt(page, [probe]);
    expect(isGlow(current!)).toBe(true);

    const saved = await saveProject(page);
    await openProject(page, asFormatV1(saved));
    await page.screenshot({ path: 'e2e/screenshots/glow-stroke-legacy-v1.png' });
    const [legacy, ring] = await compositeAt(page, [probe, [194, 200]]);
    expect(isCyan(ring!)).toBe(true);
    expect(isGlow(legacy!)).toBe(false);
    expect(Math.min(legacy!.r, legacy!.g, legacy!.b)).toBeGreaterThan(240);
    const fx = (await layerEffects(page))!;
    expect(fx.outerGlow.size).toBe(16);
    expect(fx.outerGlow.opacity).toBeLessThan(0.02);
  });
});
