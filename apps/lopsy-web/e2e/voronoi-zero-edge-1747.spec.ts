/**
 * #1747 — Voronoi with Edge Width 0 must give flat cells only: no dark
 * pixel anywhere, in particular none at each cell's seed point.
 */
import { test, expect } from './fixtures';
import { waitForStore, createDocument, getEditorState, setForegroundColor, applyFilter } from './helpers';

test.describe('Voronoi with Edge Width 0 (#1747)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('draws no edge pixels, not even a dot at each seed', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    const layer = (await getEditorState(page)).document.layers.find((l) => l.name === 'Layer 1');
    if (!layer) throw new Error('Layer 1 not found');

    await setForegroundColor(page, 255, 255, 255);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(200);

    await applyFilter(page, 'Voronoi...', { Cells: 20, 'Edge Width': 0, Seed: 5 });
    await page.waitForTimeout(400);

    const counts = await page.evaluate(async (lid) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, height, pixels } = await readFn(lid);
      let dark = 0;
      let notWhite = 0;
      for (let i = 0; i < width * height; i++) {
        const v = Math.min(pixels[i * 4] ?? 0, pixels[i * 4 + 1] ?? 0, pixels[i * 4 + 2] ?? 0);
        if (v < 128) dark++;
        if (v < 250) notWhite++;
      }
      return { dark, notWhite, total: width * height };
    }, layer.id);
    console.log('Voronoi edge 0 on white:', counts);

    expect(counts.total).toBe(800 * 600);
    // A white source and no edges: every pixel stays white.
    expect(counts.dark).toBe(0);
    expect(counts.notWhite).toBe(0);
  });

  test('a non-zero Edge Width still draws edges', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    const layer = (await getEditorState(page)).document.layers.find((l) => l.name === 'Layer 1');
    if (!layer) throw new Error('Layer 1 not found');

    await setForegroundColor(page, 255, 255, 255);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(200);

    await applyFilter(page, 'Voronoi...', { Cells: 20, 'Edge Width': 1, Seed: 5 });
    await page.waitForTimeout(400);

    const dark = await page.evaluate(async (lid) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, height, pixels } = await readFn(lid);
      let n = 0;
      for (let i = 0; i < width * height; i++) {
        if (Math.max(pixels[i * 4] ?? 0, pixels[i * 4 + 1] ?? 0, pixels[i * 4 + 2] ?? 0) < 128) n++;
      }
      return n;
    }, layer.id);
    expect(dark).toBeGreaterThan(1000);
  });
});
