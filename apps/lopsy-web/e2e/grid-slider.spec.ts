import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enableGrid(page: Page): Promise<void> {
  const showGrid = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { showGrid: boolean };
    };
    return ui.getState().showGrid;
  });
  if (!showGrid) await page.keyboard.press("Control+'");
}

/**
 * Read the spacing between adjacent vertical grid lines on the overlay
 * canvas. We sample a horizontal scan row that does NOT lie on a horizontal
 * grid line, then return the median delta between consecutive marked
 * columns. Returns null if not enough lines are detected.
 */
async function measureGridSpacing(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    const overlay = all.find((c) => /overlayCanvas/.test(c.className));
    if (!overlay) return null;
    const ctx = overlay.getContext('2d');
    if (!ctx) return null;
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        viewport: { panX: number; panY: number; zoom: number };
        document: { width: number; height: number };
      };
    };
    const state = ed.getState();
    // Pick a doc-y that isn't on a centred horizontal grid line. Doc center
    // is at docH/2; offset by 7 px to be safely off any grid line.
    const docY = state.document.height / 2 + 7;
    const overlayY = Math.round(
      (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        overlay.height / 2,
    );
    const img = ctx.getImageData(0, overlayY, overlay.width, 1);
    // Detect runs of alpha > threshold and use the centre of each run.
    const positions: number[] = [];
    let runStart = -1;
    for (let x = 0; x < img.width; x++) {
      const a = img.data[x * 4 + 3] ?? 0;
      if (a > 30) {
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        positions.push((runStart + x - 1) / 2);
        runStart = -1;
      }
    }
    if (runStart >= 0) positions.push((runStart + img.width - 1) / 2);
    // Strip the leftmost vertical-ruler band (x < RULER_SIZE = 20).
    const filtered = positions.filter((p) => p >= 25);
    if (filtered.length < 3) return null;
    const deltas = filtered.slice(1).map((p, i) => p - filtered[i]!);
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)] ?? null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Grid size slider with stops (#125)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(200);
  });

  test('grid size control is a range slider, not a select', async ({ page }) => {
    await enableGrid(page);
    await page.waitForTimeout(150);

    // The grid slider uses the .gridSlider CSS module class. CSS modules
    // hash class names but preserve the original name as a substring, so
    // we match by [class*="gridSlider"]. This scopes us to the grid slider
    // specifically and avoids other range inputs on the page (color sliders,
    // brush options, etc.).
    const slider = page.locator('input[type="range"][class*="gridSlider"]');
    await expect(slider).toBeVisible();
    await expect(slider).toHaveCount(1);

    // There must NOT be a grid-size <select> anywhere — #125 replaced it
    // with this slider. We check for any <select> on the page since the
    // app has no other selects.
    expect(await page.locator('select').count()).toBe(0);

    // The slider's range should reflect the precomputed grid stops for a
    // 400x300 doc: [2, 4, 8, 16, 32, 64, 128] → 7 stops → max index 6.
    expect(await slider.getAttribute('min')).toBe('0');
    expect(await slider.getAttribute('max')).toBe('6');
    expect(await slider.getAttribute('step')).toBe('1');

    await page.screenshot({ path: 'e2e/screenshots/grid-slider.png' });
  });

  test('moving the slider updates store gridSize and rendered spacing', async ({ page }) => {
    await enableGrid(page);
    await page.waitForTimeout(150);

    const slider = page.locator('input[type="range"][class*="gridSlider"]');

    // Default grid size is 16 (per ui-store.ts) → index 3 in [2,4,8,16,32,64,128].
    const initialSize = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return ui.getState().gridSize;
    });
    expect(initialSize).toBe(16);
    expect(await slider.inputValue()).toBe('3');

    // Capture the rendered grid spacing at size 16 to verify it actually
    // matches what's drawn on the overlay (zoom may shrink the doc).
    const initialSpacing = await measureGridSpacing(page);
    expect(initialSpacing).not.toBeNull();

    // Move the slider two stops up: index 5 → grid size 64.
    await slider.fill('5');
    await page.waitForTimeout(200);

    const updatedSize = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return ui.getState().gridSize;
    });
    expect(updatedSize).toBe(64);

    // The on-canvas spacing must have grown — at the same zoom, a 64-px
    // grid produces lines exactly 4× as far apart as a 16-px grid.
    const updatedSpacing = await measureGridSpacing(page);
    expect(updatedSpacing).not.toBeNull();
    const ratio = updatedSpacing! / initialSpacing!;
    // Expect ~4× ± a small tolerance for sub-pixel rounding.
    expect(ratio).toBeGreaterThan(3.6);
    expect(ratio).toBeLessThan(4.4);

    // Move the slider down to the smallest stop: index 0 → grid size 2.
    await slider.fill('0');
    await page.waitForTimeout(200);
    const smallSize = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return ui.getState().gridSize;
    });
    expect(smallSize).toBe(2);

    await page.screenshot({ path: 'e2e/screenshots/grid-slider-changed.png' });
  });
});
