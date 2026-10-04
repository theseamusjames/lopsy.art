/**
 * Regression test for #1195: Halftone sampled each cell centre with a
 * straight-alpha LINEAR fetch. Where a centre landed between texels on an
 * anti-aliased edge, the transparent neighbours' black RGB was averaged in,
 * so luminance dropped and the dot grew to ~20 px — a faint dark ghost dot
 * spilling past the shape's silhouette.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, setForegroundColor, docToScreen, applyFilter } from './helpers';

const CX = 400;
const CY = 300;
const RADIUS = 200;

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
}

interface StrayStats {
  farthest: number;
  darkest: number;
  dotPixels: number;
}

/**
 * Over every visible pixel of the active layer: the farthest distance from
 * the circle's centre, the darkest red value, and how many pixels are set.
 */
async function strayStats(page: Page): Promise<StrayStats> {
  return page.evaluate(async ({ cx, cy }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layer.id);
    let farthest = 0;
    let darkest = 255;
    let dotPixels = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        const i = (y * px.width + x) * 4;
        if ((px.pixels[i + 3] ?? 0) <= 8) continue;
        dotPixels++;
        const d = Math.hypot(x + layer.x + 0.5 - cx, y + layer.y + 0.5 - cy);
        farthest = Math.max(farthest, d);
        darkest = Math.min(darkest, px.pixels[i] ?? 255);
      }
    }
    return { farthest, darkest, dotPixels };
  }, { cx: CX, cy: CY });
}

test('Halftone prints no oversized ghost dots on an anti-aliased edge (#1195)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'menus and marquee drags need the desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);
  await page.waitForTimeout(300);

  await setForegroundColor(page, 0xcc, 0xcc, 0xcc);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  await dragMarquee(page, CX - RADIUS, CY - RADIUS, CX + RADIUS, CY + RADIUS);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  await applyFilter(page, 'Halftone...', { 'Dot Size': 24, Angle: 0, Softness: 1, Density: 1 });
  await page.waitForTimeout(300);

  const stats = await strayStats(page);
  expect(stats.dotPixels).toBeGreaterThan(1000);
  // A #CCCCCC dot has radius ~2.4 px plus 1 px softness, so a rim cell's dot
  // reaches at most ~4 px past the edge. The ghost dots reached ~10 px out.
  expect(stats.farthest).toBeLessThan(RADIUS + 6);
  // Every dot keeps the fill colour; the ghosts were darkened to RGB ~51.
  expect(stats.darkest).toBeGreaterThan(190);
});
