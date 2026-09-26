import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, getPixelAt, applyFilter, addLayer, drawEllipse } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function readCompositedAt(page: Page, docX: number, docY: number) {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

function getActiveLayerId(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function expandColorPanel(page: Page) {
  const hexInput = page.locator('[aria-label="Hex color value"]');
  if (!(await hexInput.isVisible({ timeout: 500 }).catch(() => false))) {
    const header = page.locator('text=Color').first();
    if (await header.isVisible({ timeout: 500 }).catch(() => false)) {
      await header.click();
      await page.waitForTimeout(200);
    }
  }
}

async function paintFourQuadrants(page: Page, size: number) {
  const half = size / 2;
  await page.evaluate(({ size, half }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const s = store.getState();
    const id = s.document.activeLayerId;
    const img = new ImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (x < half && y < half) {
          img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 0; img.data[i + 3] = 255;
        } else if (x >= half && y < half) {
          img.data[i] = 0; img.data[i + 1] = 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
        } else if (x < half && y >= half) {
          img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 255; img.data[i + 3] = 255;
        } else {
          img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
        }
      }
    }
    s.updateLayerPixelData(id, img);
  }, { size, half });
  await page.waitForTimeout(200);
}

async function paintSolidColor(page: Page, size: number, r: number, g: number, b: number) {
  await page.evaluate(({ size, r, g, b }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const s = store.getState();
    const id = s.document.activeLayerId;
    const img = new ImageData(size, size);
    for (let i = 0; i < size * size * 4; i += 4) {
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    s.updateLayerPixelData(id, img);
  }, { size, r, g, b });
  await page.waitForTimeout(200);
}

test.describe('Voronoi Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies voronoi filter and creates visible cell pattern', async ({ page }) => {
    await createDocument(page, 300, 300, true);
    await paintFourQuadrants(page, 300);
    await fitToView(page);

    const activeLayerId = await getActiveLayerId(page);

    // Sample pixels before filter
    const samplePoints = [
      [30, 30], [75, 75], [225, 75], [75, 225], [225, 225], [150, 150],
    ];
    const beforePixels: Array<{ r: number; g: number; b: number; a: number }> = [];
    for (const [x, y] of samplePoints) {
      beforePixels.push(await getPixelAt(page, x, y, activeLayerId));
    }

    // Screenshot before
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'voronoi-before.png') });

    // Apply voronoi filter
    await applyFilter(page, 'Voronoi...', {
      'Cells': 15,
      'Edge Width': 5,
      'Seed': 42,
    });
    await page.waitForTimeout(500);

    // Screenshot after
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'voronoi-after.png') });

    // Read same pixels after
    const afterPixels: Array<{ r: number; g: number; b: number; a: number }> = [];
    for (const [x, y] of samplePoints) {
      afterPixels.push(await getPixelAt(page, x, y, activeLayerId));
    }

    // Count significantly changed pixels — voronoi resamples from cell centers,
    // so many pixels near boundaries or not at cell centers will shift.
    let changedCount = 0;
    for (let i = 0; i < samplePoints.length; i++) {
      const before = beforePixels[i];
      const after = afterPixels[i];
      const dr = Math.abs(after.r - before.r);
      const dg = Math.abs(after.g - before.g);
      const db = Math.abs(after.b - before.b);
      if (dr + dg + db > 15) {
        changedCount++;
      }
    }
    expect(changedCount).toBeGreaterThanOrEqual(1);

    // Adjacent pixels within a cell should have the same color
    // (voronoi quantizes the image into flat-color regions).
    const p1 = await getPixelAt(page, 30, 30, activeLayerId);
    const p2 = await getPixelAt(page, 31, 31, activeLayerId);
    const nearDiff = Math.abs(p1.r - p2.r) + Math.abs(p1.g - p2.g) + Math.abs(p1.b - p2.b);
    expect(nearDiff).toBeLessThanOrEqual(5);
  });

  test('voronoi filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await paintSolidColor(page, 200, 100, 150, 200);
    await fitToView(page);

    const activeLayerId = await getActiveLayerId(page);
    const beforePixel = await getPixelAt(page, 100, 100, activeLayerId);

    await applyFilter(page, 'Voronoi...', {
      'Cells': 10,
      'Edge Width': 4,
      'Seed': 7,
    });
    await page.waitForTimeout(300);

    // The filter with edges should change some pixels on a solid color
    // (the black edges create dark lines)
    const afterPixel = await getPixelAt(page, 100, 100, activeLayerId);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const undonePixel = await getPixelAt(page, 100, 100, activeLayerId);
    expect(Math.abs(undonePixel.r - beforePixel.r)).toBeLessThan(5);
    expect(Math.abs(undonePixel.g - beforePixel.g)).toBeLessThan(5);
    expect(Math.abs(undonePixel.b - beforePixel.b)).toBeLessThan(5);
  });

  test('voronoi filter dialog UI is visible and functional', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintSolidColor(page, 200, 200, 100, 50);
    await fitToView(page);

    // Open the filter dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Voronoi...');
    await page.waitForTimeout(300);

    // The dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Voronoi")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Screenshot the dialog UI
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'voronoi-dialog.png') });

    // Apply button should exist
    const applyButton = page.locator('button:has-text("Apply")');
    await expect(applyButton).toBeVisible();

    // Click Apply
    await applyButton.click();
    await page.waitForTimeout(300);

    // Dialog should close
    await expect(dialogHeading).not.toBeVisible({ timeout: 3000 });
  });

  // Regression test for #916: applying Voronoi to a layer with an isolated
  // painted shape on transparency must keep the rest of the layer
  // transparent (silhouette preserved), not flood it with opaque black.
  // #766 forced the shader's output alpha to 1.0 for Voronoi along with
  // three true generators (Clouds/Smoke/Fibers) — but Voronoi samples the
  // source image, so forcing alpha=1 turned every transparent cell opaque
  // black.
  test('voronoi preserves transparency around an isolated shape (#916)', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Layer 0 ("Background") is opaque white. Add a transparent layer on
    // top and paint an isolated red disc on it — mirrors the issue's
    // "Elliptical Marquee + Fill" repro (drawEllipse drives the shape tool
    // via real mouse drags, producing the same isolated-shape-on-
    // transparency result).
    const layerId = await addLayer(page);
    await drawEllipse(page, 200, 150, 50, 50, { r: 220, g: 20, b: 20 });
    await fitToView(page);

    // Sanity check the fixture: far from the disc the top layer is
    // transparent and the white background shows through.
    const cornerBefore = await getPixelAt(page, 10, 10, layerId);
    expect(cornerBefore.a).toBeLessThan(10);
    const compositedCornerBefore = await readCompositedAt(page, 10, 10);
    expect(compositedCornerBefore.r).toBeGreaterThan(240);
    expect(compositedCornerBefore.a).toBeGreaterThan(240);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'voronoi-transparency-before.png') });

    await applyFilter(page, 'Voronoi...', {
      'Cells': 15,
      'Edge Width': 4,
      'Seed': 11,
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'voronoi-transparency-after.png') });

    // The corner, far from the disc, must still be transparent on the
    // filtered layer — the bug made every pixel of the layer opaque black.
    const cornerAfter = await getPixelAt(page, 10, 10, layerId);
    expect(cornerAfter.a).toBeLessThan(10);

    // ...and the white background must still show through at that corner
    // in the composite (the bug painted it opaque black there).
    const compositedCornerAfter = await readCompositedAt(page, 10, 10);
    expect(compositedCornerAfter.r).toBeGreaterThan(240);
    expect(compositedCornerAfter.g).toBeGreaterThan(240);
    expect(compositedCornerAfter.b).toBeGreaterThan(240);
    expect(compositedCornerAfter.a).toBeGreaterThan(240);

    // The disc itself should still be there (filter actually ran and the
    // shape wasn't wiped out) — center of the disc should be opaque.
    const centerAfter = await getPixelAt(page, 200, 150, layerId);
    expect(centerAfter.a).toBeGreaterThan(200);
  });
});
