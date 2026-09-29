import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  closeEffectsPanel,
  createDocument,
  drawRect,
  enableEffect,
  getEditorState,
  waitForStore,
} from './helpers';

// #1007: baking effects (Merge Down / Rasterize Layer Style) used to apply
// the layer's opacity twice — once inside the bake and again when the
// layer (or the merge) composited the baked pixels at the same opacity.
// A 50% red square over white read (255,128,128) live but (255,191,191)
// after either command.

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

interface Rgb { r: number; g: number; b: number }

async function readCompositedRow(page: Page, docY: number, docXs: number[]): Promise<Rgb[]> {
  return page.evaluate(async ({ y, xs }) => {
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
    return xs.map((x) => {
      const sx = Math.floor(((x + 0.5 - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cssW / 2) * ratio);
      const sy = Math.floor(((y + 0.5 - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cssH / 2) * ratio);
      const idx = ((snap.height - 1 - sy) * snap.width + sx) * 4;
      return { r: snap.pixels[idx] ?? 0, g: snap.pixels[idx + 1] ?? 0, b: snap.pixels[idx + 2] ?? 0 };
    });
  }, { y: docY, xs: docXs });
}

async function setOpacityFromRow(page: Page, layerId: string, percent: number): Promise<void> {
  const row = page.locator(`[data-layer-id="${layerId}"]`);
  await row.locator('button[aria-label^="Opacity"]').click();
  const slider = page.locator('input[type="range"][aria-label$=" opacity"]');
  await slider.waitFor({ state: 'visible', timeout: 5000 });
  await slider.fill(String(percent));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

// A row crossing the square's left edge (x=100) and reaching its centre, so
// the probe covers both the plain content and the inner glow band.
const ROW_Y = 200;
const ROW_XS = [90, 99, 100, 101, 103, 106, 110, 120, 150, 200];
const CENTRE_INDEX = ROW_XS.indexOf(200);

async function setupHalfOpacityGlowSquare(page: Page): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);
  const layerId = await addLayer(page);
  await drawRect(page, 100, 100, 200, 200, { r: 255, g: 0, b: 0 });
  await setOpacityFromRow(page, layerId, 50);

  const plain = await readCompositedRow(page, ROW_Y, ROW_XS);
  expect(plain[CENTRE_INDEX]!.r).toBeGreaterThan(250);
  expect(Math.abs(plain[CENTRE_INDEX]!.g - 128)).toBeLessThanOrEqual(2);

  await enableEffect(page, 'Inner Glow');
  return layerId;
}

function maxChannelDiff(a: Rgb[], b: Rgb[]): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    max = Math.max(max, Math.abs(pa.r - pb.r), Math.abs(pa.g - pb.g), Math.abs(pa.b - pb.b));
  }
  return max;
}

test.describe('Effect bake keeps layer opacity single-applied (#1007)', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('Merge Down of a 50% layer with Inner Glow matches the live composite', async ({ page }) => {
    await setupHalfOpacityGlowSquare(page);
    await closeEffectsPanel(page);

    const rastersBefore = (await getEditorState(page)).document.layers.filter((l) => l.type === 'raster').length;
    const before = await readCompositedRow(page, ROW_Y, ROW_XS);
    // The glow band tints the edge, so it must differ from the flat centre.
    expect(before[ROW_XS.indexOf(101)]).not.toEqual(before[CENTRE_INDEX]);

    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/effect-bake-opacity-merge-down.png' });

    const state = await getEditorState(page);
    expect(state.document.layers.filter((l) => l.type === 'raster')).toHaveLength(rastersBefore - 1);

    const after = await readCompositedRow(page, ROW_Y, ROW_XS);
    // Centre of the square: 50% red over white, not the 25% double-applied (255,191,191).
    expect(after[CENTRE_INDEX]!.r).toBeGreaterThan(250);
    expect(Math.abs(after[CENTRE_INDEX]!.g - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(after[CENTRE_INDEX]!.b - 128)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(before, after)).toBeLessThanOrEqual(3);
  });

  test('Rasterize Layer Style of a 50% layer looks identical to before', async ({ page }) => {
    const layerId = await setupHalfOpacityGlowSquare(page);
    const before = await readCompositedRow(page, ROW_Y, ROW_XS);

    await page.locator('button:has-text("Rasterize Layer Style")').click();
    await page.waitForTimeout(200);
    await closeEffectsPanel(page);
    await page.screenshot({ path: 'e2e/screenshots/effect-bake-opacity-rasterize.png' });

    const after = await readCompositedRow(page, ROW_Y, ROW_XS);
    expect(after[CENTRE_INDEX]!.r).toBeGreaterThan(250);
    expect(Math.abs(after[CENTRE_INDEX]!.g - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(after[CENTRE_INDEX]!.b - 128)).toBeLessThanOrEqual(2);
    expect(maxChannelDiff(before, after)).toBeLessThanOrEqual(3);

    // Opacity is baked into the pixels, so the row now reads 100%.
    await expect(page.locator(`[data-layer-id="${layerId}"] button[aria-label^="Opacity 100%"]`)).toBeVisible();
  });
});
