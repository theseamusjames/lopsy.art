import { test, expect } from './fixtures';
import { waitForStore, createDocument, selectTool, setToolOption, drawRect } from './helpers';

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function docToScreen(page: Parameters<typeof waitForStore>[0], docX: number, docY: number) {
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

async function drawStroke(
  page: Parameters<typeof waitForStore>[0],
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 15,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function readCompositedPixels(page: Parameters<typeof waitForStore>[0]): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

async function readActiveLayerPixels(page: Parameters<typeof waitForStore>[0]): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readLayerPixels!() as Promise<PixelSnapshot | null>;
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
    if (dr + dg + db > 20) count++;
  }
  return count;
}

async function getActiveTool(page: Parameters<typeof waitForStore>[0]): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

/**
 * Compute the mean saturation of pixels in the composited output.
 * Uses the bottom-up pixel buffer convention (__readCompositedPixels is bottom-up).
 * Only samples opaque pixels (alpha > 128).
 */
function meanSaturationInRegion(
  snapshot: PixelSnapshot,
  docX: number,
  docY: number,
  regionW: number,
  regionH: number,
): number {
  // __readCompositedPixels returns a bottom-up buffer.
  // Row 0 in the buffer is the BOTTOM row of the image.
  const { width, height, pixels } = snapshot;
  let total = 0;
  let count = 0;
  for (let dy = 0; dy < regionH; dy++) {
    for (let dx = 0; dx < regionW; dx++) {
      const px = docX + dx;
      const py = docY + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      // Flip Y for the bottom-up buffer
      const bufY = height - 1 - py;
      const idx = (bufY * width + px) * 4;
      const r = pixels[idx] ?? 0;
      const g = pixels[idx + 1] ?? 0;
      const b = pixels[idx + 2] ?? 0;
      const a = pixels[idx + 3] ?? 0;
      if (a < 128) continue;
      // Compute saturation from RGB
      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      if (max === min) continue; // grayscale pixel — skip (already no sat)
      const l = (max + min) / 2;
      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      total += s;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

test.describe('Sponge Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('sponge tool appears in toolbox and activates via keyboard shortcut Y', async ({ page }) => {
    const spongeButton = page.locator('[data-tool-id="sponge"]');
    await expect(spongeButton).toBeVisible();

    await page.keyboard.press('y');
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('sponge');

    await page.screenshot({ path: 'e2e/screenshots/sponge-01-toolbox.png' });
  });

  test('options bar shows Mode, Strength, and Size controls', async ({ page }) => {
    await page.keyboard.press('y');
    await page.waitForTimeout(100);

    // Mode select is present
    const modeSelect = page.locator('select').filter({ hasText: 'Saturate' });
    await expect(modeSelect).toBeVisible();

    // Strength and Size sliders are present in the options bar
    const strengthLabel = page.locator('role=toolbar').getByText('Strength');
    await expect(strengthLabel).toBeVisible();

    const sizeLabel = page.locator('role=toolbar').getByText('Size');
    await expect(sizeLabel).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/sponge-02-options-bar.png' });
  });

  test('desaturate mode reduces saturation where painted on a colored shape', async ({ page }) => {
    test.setTimeout(120_000);

    // Draw a vivid red rectangle covering the center area of the canvas.
    // Red has maximum saturation — any desaturation will be measurable.
    await drawRect(page, 50, 50, 300, 200, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(300);

    // Flush GPU stroke so pixels are available
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    const beforeLayer = await readActiveLayerPixels(page);
    const beforeComposite = await readCompositedPixels(page);
    await page.screenshot({ path: 'e2e/screenshots/sponge-03-before-desaturate.png' });

    // Activate sponge, switch to desaturate mode, set high strength
    await page.keyboard.press('y');
    await page.waitForTimeout(100);

    // Set mode to Desaturate
    const modeSelect = page.locator('select').filter({ hasText: 'Saturate' });
    await modeSelect.selectOption('desaturate');
    await page.waitForTimeout(100);

    await setToolOption(page, 'Strength', 80);
    await setToolOption(page, 'Size', 60);

    // Paint strokes across the red area
    for (let y = 80; y <= 220; y += 50) {
      await drawStroke(page, { x: 80, y }, { x: 300, y }, 12);
    }

    // Flush any pending work
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    const afterLayer = await readActiveLayerPixels(page);
    const afterComposite = await readCompositedPixels(page);
    await page.screenshot({ path: 'e2e/screenshots/sponge-04-after-desaturate.png' });

    // Verify pixels changed — desaturation should modify many pixels
    const changed = pixelDiff(beforeComposite, afterComposite);
    expect(changed).toBeGreaterThan(500);

    // Verify saturation decreased in the painted region using layer pixels
    // Layer pixels use document coordinates directly
    const satBefore = meanSaturationInRegion(beforeLayer, 80, 80, 200, 120);
    const satAfter = meanSaturationInRegion(afterLayer, 80, 80, 200, 120);

    // Desaturation should reduce mean saturation measurably
    expect(satAfter).toBeLessThan(satBefore - 0.05);
  });

  test('saturate mode increases saturation where painted on a muted shape', async ({ page }) => {
    test.setTimeout(120_000);

    // Draw a low-saturation olive/gray-ish color (R=128, G=100, B=80)
    await drawRect(page, 50, 50, 300, 200, { r: 128, g: 100, b: 80 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    const beforeLayer = await readActiveLayerPixels(page);
    await page.screenshot({ path: 'e2e/screenshots/sponge-05-before-saturate.png' });

    // Activate sponge, switch to saturate mode
    await page.keyboard.press('y');
    await page.waitForTimeout(100);

    const modeSelect = page.locator('select').filter({ hasText: 'Saturate' });
    await modeSelect.selectOption('saturate');
    await page.waitForTimeout(100);

    await setToolOption(page, 'Strength', 80);
    await setToolOption(page, 'Size', 60);

    // Paint across the muted area
    for (let y = 80; y <= 220; y += 50) {
      await drawStroke(page, { x: 80, y }, { x: 300, y }, 12);
    }

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    const afterLayer = await readActiveLayerPixels(page);
    await page.screenshot({ path: 'e2e/screenshots/sponge-06-after-saturate.png' });

    const satBefore = meanSaturationInRegion(beforeLayer, 80, 80, 200, 120);
    const satAfter = meanSaturationInRegion(afterLayer, 80, 80, 200, 120);

    // Saturation should have increased
    expect(satAfter).toBeGreaterThan(satBefore + 0.02);
  });

  test('undo restores pixels after sponge stroke', async ({ page }) => {
    test.setTimeout(120_000);

    await drawRect(page, 50, 50, 300, 200, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    const before = await readCompositedPixels(page);

    await page.keyboard.press('y');
    await page.waitForTimeout(100);

    const modeSelect = page.locator('select').filter({ hasText: 'Saturate' });
    await modeSelect.selectOption('desaturate');
    await page.waitForTimeout(100);

    await setToolOption(page, 'Strength', 80);
    await setToolOption(page, 'Size', 60);

    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 10);
    await page.waitForTimeout(200);

    const afterStroke = await readCompositedPixels(page);
    expect(pixelDiff(before, afterStroke)).toBeGreaterThan(100);

    // Undo the sponge stroke (handleSpongeDown pushed history internally)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const afterUndo = await readCompositedPixels(page);
    await page.screenshot({ path: 'e2e/screenshots/sponge-07-undo.png' });

    // After undo, the diff from the baseline should be small
    const diffFromBaseline = pixelDiff(before, afterUndo);
    expect(diffFromBaseline).toBeLessThan(100);
  });
});
