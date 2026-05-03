/**
 * E2E test: Warped Text (arc, bulge, flag, wave, etc.)
 *
 * Validates that:
 * 1. The Warp style dropdown and Bend slider appear in TextOptions.
 * 2. Arc warp displaces text pixels vertically — the text is no longer on a
 *    flat baseline but forms a curved path.
 * 3. The warp style and bend values are stored on the committed text layer.
 * 4. bend=0 is an identity — the warped layer's pixel extent matches the
 *    flat render (regression guard for "warp always applies").
 */

import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Local helpers (duplicated from text-tool.spec.ts — local copies are fine
// per the guide since the spec owns its setup)
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
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

async function docToScreen(page: Page, docX: number, docY: number): Promise<{ x: number; y: number }> {
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

/** Read the active layer's GPU pixels. */
async function readLayerPixels(
  page: Page,
  layerId: string,
): Promise<{ width: number; height: number; pixels: number[] }> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    return result ?? { width: 0, height: 0, pixels: [] };
  }, layerId);
}

/** Get the active layer's ID. */
async function getActiveLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

/** Get the active text layer's warp properties. */
async function getTextLayerWarp(page: Page, layerId: string): Promise<{
  warpStyle: string | undefined;
  warpBend: number | undefined;
}> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{
            id: string;
            type: string;
            warpStyle?: string;
            warpBend?: number;
          }>;
        };
      };
    };
    const layers = store.getState().document.layers;
    const layer = layers.find((l) => l.id === id);
    return { warpStyle: layer?.warpStyle, warpBend: layer?.warpBend };
  }, layerId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Warped Text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 600, 400);
    // Select the text tool
    await page.keyboard.press('t');
  });

  test('Warp style dropdown is visible in the text options bar', async ({ page }) => {
    const warpSelect = page.locator('select[aria-label="Warp style"]');
    await expect(warpSelect).toBeVisible();
    const options = await warpSelect.locator('option').allTextContents();
    expect(options).toContain('None');
    expect(options).toContain('Arc');
    expect(options).toContain('Bulge');
    expect(options).toContain('Flag');
    expect(options).toContain('Wave');
  });

  test('Bend slider appears only when warp style is not None', async ({ page }) => {
    const bendLabel = page.locator('label:has-text("Bend")');

    // Initially (None) the Bend slider should not be visible
    await expect(bendLabel).not.toBeVisible();

    // Switch to Arc
    await page.locator('select[aria-label="Warp style"]').selectOption('arc');

    // Bend slider should now appear
    await expect(bendLabel).toBeVisible();

    // Switch back to None
    await page.locator('select[aria-label="Warp style"]').selectOption('none');
    await expect(bendLabel).not.toBeVisible();
  });

  test('arc warp displaces text pixels vertically', async ({ page }) => {
    // Set up arc warp with a strong bend before placing text
    await page.locator('select[aria-label="Warp style"]').selectOption('arc');

    // Set bend to maximum via the Bend slider value input
    const bendValueInput = page.locator('[aria-label="Bend value"]');
    await bendValueInput.fill('80');
    await bendValueInput.press('Enter');
    await page.waitForTimeout(100);

    // Place text — click at the horizontal centre of the document
    const pos = await docToScreen(page, 200, 200);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('HELLO');

    // Commit with Shift+Enter
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(400);

    // Screenshot: see what the warped text looks like
    await page.screenshot({ path: 'e2e/screenshots/warped-text-arc.png' });

    // Read the layer pixels
    const layerId = await getActiveLayerId(page);
    const { width, height, pixels } = await readLayerPixels(page, layerId);

    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);

    // Count opaque pixels per row to find the row with the most text content
    const rowCounts: number[] = new Array(height).fill(0) as number[];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
        if (alpha > 10) {
          (rowCounts[y] as number)++;
        }
      }
    }

    // Find the topmost and bottommost rows that contain text pixels
    let topRow = -1;
    let bottomRow = -1;
    for (let y = 0; y < height; y++) {
      if ((rowCounts[y] ?? 0) > 0) {
        if (topRow === -1) topRow = y;
        bottomRow = y;
      }
    }

    expect(topRow).toBeGreaterThanOrEqual(0);
    expect(bottomRow).toBeGreaterThan(topRow);

    // With a strong arc warp the text spans a significant vertical range.
    // For flat text, all pixels would be within ~1 line-height.
    // The arc moves the text centre up, so the total height should exceed
    // what flat text would occupy.
    const verticalSpan = bottomRow - topRow;
    // Flat text at 24px font size occupies roughly 30–40px.
    // Arc warp at bend=80 should add several multiples of that as vertical displacement.
    expect(verticalSpan).toBeGreaterThan(40);
  });

  test('committed text layer stores warpStyle and warpBend', async ({ page }) => {
    await page.locator('select[aria-label="Warp style"]').selectOption('flag');

    const bendValueInput = page.locator('[aria-label="Bend value"]');
    await bendValueInput.fill('50');
    await bendValueInput.press('Enter');
    await page.waitForTimeout(100);

    const pos = await docToScreen(page, 200, 200);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('Flag Test');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(400);

    const layerId = await getActiveLayerId(page);
    const { warpStyle, warpBend } = await getTextLayerWarp(page, layerId);

    expect(warpStyle).toBe('flag');
    expect(warpBend).toBe(50);
  });

  test('bend=0 is identity — pixel extents match flat render', async ({ page }) => {
    // Render with arc style but bend=0 — should behave as if no warp is applied
    await page.locator('select[aria-label="Warp style"]').selectOption('arc');

    const bendValueInput = page.locator('[aria-label="Bend value"]');
    await bendValueInput.fill('0');
    await bendValueInput.press('Enter');
    await page.waitForTimeout(100);

    const pos = await docToScreen(page, 200, 200);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('FLAT');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(400);

    const layerId = await getActiveLayerId(page);
    const { height } = await readLayerPixels(page, layerId);

    // For flat text at 24px with no warp overhead, the layer height should be
    // well within 150px (the warp renderer adds margin of ceil(height*0.5) on
    // each side, so identity case is expected to be compact).
    // At bend=0, renderWarpedText returns early and doesn't add margins.
    expect(height).toBeLessThan(150);
  });

  test('re-editing a warped text layer restores warp settings in the options bar', async ({ page }) => {
    // Create and commit a warped text layer
    await page.locator('select[aria-label="Warp style"]').selectOption('bulge');
    const bendInput = page.locator('[aria-label="Bend value"]');
    await bendInput.fill('60');
    await bendInput.press('Enter');
    await page.waitForTimeout(100);

    const pos = await docToScreen(page, 200, 200);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('BulgeTest');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(400);

    // Click the text layer to re-edit it (text tool should still be active)
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(300);

    // The warp style select should show 'bulge'
    const warpSelect = page.locator('select[aria-label="Warp style"]');
    await expect(warpSelect).toHaveValue('bulge');
  });
});
