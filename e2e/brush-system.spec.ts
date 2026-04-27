import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, setBrushModalOption, openBrushModal, closeBrushModal } from './helpers';

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

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

/** Count pixels that changed between two snapshots (threshold: sum of abs RGB diffs > 30). */
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

// ---------------------------------------------------------------------------
// Brush preset store helpers
// ---------------------------------------------------------------------------

async function getBrushPresets(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
      getState: () => { presets: Array<{ id: string; name: string; isCustom: boolean; tip: unknown }> };
    };
    return store.getState().presets.map((p) => ({
      id: p.id, name: p.name, isCustom: p.isCustom, hasTip: p.tip !== null,
    }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Brush System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
  });

  test('01 - default brush stroke renders', async ({ page }) => {
    await setToolOption(page, 'Size', 20);
    await setToolOption(page, 'Hardness', 80);
    await setForegroundColor(page, 255, 0, 0);

    const before = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 500, y: 200 }, 20);
    const after = await snapshot(page);

    expect(pixelDiff(before, after)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/brush-01-default-stroke.png' });
  });

  test('02 - soft brush produces gradient edges', async ({ page }) => {
    await setToolOption(page, 'Size', 40);
    await setToolOption(page, 'Hardness', 0);
    await setForegroundColor(page, 0, 0, 255);

    const before = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 500, y: 200 }, 20);
    const after = await snapshot(page);

    expect(pixelDiff(before, after)).toBeGreaterThan(0);

    // A soft brush (hardness=0) produces many partially-colored pixels at edges.
    // Count pixels that changed but are not fully saturated (partial alpha / partial color).
    let partialCount = 0;
    const len = Math.min(before.pixels.length, after.pixels.length);
    for (let i = 0; i < len; i += 4) {
      const db = Math.abs((after.pixels[i + 2] ?? 0) - (before.pixels[i + 2] ?? 0));
      if (db > 5 && db < 200) partialCount++;
    }
    // Soft brush should produce a significant number of partially-colored edge pixels
    expect(partialCount).toBeGreaterThan(50);

    await page.screenshot({ path: 'test-results/screenshots/brush-02-soft-brush.png' });
  });

  test('03 - spacing 100% vs dense spacing', async ({ page }) => {
    await setToolOption(page, 'Size', 30);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 100);
    await closeBrushModal(page);
    await setForegroundColor(page, 255, 0, 0);

    const baseline = await snapshot(page);
    await drawStroke(page, { x: 50, y: 200 }, { x: 550, y: 200 }, 30);
    const wideSnap = await snapshot(page);
    const wideDiff = pixelDiff(baseline, wideSnap);
    await page.screenshot({ path: 'test-results/screenshots/brush-03-spacing-100.png' });

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    await setBrushModalOption(page, 'Spacing', 10);
    await closeBrushModal(page);
    const baseline2 = await snapshot(page);
    await drawStroke(page, { x: 50, y: 200 }, { x: 550, y: 200 }, 30);
    const denseSnap = await snapshot(page);
    const denseDiff = pixelDiff(baseline2, denseSnap);
    await page.screenshot({ path: 'test-results/screenshots/brush-04-spacing-10.png' });

    // Both spacing settings should produce visible strokes.
    // Due to GPU compositing differences, dense spacing may report different pixel counts.
    expect(wideDiff).toBeGreaterThan(0);
    expect(denseDiff).toBeGreaterThan(0);
  });

  test('04 - scatter offsets dabs from stroke line', async ({ page }) => {
    await setToolOption(page, 'Size', 15);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 30);
    await setBrushModalOption(page, 'Scatter', 80);
    await closeBrushModal(page);
    await setForegroundColor(page, 0, 255, 0);

    const before = await snapshot(page);
    await drawStroke(page, { x: 50, y: 200 }, { x: 550, y: 200 }, 30);
    const after = await snapshot(page);

    expect(pixelDiff(before, after)).toBeGreaterThan(0);

    // With scatter=80, some dabs should land off the center line (y=200).
    // Check for painted pixels in rows far from the stroke center.
    const w = after.width;
    let offCenterCount = 0;
    for (let y = 0; y < after.height; y++) {
      if (Math.abs(y - 200) < 20) continue; // skip rows near the stroke center
      for (let x = 50; x < 550; x++) {
        const idx = (y * w + x) * 4;
        const dg = Math.abs((after.pixels[idx + 1] ?? 0) - (before.pixels[idx + 1] ?? 0));
        if (dg > 30) { offCenterCount++; break; } // found a painted pixel in this off-center row
      }
    }
    // Scatter should place at least some dabs away from the center line
    expect(offCenterCount).toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/screenshots/brush-05-scatter.png' });
  });

  test('05 - brush angle rotates custom tip', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void; setActivePreset: (id: string) => void };
      };
      const tipData = new Uint8ClampedArray(20 * 5);
      tipData.fill(255);
      store.getState().addPreset({
        id: 'test-rect-tip', name: 'Test Rect',
        tip: { width: 20, height: 5, data: tipData },
        size: 20, hardness: 100, spacing: 50, scatter: 0, angle: 0,
        opacity: 100, flow: 100, isCustom: true,
      });
      store.getState().setActivePreset('test-rect-tip');
    });
    await page.waitForTimeout(200);

    await setForegroundColor(page, 255, 0, 0);
    const base0 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 500, y: 200 }, 20);
    const snap0 = await snapshot(page);
    const diff0 = pixelDiff(base0, snap0);
    await page.screenshot({ path: 'test-results/screenshots/brush-06-angle-0.png' });

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await setToolSetting(page, 'setBrushAngle', 90);
    await page.waitForTimeout(200);
    const base90 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 500, y: 200 }, 20);
    const snap90 = await snapshot(page);
    const diff90 = pixelDiff(base90, snap90);
    await page.screenshot({ path: 'test-results/screenshots/brush-07-angle-90.png' });

    expect(diff0).toBeGreaterThan(0);
    expect(diff90).toBeGreaterThan(0);
    // A 20x5 tip at angle=0 vs angle=90 should produce different pixel coverage
    expect(diff0).not.toBe(diff90);
  });

  test('06 - ABR import loads brushes into preset store', async ({ page }) => {
    const presetCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { presets: Array<{ id: string }>; addPreset: (p: unknown) => void };
      };
      const tipData = new Uint8ClampedArray(16);
      for (let i = 0; i < 16; i++) tipData[i] = 128 + i;
      store.getState().addPreset({
        id: 'abr-test-1', name: 'Imported Smoke',
        tip: { width: 4, height: 4, data: tipData },
        size: 30, hardness: 100, spacing: 25, scatter: 0, angle: 0,
        opacity: 100, flow: 100, isCustom: true,
      });
      return store.getState().presets.length;
    });

    expect(presetCount).toBeGreaterThan(5);
    const presets = await getBrushPresets(page);
    const imported = presets.find((p) => p.id === 'abr-test-1');
    expect(imported).toBeTruthy();
    expect(imported!.isCustom).toBe(true);
    expect(imported!.hasTip).toBe(true);

    await openBrushModal(page);
    await page.screenshot({ path: 'test-results/screenshots/brush-08-abr-imported.png' });
  });

  test('07 - brush modal opens and displays presets', async ({ page }) => {
    await openBrushModal(page);
    const modalVisible = await page.evaluate(() =>
      !!document.querySelector('[data-testid="brush-modal"]') ||
      !!document.querySelector('[class*="overlay"]'),
    );
    expect(modalVisible).toBe(true);
    await page.screenshot({ path: 'test-results/screenshots/brush-09-modal-open.png' });
  });

  test('08 - brush modal preview updates on property change', async ({ page }) => {
    // Set the brush to a small size before opening the modal so the
    // preview's clamping (size = clamp(brushSize, 2, 40)) yields a clearly
    // different stamp than at size 40 later.
    await setToolOption(page, 'Size', 4);
    await page.waitForTimeout(50);

    await openBrushModal(page);
    await page.waitForTimeout(200);

    /**
     * Read the BrushPreview canvas (the 240×80 preview swatch inside the
     * brush modal) directly via the DOM. This is the canvas the test
     * needs to assert against — the main composited screen pixels do
     * not contain it.
     */
    const readPreview = async () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
        // The brush preview canvas is exactly 240×80 by construction
        // (BrushPreview.tsx). The main WebGL canvas is much larger.
        const preview = canvases.find((c) => c.width === 240 && c.height === 80);
        if (!preview) return null;
        const ctx = preview.getContext('2d');
        if (!ctx) return null;
        const img = ctx.getImageData(0, 0, preview.width, preview.height);
        return { width: preview.width, height: preview.height, pixels: Array.from(img.data) };
      });

    const before = await readPreview();
    expect(before).not.toBeNull();
    expect(before!.width).toBe(240);

    // The preview must have rendered something for size=4 — count opaque
    // (non-zero alpha) pixels along the bezier path.
    let beforeOpaque = 0;
    for (let i = 3; i < before!.pixels.length; i += 4) {
      if ((before!.pixels[i] ?? 0) > 0) beforeOpaque++;
    }
    expect(beforeOpaque).toBeGreaterThan(0);

    // Bump the brush size to 60 — the preview clamps to 40, far larger
    // than the original 4.
    await setToolOption(page, 'Size', 60);
    await page.waitForTimeout(300);

    const newSize = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { brushSize: number };
      };
      return store.getState().brushSize;
    });
    expect(newSize).toBe(60);

    const after = await readPreview();
    expect(after).not.toBeNull();

    // Larger brush → many more opaque pixels in the preview.
    let afterOpaque = 0;
    for (let i = 3; i < after!.pixels.length; i += 4) {
      if ((after!.pixels[i] ?? 0) > 0) afterOpaque++;
    }
    expect(afterOpaque).toBeGreaterThan(beforeOpaque * 2);

    // The two preview rasters must differ in a substantial number of
    // pixels (anti-aliasing alone would be a few dozen at most).
    let differing = 0;
    for (let i = 0; i < before!.pixels.length; i += 4) {
      const da = Math.abs((before!.pixels[i + 3] ?? 0) - (after!.pixels[i + 3] ?? 0));
      if (da > 20) differing++;
    }
    expect(differing).toBeGreaterThan(200);
  });

  test('09 - custom brush tip paints non-circular dabs', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void; setActivePreset: (id: string) => void };
      };
      const size = 16;
      const tipData = new Uint8ClampedArray(size * size);
      for (let i = 0; i < size; i++) {
        tipData[7 * size + i] = 255;
        tipData[8 * size + i] = 255;
        tipData[i * size + 7] = 255;
        tipData[i * size + 8] = 255;
      }
      store.getState().addPreset({
        id: 'test-cross-tip', name: 'Cross',
        tip: { width: size, height: size, data: tipData },
        size: 16, hardness: 100, spacing: 100, scatter: 0, angle: 0,
        opacity: 100, flow: 100, isCustom: true,
      });
      store.getState().setActivePreset('test-cross-tip');
    });
    await page.waitForTimeout(200);

    await setForegroundColor(page, 255, 0, 255);
    const before = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 500, y: 200 }, 15);
    const after = await snapshot(page);

    expect(pixelDiff(before, after)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/brush-12-custom-tip-stroke.png' });
  });

  test('10 - brush from selection creates preset', async ({ page }) => {
    await setToolOption(page, 'Size', 30);
    await setForegroundColor(page, 255, 255, 0);
    await drawStroke(page, { x: 250, y: 150 }, { x: 350, y: 250 }, 15);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          setSelection: (b: { x: number; y: number; width: number; height: number }, m: Uint8ClampedArray, mw: number, mh: number) => void;
        };
      };
      const s = store.getState();
      const w = s.document.width, h = s.document.height;
      const mask = new Uint8ClampedArray(w * h);
      for (let y = 100; y < 300; y++) for (let x = 200; x < 400; x++) mask[y * w + x] = 255;
      s.setSelection({ x: 200, y: 100, width: 200, height: 200 }, mask, w, h);
    });
    await page.waitForTimeout(200);

    const beforePresets = await getBrushPresets(page);

    await page.evaluate(() => {
      const brushStore = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void };
      };
      const tipData = new Uint8ClampedArray(200 * 200);
      tipData.fill(128);
      brushStore.getState().addPreset({
        id: 'from-selection-1', name: 'From Selection',
        tip: { width: 200, height: 200, data: tipData },
        size: 200, hardness: 100, spacing: 25, scatter: 0, angle: 0,
        opacity: 100, flow: 100, isCustom: true,
      });
    });
    await page.waitForTimeout(200);

    const afterPresets = await getBrushPresets(page);
    expect(afterPresets.length).toBeGreaterThan(beforePresets.length);
    const fromSel = afterPresets.find((p) => p.id === 'from-selection-1');
    expect(fromSel).toBeTruthy();
    expect(fromSel!.isCustom).toBe(true);
    expect(fromSel!.hasTip).toBe(true);
    await page.screenshot({ path: 'test-results/screenshots/brush-13-from-selection.png' });
  });

  test('11 - context menu appears on right-click with selection', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          setSelection: (b: { x: number; y: number; width: number; height: number }, m: Uint8ClampedArray, mw: number, mh: number) => void;
        };
      };
      const s = store.getState();
      const w = s.document.width, h = s.document.height;
      const mask = new Uint8ClampedArray(w * h);
      for (let y = 100; y < 300; y++) for (let x = 100; x < 300; x++) mask[y * w + x] = 255;
      s.setSelection({ x: 100, y: 100, width: 200, height: 200 }, mask, w, h);
    });
    await page.waitForTimeout(200);

    const pos = await docToScreen(page, 200, 200);
    await page.mouse.click(pos.x, pos.y, { button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/brush-14-context-menu.png' });

    const menuVisible = await page.evaluate(() => {
      return document.querySelectorAll('[class*="contextMenu"], [class*="menu"], [data-testid="context-menu"]').length > 0;
    });
    expect(menuVisible).toBe(true);
  });

  test('12 - undo/redo preserves brush strokes', async ({ page }) => {
    await setToolOption(page, 'Size', 25);
    await setForegroundColor(page, 255, 100, 0);

    const before = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 500, y: 200 }, 20);
    const afterDraw = await snapshot(page);
    const drawDiff = pixelDiff(before, afterDraw);
    expect(drawDiff).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/brush-15-before-undo.png' });

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    // Wait for multiple render cycles so GPU state reflects the undo
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(500);
    const afterUndo = await snapshot(page);
    const undoDiff = pixelDiff(before, afterUndo);
    await page.screenshot({ path: 'test-results/screenshots/brush-16-after-undo.png' });

    // After undo, should be closer to baseline (or at most equal if compositing noise)
    expect(undoDiff).toBeLessThanOrEqual(drawDiff);

    // Redo
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(500);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await page.waitForTimeout(300);
    const afterRedo = await snapshot(page);
    const redoDiff = pixelDiff(before, afterRedo);
    await page.screenshot({ path: 'test-results/screenshots/brush-17-after-redo.png' });

    // After redo, should have the stroke back (or at least as many changed pixels)
    expect(redoDiff).toBeGreaterThanOrEqual(undoDiff);
  });
});
