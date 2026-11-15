/**
 * #1271 — on Apple GPUs (ANGLE Metal) Voronoi filled many cells with
 * vertical black stripes and grey. The shader hashed each cell's seed with
 * `fract(sin(q) * 43758.5453)`, which magnifies a one-ulp difference in `q`
 * into an unrelated value, and then found the nearest seed again in a second
 * pass by comparing recomputed positions. Where Metal's fast-math evaluated
 * the hash differently, the nearest seed was not recognised as itself, its
 * "border" ran through the pixel and painted it as edge.
 *
 * The seed is now an integer hash of the integer cell index (exact on every
 * backend), the nearest seed is skipped by index, and the cell colour is
 * sampled at the seed found in the first pass. This can't run on Metal here,
 * so it pins the behaviour every backend must now share: on a white layer the
 * default Voronoi is white cells cut by thin black borders.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, getEditorState, setForegroundColor } from './helpers';

interface Coverage {
  white: number;
  black: number;
  grey: number;
  opaque: number;
}

async function applyDefaultVoronoi(page: Page): Promise<void> {
  await page.click('text=Filter');
  await page.click('text=Voronoi...');
  await page.locator('h2:has-text("Voronoi")').waitFor({ state: 'visible' });
  await page.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(400);
}

async function coverage(page: Page, layerId: string): Promise<Coverage> {
  return page.evaluate(async (lid) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await readFn(lid);
    let white = 0;
    let black = 0;
    let grey = 0;
    let opaque = 0;
    for (let i = 0; i < width * height; i++) {
      const r = pixels[i * 4] ?? 0;
      const g = pixels[i * 4 + 1] ?? 0;
      const b = pixels[i * 4 + 2] ?? 0;
      if ((pixels[i * 4 + 3] ?? 0) > 250) opaque++;
      const v = Math.min(r, g, b);
      if (v >= 250) white++;
      else if (Math.max(r, g, b) < 64) black++;
      else grey++;
    }
    const n = width * height;
    return { white: white / n, black: black / n, grey: grey / n, opaque: opaque / n };
  }, layerId);
}

test.describe('Voronoi cells (#1271)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('a white layer gives white cells with thin black borders', async ({ page }) => {
    await createDocument(page, 1200, 800, false);
    const layer = (await getEditorState(page)).document.layers.find((l) => l.name === 'Layer 1');
    if (!layer) throw new Error('Layer 1 not found');

    await setForegroundColor(page, 255, 255, 255);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(200);

    const before = await coverage(page, layer.id);
    expect(before.white).toBeGreaterThan(0.99);

    await applyDefaultVoronoi(page);
    await page.screenshot({ path: 'e2e/screenshots/voronoi-cells-white.png' });

    const after = await coverage(page, layer.id);
    console.log('Voronoi coverage on white:', after);

    // Defaults: 20 cells down the 800 px side (40 px cells), 3 px black
    // borders. On SwiftShader that is ~5% black, ~8% anti-aliased grey and
    // ~87% white. The filter ran, so there are borders at all:
    expect(after.black).toBeGreaterThan(0.02);
    // Every cell samples the white source, so cell interiors stay white.
    // Striped or grey cells (#1271) push these well past their bounds.
    expect(after.white).toBeGreaterThan(0.8);
    expect(after.black).toBeLessThan(0.08);
    expect(after.grey).toBeLessThan(0.13);
    expect(after.opaque).toBeGreaterThan(0.99);
  });
});
