import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForStore,
  createDocument,
  getEditorState,
  setForegroundColor,
  applyFilter,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(200);
}

interface EdgeStats {
  median: number;
  runs: number;
  grayCenter: number;
}

/**
 * Median length of runs of dark (edge) pixels along every 4th row and
 * column of the layer. Perpendicular crossings of a cell border give the
 * edge thickness; oblique crossings are longer, but the median is
 * dominated by near-perpendicular ones on both documents alike.
 */
async function edgeRunStats(page: Page, layerId: string): Promise<EdgeStats> {
  return page.evaluate(async (lid) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await readFn(lid);
    const isDark = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return (pixels[i + 3] ?? 0) > 128 && (pixels[i] ?? 255) < 100;
    };
    const runs: number[] = [];
    const scan = (len: number, at: (k: number) => boolean) => {
      let run = 0;
      for (let k = 0; k < len; k++) {
        if (at(k)) {
          run++;
          continue;
        }
        if (run > 0) runs.push(run);
        run = 0;
      }
      if (run > 0) runs.push(run);
    };
    for (let y = 0; y < height; y += 4) scan(width, (x) => isDark(x, y));
    for (let x = 0; x < width; x += 4) scan(height, (y) => isDark(x, y));
    runs.sort((a, b) => a - b);
    const median = runs.length ? runs[Math.floor(runs.length / 2)] ?? 0 : 0;
    let gray = 0;
    for (let i = 0; i < width * height; i++) {
      const r = pixels[i * 4] ?? 0;
      if (r > 190 && r < 210) gray++;
    }
    return { median, runs: runs.length, grayCenter: gray / (width * height) };
  }, layerId);
}

async function voronoiEdgeStats(page: Page, width: number, height: number): Promise<EdgeStats> {
  await createDocument(page, width, height, false);
  const state = await getEditorState(page);
  const layer1 = state.document.layers.find((l) => l.name === 'Layer 1');
  if (!layer1) throw new Error('Layer 1 not found');

  // Fill the whole of Layer 1 with #C8C8C8 (no selection).
  await setForegroundColor(page, 0xc8, 0xc8, 0xc8);
  await editFill(page);

  await applyFilter(page, 'Voronoi...', { Cells: 6, 'Edge Width': 12, Seed: 5 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `voronoi-edge-aspect-${width}x${height}.png`),
  });

  return edgeRunStats(page, layer1.id);
}

test.describe('Voronoi edge width on a non-square layer (#936)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('Edge Width gives the same pixel thickness on 600x600 and 1800x600', async ({ page }) => {
    const square = await voronoiEdgeStats(page, 600, 600);
    const wide = await voronoiEdgeStats(page, 1800, 600);

    // The filter ran on both: the layer is mostly flat #C8C8C8 cells cut by
    // a number of dark borders, with real thickness (not hairlines).
    for (const s of [square, wide]) {
      expect(s.grayCenter).toBeGreaterThan(0.5);
      expect(s.runs).toBeGreaterThan(20);
      expect(s.median).toBeGreaterThanOrEqual(5);
    }

    // #936: the px → cell-unit conversion divided by the long side, so on
    // the 3:1 document edges came out a third as thick (~3px vs ~9px).
    const ratio = wide.median / square.median;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.33);
  });
});
