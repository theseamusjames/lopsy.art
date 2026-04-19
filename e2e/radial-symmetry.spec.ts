import { test, expect } from './fixtures';
import { waitForStore, createDocument, getPixelAt } from './helpers';

test.describe('Radial/Mandala Symmetry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, true);
    await page.waitForTimeout(300);
  });

  async function docToScreen(page: import('@playwright/test').Page, docX: number, docY: number) {
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

  test('8-fold radial symmetry creates rotated copies of brush strokes', async ({ page }) => {
    // Take a before screenshot (blank canvas)
    await page.screenshot({ path: 'e2e/screenshots/radial-symmetry-before.png' });

    // Enable 8-fold radial symmetry
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryRadialSegments: (v: number) => void;
          setBrushSize: (v: number) => void;
          setBrushOpacity: (v: number) => void;
          setBrushHardness: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setSymmetryRadialSegments(8);
      state.setBrushSize(10);
      state.setBrushOpacity(100);
      state.setBrushHardness(100);
    });

    // Select brush tool
    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    // Draw a stroke from center-right outward: (110, 100) → (160, 100)
    const start = await docToScreen(page, 110, 100);
    const end = await docToScreen(page, 160, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Finalize the pending stroke so __readLayerPixels can see it
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: (label?: string) => void };
      };
      store.getState().pushHistory('Finalize stroke');
    });
    await page.waitForTimeout(200);

    // Take the after screenshot
    await page.screenshot({ path: 'e2e/screenshots/radial-symmetry-after.png' });

    // Probe pixel at the original stroke position (right of center)
    const originalStroke = await getPixelAt(page, 140, 100);
    expect(originalStroke.a).toBeGreaterThan(0);

    // Probe at 90° rotation of (140, 100) around center (100, 100):
    // dx=40, dy=0 rotated 90° → (0, 40) → doc (100, 140)
    const rot90 = await getPixelAt(page, 100, 140);
    expect(rot90.a).toBeGreaterThan(0);

    // Probe at 180° rotation: (60, 100)
    const rot180 = await getPixelAt(page, 60, 100);
    expect(rot180.a).toBeGreaterThan(0);

    // Probe at 270° rotation: (100, 60)
    const rot270 = await getPixelAt(page, 100, 60);
    expect(rot270.a).toBeGreaterThan(0);

    // Probe at 45° rotation: dx=40 → (100 + 40*cos45, 100 + 40*sin45) ≈ (128, 128)
    const rot45 = await getPixelAt(page, 128, 128);
    expect(rot45.a).toBeGreaterThan(0);

    // Probe at 135° rotation: (100 + 40*cos135, 100 + 40*sin135) ≈ (72, 128)
    const rot135 = await getPixelAt(page, 72, 128);
    expect(rot135.a).toBeGreaterThan(0);

    // Verify an area between strokes has no paint (e.g., doc (140, 140) —
    // no stroke should reach the far bottom-right corner)
    const empty = await getPixelAt(page, 170, 170);
    expect(empty.a).toBe(0);
  });

  test('radial symmetry works with pencil tool', async ({ page }) => {
    // Enable 6-fold radial symmetry
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryRadialSegments: (v: number) => void;
          setPencilSize: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setSymmetryRadialSegments(6);
      state.setPencilSize(3);
    });

    // Select pencil tool
    await page.keyboard.press('n');
    await page.waitForTimeout(100);

    // Set foreground color to red for visibility
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      store.getState().setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
    });

    // Draw a line from (110, 100) to (150, 100)
    const start = await docToScreen(page, 110, 100);
    const end = await docToScreen(page, 150, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Finalize
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: (label?: string) => void };
      };
      store.getState().pushHistory('Finalize pencil');
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/radial-symmetry-pencil.png' });

    // Original stroke at (130, 100)
    const original = await getPixelAt(page, 130, 100);
    expect(original.a).toBeGreaterThan(0);

    // 60° rotation of (130, 100) around (100, 100):
    // dx=30, dy=0 → (100 + 30*cos60, 100 + 30*sin60) = (115, 126)
    const rot60 = await getPixelAt(page, 115, 126);
    expect(rot60.a).toBeGreaterThan(0);

    // 120° rotation: (100 + 30*cos120, 100 + 30*sin120) = (85, 126)
    const rot120 = await getPixelAt(page, 85, 126);
    expect(rot120.a).toBeGreaterThan(0);

    // 180° rotation: (70, 100)
    const rot180 = await getPixelAt(page, 70, 100);
    expect(rot180.a).toBeGreaterThan(0);
  });

  test('disabling radial symmetry stops producing rotated copies', async ({ page }) => {
    // Enable then disable radial symmetry
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryRadialSegments: (v: number) => void;
          setBrushSize: (v: number) => void;
          setBrushOpacity: (v: number) => void;
          setBrushHardness: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setSymmetryRadialSegments(0);
      state.setBrushSize(10);
      state.setBrushOpacity(100);
      state.setBrushHardness(100);
    });

    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    // Draw a stroke to the right of center
    const start = await docToScreen(page, 110, 100);
    const end = await docToScreen(page, 160, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Finalize
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: (label?: string) => void };
      };
      store.getState().pushHistory('Finalize');
    });
    await page.waitForTimeout(200);

    // Original stroke should exist
    const original = await getPixelAt(page, 140, 100);
    expect(original.a).toBeGreaterThan(0);

    // 180° rotated position should NOT have paint
    const rot180 = await getPixelAt(page, 60, 100);
    expect(rot180.a).toBe(0);
  });
});
