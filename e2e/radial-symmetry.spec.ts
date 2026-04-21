import { test, expect } from './fixtures';
import { waitForStore, createDocument, getPixelAt } from './helpers';

test.describe('Radial symmetry (mandala mode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 300, true);
    await page.waitForTimeout(300);
  });

  test('radial symmetry produces N-fold rotational copies', async ({ page }) => {
    // Screenshot before: blank transparent canvas
    await page.screenshot({ path: 'e2e/screenshots/radial-symmetry-before.png' });

    // Enable radial symmetry with 6 segments, disable mirror axes
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryRadial: (v: boolean) => void;
          setSymmetrySegments: (v: number) => void;
          setSymmetryHorizontal: (v: boolean) => void;
          setSymmetryVertical: (v: boolean) => void;
          setBrushSize: (v: number) => void;
          setBrushOpacity: (v: number) => void;
          setBrushHardness: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setSymmetryRadial(true);
      state.setSymmetrySegments(6);
      state.setSymmetryHorizontal(false);
      state.setSymmetryVertical(false);
      state.setBrushSize(12);
      state.setBrushOpacity(100);
      state.setBrushHardness(100);
    });

    // Select brush tool
    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    const docToScreen = async (docX: number, docY: number) => {
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
    };

    // Draw a stroke from near-center outward to the right
    // Document center is (150, 150), stroke goes (155, 150) → (200, 150)
    const start = await docToScreen(155, 150);
    const end = await docToScreen(200, 150);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Finalize the stroke by pushing history
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/radial-symmetry-after.png' });

    // With 6-fold symmetry, the stroke at 0° should produce copies at 60°, 120°, 180°, 240°, 300°
    // The original stroke is at the right (positive X from center)
    // Check pixel at (190, 150) — on the original stroke (0°)
    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    const originalStroke = await getPixelAt(page, 190, 150, layerId);
    expect(originalStroke.a).toBeGreaterThan(0);

    // Check at the 180° copy: should be at approximately (110, 150)
    // 2*150 - 190 = 110 (but via rotation, not reflection)
    const oppositeStroke = await getPixelAt(page, 110, 150, layerId);
    expect(oppositeStroke.a).toBeGreaterThan(0);

    // Check at the 60° copy: the point (190, 150) rotated 60° around (150, 150)
    // dx=40, dy=0 → rotated: (150 + 40*cos60, 150 + 40*sin60) ≈ (170, 185)
    const angle60Stroke = await getPixelAt(page, 170, 185, layerId);
    expect(angle60Stroke.a).toBeGreaterThan(0);

    // Check at the 300° copy: (150 + 40*cos300, 150 + 40*sin300) ≈ (170, 115)
    const angle300Stroke = await getPixelAt(page, 170, 115, layerId);
    expect(angle300Stroke.a).toBeGreaterThan(0);

    // Verify a point that should NOT have paint: center of the canvas
    // With small brush and outward stroke, center should be mostly clear
    const centerPixel = await getPixelAt(page, 150, 150, layerId);
    // Center may have a small dab from the start, but check corners are clear
    const cornerPixel = await getPixelAt(page, 10, 10, layerId);
    expect(cornerPixel.a).toBe(0);
  });
});
