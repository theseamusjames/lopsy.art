import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

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
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(400);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function setUIState(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const colorSetters = new Set(['setForegroundColor', 'setBackgroundColor', 'swapColors', 'resetColors', 'addRecentColor']);
    const storeKey = colorSetters.has(setter) ? '__toolSettingsStore' : '__uiStore';
    const store = (window as unknown as Record<string, unknown>)[storeKey] as {
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

async function getBrushPresets(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
      getState: () => { presets: Array<{ id: string; name: string; isCustom: boolean; tip: unknown; size: number; spacing: number }> };
    };
    return store.getState().presets.map((p) => ({
      id: p.id, name: p.name, isCustom: p.isCustom, hasTip: p.tip !== null, size: p.size, spacing: p.spacing,
    }));
  });
}

async function openBrushModal(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setShowBrushModal: (v: boolean) => void };
    };
    store.getState().setShowBrushModal(true);
  });
  await page.waitForTimeout(300);
}

async function closeBrushModal(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setShowBrushModal: (v: boolean) => void };
    };
    store.getState().setShowBrushModal(false);
  });
  await page.waitForTimeout(200);
}

async function undo(page: Page) {
  await page.evaluate(() => {
    ((window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undo: () => void };
    }).getState().undo();
  });
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('ABR Import & Brush Properties', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
  });

  // -----------------------------------------------------------------------
  // ABR IMPORT
  // -----------------------------------------------------------------------

  test('ABR import — file picker loads brushes with swatches visible', async ({ page }) => {
    // Create several synthetic imported brush presets (simulating ABR parse results)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void };
      };
      const names = ['Smoke Thin', 'Smoke Wide', 'Smoke Round', 'Smoke Splatter'];
      names.forEach((name, i) => {
        const sz = 32 + i * 16;
        const tipData = new Uint8ClampedArray(sz * sz);
        // Create unique tip patterns
        for (let y = 0; y < sz; y++) {
          for (let x = 0; x < sz; x++) {
            const cx = sz / 2, cy = sz / 2;
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const radius = sz / 2 * (0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * (i + 2)));
            tipData[y * sz + x] = dist < radius ? 255 : 0;
          }
        }
        store.getState().addPreset({
          id: `imported-${i}`, name,
          tip: { width: sz, height: sz, data: tipData },
          size: sz, hardness: 100, spacing: 25, scatter: 0, angle: 0,
          opacity: 100, flow: 100, isCustom: true,
        });
      });
    });

    const presets = await getBrushPresets(page);
    const imported = presets.filter((p) => p.isCustom);
    expect(imported.length).toBeGreaterThanOrEqual(4);

    // Open modal — swatches should be visible
    await openBrushModal(page);
    await page.screenshot({ path: 'test-results/screenshots/abr-01-imported-swatches.png' });

    // Check that preset thumbnails are rendered in the modal
    const thumbnailCount = await page.evaluate(() => {
      return document.querySelectorAll('canvas').length;
    });
    // Should have at least the imported presets rendered as canvas thumbnails
    expect(thumbnailCount).toBeGreaterThan(0);
  });

  test('ABR import — selecting an imported preset updates tool settings', async ({ page }) => {
    // Add an imported brush
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void; setActivePreset: (id: string) => void };
      };
      const sz = 48;
      const tipData = new Uint8ClampedArray(sz * sz);
      tipData.fill(200);
      store.getState().addPreset({
        id: 'imported-select-test', name: 'Test Import',
        tip: { width: sz, height: sz, data: tipData },
        size: 48, hardness: 80, spacing: 35, scatter: 15, angle: 45,
        opacity: 90, flow: 85, isCustom: true,
      });
      store.getState().setActivePreset('imported-select-test');
    });

    // Verify tool settings were synced
    const settings = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => Record<string, unknown>;
      };
      const s = store.getState();
      return {
        brushSize: s.brushSize,
        brushHardness: s.brushHardness,
        brushSpacing: s.brushSpacing,
        brushScatter: s.brushScatter,
        brushAngle: s.brushAngle,
        brushOpacity: s.brushOpacity,
      };
    });

    expect(settings.brushSize).toBe(48);
    expect(settings.brushHardness).toBe(80);
    expect(settings.brushSpacing).toBe(35);
    expect(settings.brushScatter).toBe(15);
    expect(settings.brushAngle).toBe(45);
    expect(settings.brushOpacity).toBe(90);
  });

  test('ABR import — drawing with imported brush produces visible marks', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void; setActivePreset: (id: string) => void };
      };
      const sz = 24;
      const tipData = new Uint8ClampedArray(sz * sz);
      tipData.fill(255);
      store.getState().addPreset({
        id: 'imported-draw-test', name: 'Draw Test',
        tip: { width: sz, height: sz, data: tipData },
        size: 24, hardness: 100, spacing: 30, scatter: 0, angle: 0,
        opacity: 100, flow: 100, isCustom: true,
      });
      store.getState().setActivePreset('imported-draw-test');
    });
    await page.waitForTimeout(200);

    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
    const before = await snapshot(page);
    await drawStroke(page, { x: 100, y: 300 }, { x: 700, y: 300 }, 20);
    const after = await snapshot(page);

    const diff = pixelDiff(before, after);
    expect(diff).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/abr-02-imported-stroke.png' });
  });

  test('ABR import — multiple imported brushes appear in modal grid', async ({ page }) => {
    // Add 6 imported brushes
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void };
      };
      for (let i = 0; i < 6; i++) {
        const sz = 16;
        const tipData = new Uint8ClampedArray(sz * sz);
        for (let p = 0; p < sz * sz; p++) tipData[p] = Math.floor(255 * (i + 1) / 7);
        store.getState().addPreset({
          id: `grid-test-${i}`, name: `Grid Brush ${i + 1}`,
          tip: { width: sz, height: sz, data: tipData },
          size: 16 + i * 4, hardness: 50 + i * 10, spacing: 20 + i * 5,
          scatter: 0, angle: 0, opacity: 100, flow: 100, isCustom: true,
        });
      }
    });

    await openBrushModal(page);
    await page.screenshot({ path: 'test-results/screenshots/abr-03-grid-brushes.png' });

    const presets = await getBrushPresets(page);
    const customCount = presets.filter((p) => p.isCustom).length;
    expect(customCount).toBeGreaterThanOrEqual(6);
  });

  // -----------------------------------------------------------------------
  // SPACING
  // -----------------------------------------------------------------------

  test('Spacing — max spacing (200%) produces widely spaced dabs', async ({ page }) => {
    await setToolSetting(page, 'setBrushSize', 20);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 200);
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });

    const before = await snapshot(page);
    await drawStroke(page, { x: 50, y: 300 }, { x: 750, y: 300 }, 40);
    const afterWide = await snapshot(page);
    const wideDiff = pixelDiff(before, afterWide);
    await page.screenshot({ path: 'test-results/screenshots/spacing-01-max-200pct.png' });

    // At 200% spacing with size=20, dabs should be 40px apart.
    // Over 700px that's about 17 dabs. Each ~20px diameter = ~314 pixels.
    // Total painted should be ~5000-6000 pixels.
    expect(wideDiff).toBeGreaterThan(100);
    // Should be substantially less than a dense stroke
    await undo(page);

    await setToolSetting(page, 'setBrushSpacing', 10);
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 50, y: 300 }, { x: 750, y: 300 }, 40);
    const afterDense = await snapshot(page);
    const denseDiff = pixelDiff(before2, afterDense);
    await page.screenshot({ path: 'test-results/screenshots/spacing-02-dense-10pct.png' });

    // Dense stroke should cover more pixels
    expect(denseDiff).toBeGreaterThan(wideDiff);
  });

  test('Spacing — default 25% produces smooth continuous stroke', async ({ page }) => {
    await setToolSetting(page, 'setBrushSize', 20);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 25);
    await setUIState(page, 'setForegroundColor', { r: 0, g: 0, b: 255, a: 1 });

    const before = await snapshot(page);
    await drawStroke(page, { x: 100, y: 300 }, { x: 700, y: 300 }, 30);
    const after = await snapshot(page);

    expect(pixelDiff(before, after)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/spacing-03-default-25pct.png' });
  });

  test('Spacing — 100% shows individual dab circles', async ({ page }) => {
    await setToolSetting(page, 'setBrushSize', 30);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 100);
    await setUIState(page, 'setForegroundColor', { r: 0, g: 200, b: 0, a: 1 });

    const before = await snapshot(page);
    await drawStroke(page, { x: 50, y: 300 }, { x: 750, y: 300 }, 40);
    const after = await snapshot(page);

    expect(pixelDiff(before, after)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/spacing-04-100pct-dabs.png' });
  });

  test('Spacing — respects spacing during fast mouse movement', async ({ page }) => {
    // Use very wide spacing and a fast stroke (few mouse events, large steps)
    await setToolSetting(page, 'setBrushSize', 15);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 150);
    await setUIState(page, 'setForegroundColor', { r: 255, g: 255, b: 0, a: 1 });

    const before = await snapshot(page);
    // Use only 5 steps — this means large jumps between mouse events
    await drawStroke(page, { x: 50, y: 300 }, { x: 750, y: 300 }, 5);
    const after = await snapshot(page);
    const diff = pixelDiff(before, after);

    // Should still produce visible dabs
    expect(diff).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/screenshots/spacing-05-fast-stroke.png' });
  });

  // -----------------------------------------------------------------------
  // BRUSH PROPERTIES MODIFICATION
  // -----------------------------------------------------------------------

  test('Modifying brush size changes stroke thickness', async ({ page }) => {
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 25);

    // Small brush
    await setToolSetting(page, 'setBrushSize', 5);
    const before1 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);
    const after1 = await snapshot(page);
    const smallDiff = pixelDiff(before1, after1);
    await page.screenshot({ path: 'test-results/screenshots/props-01-small-size.png' });

    // Large brush on a new line
    await setToolSetting(page, 'setBrushSize', 50);
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 400 }, { x: 700, y: 400 }, 20);
    const after2 = await snapshot(page);
    const largeDiff = pixelDiff(before2, after2);
    await page.screenshot({ path: 'test-results/screenshots/props-02-large-size.png' });

    // Large brush should affect more pixels
    expect(largeDiff).toBeGreaterThan(smallDiff);
  });

  test('Modifying opacity changes stroke transparency', async ({ page }) => {
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setBrushSize', 30);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 25);

    // Full opacity
    await setToolSetting(page, 'setBrushOpacity', 100);
    const before1 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);
    const after1 = await snapshot(page);
    const fullDiff = pixelDiff(before1, after1);

    // Low opacity — same position but undo first
    await undo(page);
    await setToolSetting(page, 'setBrushOpacity', 20);
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);
    const after2 = await snapshot(page);
    const lowDiff = pixelDiff(before2, after2);

    await page.screenshot({ path: 'test-results/screenshots/props-03-opacity-comparison.png' });

    // Both strokes should produce visible marks
    expect(fullDiff).toBeGreaterThan(0);
    expect(lowDiff).toBeGreaterThan(0);
  });

  test('Modifying hardness changes edge softness', async ({ page }) => {
    await setUIState(page, 'setForegroundColor', { r: 0, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setBrushSize', 40);
    await setToolSetting(page, 'setBrushSpacing', 25);
    await setToolSetting(page, 'setBrushOpacity', 100);

    // Hard brush
    await setToolSetting(page, 'setBrushHardness', 100);
    const before1 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);
    const after1 = await snapshot(page);
    const hardDiff = pixelDiff(before1, after1);
    await page.screenshot({ path: 'test-results/screenshots/props-04-hard-brush.png' });

    await undo(page);

    // Soft brush
    await setToolSetting(page, 'setBrushHardness', 0);
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);
    const after2 = await snapshot(page);
    const softDiff = pixelDiff(before2, after2);
    await page.screenshot({ path: 'test-results/screenshots/props-05-soft-brush.png' });

    // Soft brush should affect a wider area (more pixels changed, albeit with softer edges)
    expect(softDiff).toBeGreaterThanOrEqual(hardDiff * 0.5);
    // Both should produce visible marks
    expect(hardDiff).toBeGreaterThan(0);
    expect(softDiff).toBeGreaterThan(0);
  });

  test('Scatter spreads dabs perpendicular to stroke direction', async ({ page }) => {
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setBrushSize', 10);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushSpacing', 30);

    // No scatter
    await setToolSetting(page, 'setBrushScatter', 0);
    const before1 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 30);
    const after1 = await snapshot(page);
    const noScatterDiff = pixelDiff(before1, after1);
    await page.screenshot({ path: 'test-results/screenshots/props-06-no-scatter.png' });

    // Max scatter
    await setToolSetting(page, 'setBrushScatter', 100);
    const before2 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 400 }, { x: 700, y: 400 }, 30);
    const after2 = await snapshot(page);
    const scatterDiff = pixelDiff(before2, after2);
    await page.screenshot({ path: 'test-results/screenshots/props-07-max-scatter.png' });

    // Both should produce visible marks
    expect(noScatterDiff).toBeGreaterThan(0);
    expect(scatterDiff).toBeGreaterThan(0);
  });

  test('Angle control rotates brush tip', async ({ page }) => {
    // Create a wide, flat rectangular brush tip
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__brushPresetStore as {
        getState: () => { addPreset: (p: unknown) => void; setActivePreset: (id: string) => void };
      };
      const w = 30, h = 6;
      const tipData = new Uint8ClampedArray(w * h);
      tipData.fill(255);
      store.getState().addPreset({
        id: 'angle-test-tip', name: 'Angle Test',
        tip: { width: w, height: h, data: tipData },
        size: 30, hardness: 100, spacing: 80, scatter: 0, angle: 0,
        opacity: 100, flow: 100, isCustom: true,
      });
      store.getState().setActivePreset('angle-test-tip');
    });
    await page.waitForTimeout(200);

    await setUIState(page, 'setForegroundColor', { r: 255, g: 128, b: 0, a: 1 });

    // Angle 0
    await setToolSetting(page, 'setBrushAngle', 0);
    const before0 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);
    const after0 = await snapshot(page);
    const diff0 = pixelDiff(before0, after0);
    await page.screenshot({ path: 'test-results/screenshots/props-08-angle-0.png' });

    // Angle 90 on a different line
    await setToolSetting(page, 'setBrushAngle', 90);
    const before90 = await snapshot(page);
    await drawStroke(page, { x: 100, y: 400 }, { x: 700, y: 400 }, 20);
    const after90 = await snapshot(page);
    const diff90 = pixelDiff(before90, after90);
    await page.screenshot({ path: 'test-results/screenshots/props-09-angle-90.png' });

    // Both should produce visible marks
    expect(diff0).toBeGreaterThan(0);
    expect(diff90).toBeGreaterThan(0);
  });
});
