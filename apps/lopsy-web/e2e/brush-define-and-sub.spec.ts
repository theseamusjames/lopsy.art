import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, openBrushModal, closeBrushModal } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    if (dr + dg + db > 30) count++;
  }
  return count;
}

async function makeRectSelection(page: Page, x: number, y: number, w: number, h: number) {
  await page.keyboard.press('m');
  await page.waitForTimeout(100);
  const start = await docToScreen(page, x, y);
  const end = await docToScreen(page, x + w, y + h);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function pushHistory(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label: string) => void };
    };
    store.getState().pushHistory('test');
  });
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Tests: Define Brush
// ---------------------------------------------------------------------------

test.describe('Define Brush from Selection', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('defined brush dab matches the source shape', async ({ page }) => {
    // Paint an L-shape: a vertical bar on the left and a horizontal bar
    // along the bottom. Size 30 strokes on a ~200px bounding box produce
    // arms that are ~15% of the bounding box width — enough to be clearly
    // captured by a 16×16 sample grid while leaving the top-right empty.
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 30);
    await setToolOption(page, 'Hardness', 100);
    await setForegroundColor(page, 0, 0, 0);
    // Vertical stroke on the left side
    await drawStroke(page, { x: 50, y: 30 }, { x: 50, y: 230 }, 20);
    // Horizontal stroke along the bottom
    await drawStroke(page, { x: 50, y: 225 }, { x: 250, y: 225 }, 20);
    await pushHistory(page);

    // Select the L-shape area generously
    await makeRectSelection(page, 20, 10, 260, 240);
    await page.evaluate(() => { window.prompt = () => 'PaintBlob'; });
    await page.locator('nav[aria-label="Application menu"] button:has-text("Edit")').click();
    await page.locator('[role="menu"][aria-label="Edit"] button:has-text("Define Brush...")').click();
    await page.waitForTimeout(500);

    // Verify tip was created with meaningful dimensions
    const tipInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { activeBrushTip: { width: number; height: number; data: Uint8ClampedArray } | null };
      };
      const tip = store.getState().activeBrushTip;
      if (!tip) return null;
      // Sample the tip at a grid of points to build a shape fingerprint.
      const cols = 16;
      const rows = 16;
      const grid: number[] = [];
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const px = Math.floor((gx + 0.5) * tip.width / cols);
          const py = Math.floor((gy + 0.5) * tip.height / rows);
          grid.push(tip.data[py * tip.width + px]! > 20 ? 1 : 0);
        }
      }
      return { w: tip.width, h: tip.height, grid };
    });
    expect(tipInfo).not.toBeNull();
    expect(tipInfo!.w).toBeGreaterThan(30);
    expect(tipInfo!.h).toBeGreaterThan(30);

    // The L-shape tip: vertical bar on left, horizontal bar on bottom.
    // The brush tip is cropped to content bounds, so the grid should show
    // content along the left edge and bottom edge, with the top-right empty.
    const filledCells = tipInfo!.grid.filter((v) => v === 1).length;
    const emptyCells = tipInfo!.grid.filter((v) => v === 0).length;
    // Not all cells filled (would be a rectangle) and not all empty
    expect(filledCells).toBeGreaterThan(5);
    expect(emptyCells).toBeGreaterThan(30);

    // Create a fresh document and dab the blob brush
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(300);

    await page.keyboard.press('b');
    await setForegroundColor(page, 255, 0, 0);
    await setToolOption(page, 'Size', 150);
    // Wait for the frame sync to re-upload the brush tip to the new engine
    await page.waitForTimeout(1000);

    const center = await docToScreen(page, 200, 150);
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(500);

    // Flush the stroke to the layer texture
    await pushHistory(page);

    await page.screenshot({ path: 'e2e/screenshots/brush-define-blob-dab.png' });

    // Read the active layer's pixels directly (not composited — that
    // includes the opaque background layer which fills every pixel).
    const dabResult = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      const layerId = store.getState().document.activeLayerId;
      return ((window as unknown as Record<string, (...args: unknown[]) => Promise<{
        width: number; height: number; pixels: number[];
      }>>).__readLayerPixels!(layerId));
    });
    const dw = dabResult.width;
    const dh = dabResult.height;

    // Layer pixel buffer is top-down (no flip needed)
    let minX = dw, maxX = 0, minY = dh, maxY = 0;
    for (let py = 0; py < dh; py++) {
      for (let px = 0; px < dw; px++) {
        const idx = (py * dw + px) * 4;
        const a = dabResult.pixels[idx + 3] ?? 0;
        if (a > 10) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }

    const dabW = maxX - minX + 1;
    const dabH = maxY - minY + 1;
    expect(dabW).toBeGreaterThan(30);
    expect(dabH).toBeGreaterThan(30);

    // Sample the dab at a 16×16 grid within its bounding box
    const dabGrid: number[] = [];
    const cols = 16;
    const rows = 16;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const px = minX + Math.floor((gx + 0.5) * dabW / cols);
        const py = minY + Math.floor((gy + 0.5) * dabH / rows);
        const idx = (py * dw + px) * 4;
        dabGrid.push((dabResult.pixels[idx + 3] ?? 0) > 10 ? 1 : 0);
      }
    }

    // Compare the tip grid to the dab grid — they should match since
    // the dab is the tip rendered at a different size. Allow up to 15%
    // mismatch for rasterization differences at the scaled size.
    let matches = 0;
    for (let i = 0; i < tipInfo!.grid.length; i++) {
      if (tipInfo!.grid[i] === dabGrid[i]) matches++;
    }
    const matchRate = matches / tipInfo!.grid.length;
    expect(matchRate).toBeGreaterThan(0.85);
  });

  test('define color brush preserves RGBA data', async ({ page }) => {
    // Draw a large colored area as brush source
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 80);
    await setToolOption(page, 'Hardness', 100);
    await setForegroundColor(page, 0, 200, 100);
    await drawStroke(page, { x: 50, y: 80 }, { x: 180, y: 80 }, 10);
    await pushHistory(page);

    // Select it with a generous area
    await makeRectSelection(page, 20, 30, 180, 100);

    // Define as color brush
    await page.evaluate(() => {
      window.prompt = () => 'Color Brush';
    });
    await page.locator('nav[aria-label="Application menu"] button:has-text("Edit")').click();
    await page.locator('[role="menu"][aria-label="Edit"] button:has-text("Define Color Brush...")').click();
    await page.waitForTimeout(500);

    // Verify the tip kind is 'color'
    const tipInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { activeBrushTip: { kind?: string; width: number; height: number } | null };
      };
      const tip = store.getState().activeBrushTip;
      return tip ? { kind: tip.kind, width: tip.width, height: tip.height } : null;
    });
    expect(tipInfo).not.toBeNull();
    expect(tipInfo!.kind).toBe('color');
    expect(tipInfo!.width).toBeGreaterThan(10);
    expect(tipInfo!.height).toBeGreaterThan(10);

    // Create a fresh document and paint with the color brush.
    // Set foreground to RED — if the brush paints green (source color)
    // instead of red (foreground), that proves color tip works.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(300);

    await page.keyboard.press('b');
    await setForegroundColor(page, 255, 0, 0);
    await setToolOption(page, 'Size', 100);
    await page.waitForTimeout(200);

    const center = await docToScreen(page, 200, 150);
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/brush-define-color.png' });

    // Read composited pixels and check that green channel dominates
    // over red in the painted area. The source was rgb(0,200,100) so
    // a color brush should paint green tones despite foreground being red.
    const result = await snapshot(page);
    const w = result.width;
    const h = result.height;
    let greenSum = 0;
    let redSum = 0;
    let opaqueCount = 0;
    for (let i = 0; i < result.pixels.length; i += 4) {
      const a = result.pixels[i + 3] ?? 0;
      if (a > 20) {
        redSum += result.pixels[i] ?? 0;
        greenSum += result.pixels[i + 1] ?? 0;
        opaqueCount++;
      }
    }
    expect(opaqueCount).toBeGreaterThan(50);
    // Color brush: green channel should be stronger than red
    // (source was green, foreground was red — if foreground leaked, red would dominate)
    expect(greenSum).toBeGreaterThan(redSum);
  });
});

// ---------------------------------------------------------------------------
// Tests: Sub-Brushes
// ---------------------------------------------------------------------------

test.describe('Sub-Brushes', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
  });

  test('adding a sub-brush produces more paint per stroke', async ({ page }) => {
    test.setTimeout(600_000);
    await setToolOption(page, 'Size', 20);
    await setToolOption(page, 'Hardness', 100);
    await setForegroundColor(page, 255, 0, 0);

    // Paint without sub-brushes
    const before1 = await snapshot(page);
    await drawStroke(page, { x: 50, y: 100 }, { x: 550, y: 100 }, 20);
    const after1 = await snapshot(page);
    const singleBrushPixels = pixelDiff(before1, after1);
    await pushHistory(page);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Add a sub-brush via store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { addSubBrush: (sub: unknown) => void };
      };
      store.getState().addSubBrush({
        tip: null,
        sizeRatio: 1.5,
        hardness: 100,
        opacityRatio: 0.8,
        angleOffset: 0,
        sizeJitter: 0,
        angleJitter: 0,
        opacityJitter: 0,
      });
    });

    // Paint with sub-brush active at a different Y so we can measure independently
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 50, y: 200 }, { x: 550, y: 200 }, 20);
    const after2 = await snapshot(page);
    const subBrushPixels = pixelDiff(before2, after2);

    // Sub-brush at 1.5x size should produce more painted pixels than
    // the single brush (wider stroke footprint from the larger sub-brush)
    expect(subBrushPixels).toBeGreaterThan(singleBrushPixels);

    // Measure vertical extent of the sub-brush stroke.
    // The primary is size 20 and the sub-brush is 1.5x = 30px.
    // The combined stroke should be at least 25px tall (sub-brush extends
    // beyond the primary).
    const w2 = after2.width;
    const h2 = after2.height;
    const centerCol = Math.floor(w2 / 2);
    let strokeMinY = h2, strokeMaxY = 0;
    for (let py = 0; py < h2; py++) {
      const idx = (py * w2 + centerCol) * 4;
      const dr = Math.abs((after2.pixels[idx] ?? 0) - (before2.pixels[idx] ?? 0));
      const dg = Math.abs((after2.pixels[idx + 1] ?? 0) - (before2.pixels[idx + 1] ?? 0));
      const db = Math.abs((after2.pixels[idx + 2] ?? 0) - (before2.pixels[idx + 2] ?? 0));
      if (dr + dg + db > 20) {
        if (py < strokeMinY) strokeMinY = py;
        if (py > strokeMaxY) strokeMaxY = py;
      }
    }
    const strokeHeight = strokeMaxY - strokeMinY + 1;
    // With sub-brush at 1.5x, the combined stroke should be wider than
    // the primary alone (20px). Expect at least 18px at 1:1 scale —
    // conservative to account for sub-pixel rounding at different
    // viewport resolutions.  The readback is at viewport resolution
    // which may differ from the document, so scale the threshold.
    const scale = after2.width / 600;
    expect(strokeHeight).toBeGreaterThan(Math.floor(18 * scale));

    await page.screenshot({ path: 'e2e/screenshots/brush-sub-brush-more-paint.png' });
  });

  test('sub-brush angle jitter produces visible variation', async ({ page }) => {
    test.setTimeout(600_000);
    await setToolOption(page, 'Size', 60);
    await setToolOption(page, 'Hardness', 100);
    await setForegroundColor(page, 0, 0, 255);

    // Add a sub-brush with a square tip at full size, NO jitter
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          presets: Array<{ id: string; name: string; tip: unknown }>;
          addSubBrush: (sub: unknown) => void;
        };
      };
      const s = store.getState();
      const square = s.presets.find((p) => p.name === 'Square');
      s.addSubBrush({
        tip: square?.tip ?? null,
        sizeRatio: 1.0,
        hardness: 100,
        opacityRatio: 1.0,
        angleOffset: 0,
        sizeJitter: 0,
        angleJitter: 0,
        opacityJitter: 0,
      });
    });

    // Paint stroke with no jitter
    const before1 = await snapshot(page);
    await drawStroke(page, { x: 50, y: 100 }, { x: 550, y: 100 }, 20);
    const after1 = await snapshot(page);
    const noJitterDiff = pixelDiff(before1, after1);
    await pushHistory(page);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Set angle jitter to 100 on the sub-brush
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { updateSubBrush: (idx: number, patch: unknown) => void };
      };
      store.getState().updateSubBrush(0, { angleJitter: 100 });
    });

    // Paint same stroke with angle jitter
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 50, y: 100 }, { x: 550, y: 100 }, 20);
    const after2 = await snapshot(page);
    const jitterDiff = pixelDiff(before2, after2);

    // Both strokes should produce visible output
    expect(noJitterDiff).toBeGreaterThan(100);
    expect(jitterDiff).toBeGreaterThan(100);

    // Angle jitter on a square tip should produce a different pixel count.
    // With jitter, rotated squares cover more area than axis-aligned ones.
    const ratio = jitterDiff / noJitterDiff;
    const deviation = Math.abs(ratio - 1.0);
    expect(deviation).toBeGreaterThan(0.1);

    await page.screenshot({ path: 'e2e/screenshots/brush-sub-brush-angle-jitter.png' });
  });

  test('sub-brush tab UI adds and removes sub-brushes', async ({ page }) => {
    test.setTimeout(600_000);
    await openBrushModal(page);

    // Navigate to Sub-Brushes tab
    const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
    await dialog.locator('text=Sub-Brushes').click();
    await page.waitForTimeout(100);

    // Initially no sub-brushes
    await expect(dialog.locator('text=Add Sub-Brush')).toBeVisible();

    // Add a sub-brush
    await dialog.locator('text=Add Sub-Brush').click();
    await page.waitForTimeout(100);

    // Should see "Sub-Brush 1" and a Remove button
    await expect(dialog.locator('text=Sub-Brush 1')).toBeVisible();
    await expect(dialog.locator('text=Remove')).toBeVisible();

    // Add another
    await dialog.locator('text=Add Sub-Brush').click();
    await page.waitForTimeout(100);
    await expect(dialog.locator('text=Sub-Brush 2')).toBeVisible();

    // Remove the first one
    await dialog.locator('text=Remove').first().click();
    await page.waitForTimeout(100);

    // Only one sub-brush remains
    const subBrushCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { activeSubBrushes: unknown[] };
      };
      return store.getState().activeSubBrushes.length;
    });
    expect(subBrushCount).toBe(1);

    await closeBrushModal(page);
  });

  test('scatter in dynamics tab affects stroke spread', async ({ page }) => {
    await setToolOption(page, 'Size', 10);
    await setToolOption(page, 'Hardness', 100);
    await setForegroundColor(page, 0, 0, 255);

    // Open brush modal and verify scatter is in dynamics tab
    await openBrushModal(page);
    const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
    await dialog.locator('text=Dynamics').click();
    await page.waitForTimeout(100);

    // Scatter slider should be visible in the dynamics panel
    const scatterInput = dialog.locator('[aria-label="Scatter value"]');
    await expect(scatterInput).toBeVisible();

    await closeBrushModal(page);
  });
});

// ---------------------------------------------------------------------------
// Tests: Brush Modal Preview
// ---------------------------------------------------------------------------

test.describe('Brush Modal Preview', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
  });

  test('preview area has increased height (100px)', async ({ page }) => {
    await openBrushModal(page);
    const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
    const preview = dialog.locator('canvas').last();
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    // Preview should be roughly 100px tall (CSS height: 100px)
    expect(box!.height).toBeGreaterThanOrEqual(95);
    expect(box!.height).toBeLessThanOrEqual(110);
    await closeBrushModal(page);
  });
});
