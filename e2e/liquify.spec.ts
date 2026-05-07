import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, getPixelAt } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

/**
 * Open the Liquify panel via the Filter menu.
 */
async function openLiquify(page: Page): Promise<void> {
  await page.click('text=Filter');
  await page.waitForTimeout(200);
  await page.click('text=Liquify...');
  await page.locator('[data-testid="liquify-panel"]').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Click Apply in the Liquify panel.
 */
async function applyLiquify(page: Page): Promise<void> {
  await page.locator('[data-testid="liquify-apply"]').click();
  await page.locator('[data-testid="liquify-panel"]').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(200);
}

/**
 * Click Cancel in the Liquify panel.
 */
async function cancelLiquify(page: Page): Promise<void> {
  await page.locator('[data-testid="liquify-panel"] button:has-text("Cancel")').click();
  await page.locator('[data-testid="liquify-panel"]').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(200);
}

async function fitToView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function readLayerPixels(page: Page, layerId?: string) {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, (id?: string) => Promise<{
      width: number; height: number; pixels: number[];
    }>>).__readLayerPixels;
    return read(id);
  }, layerId);
}

async function getActiveLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function pushHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory('test flush');
  });
  await page.waitForTimeout(200);
}

async function docToScreen(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ x: number; y: number }> {
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

/**
 * Perform a horizontal brush stroke in Liquify mode by dragging across the canvas.
 */
async function liquifyDrag(page: Page, fromDocX: number, fromDocY: number, toDocX: number): Promise<void> {
  const start = await docToScreen(page, fromDocX, fromDocY);
  const end = await docToScreen(page, toDocX, fromDocY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe('Liquify Tool', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('panel opens via Filter > Liquify... menu', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0 });
    await fitToView(page);

    await page.click('text=Filter');
    await page.waitForTimeout(200);

    // "Liquify..." should appear in the Filter menu
    const menuItem = page.locator('button:has-text("Liquify...")');
    await expect(menuItem).toBeVisible({ timeout: 3000 });

    await menuItem.click();
    await page.waitForTimeout(300);

    // Panel should be visible
    const panel = page.locator('[data-testid="liquify-panel"]');
    await expect(panel).toBeVisible({ timeout: 3000 });

    // Screenshot showing the panel open
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-panel-open.png') });

    // Mode selector, brush size, and action buttons should all be present
    await expect(panel.locator('select[aria-label="Liquify mode"]')).toBeVisible();
    await expect(panel.locator('input[aria-label="Brush size"]')).toBeVisible();
    await expect(panel.locator('button:has-text("Apply")')).toBeVisible();
    await expect(panel.locator('button:has-text("Cancel")')).toBeVisible();
  });

  test('Apply: push warp commits changed pixels to the layer', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    // Paint the left half red
    await drawRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0 });
    // Paint the right half blue (extends the layer to full 200px width)
    await drawRect(page, 100, 0, 100, 200, { r: 0, g: 0, b: 255 });
    await fitToView(page);
    await page.waitForTimeout(300);

    const layerId = await getActiveLayerId(page);

    // Confirm: pixel at x=50 is red, pixel at x=150 is blue
    await pushHistory(page);
    const beforeLeft = await getPixelAt(page, 50, 100, layerId);
    const beforeRight = await getPixelAt(page, 150, 100, layerId);
    expect(beforeLeft.r).toBeGreaterThan(200);
    expect(beforeRight.b).toBeGreaterThan(200);

    // Open Liquify
    await openLiquify(page);

    // Screenshot with panel visible
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-before-warp.png') });

    // Manipulate the displacement map: pull content from the right side (+50 dx)
    // Pixel at x=50 will sample from x=100 (the boundary) and beyond — blue
    await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          liquify: {
            displacementMap: { width: number; height: number; dx: Float32Array; dy: Float32Array };
          } | null;
          updateLiquifyDisplacementMap: (map: { width: number; height: number; dx: Float32Array; dy: Float32Array }) => void;
        };
      };
      const state = uiStore.getState();
      const session = state.liquify;
      if (!session) return;
      const map = session.displacementMap;
      const { width, height } = map;
      // Strong uniform rightward pull: sample 80px to the right
      for (let py = 80; py < 120; py++) {
        for (let px = 0; px < width; px++) {
          map.dx[py * width + px] = 80;
        }
      }
      // Zustand needs to see a new session object
      state.updateLiquifyDisplacementMap(map);
    });
    await page.waitForTimeout(100);

    // Screenshot after displacement
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-after-warp-preview.png') });

    await applyLiquify(page);
    await page.waitForTimeout(200);

    // Screenshot after Apply
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-applied.png') });

    // After warp: pixel at x=50, y=100 should now be blue (sampled from x=130)
    const afterLeft = await getPixelAt(page, 50, 100, layerId);
    expect(afterLeft.b).toBeGreaterThan(200);
    expect(afterLeft.r).toBeLessThan(50);
  });

  test('Cancel: discards displacement, layer pixels unchanged', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    // Draw a solid red block
    await drawRect(page, 50, 50, 100, 100, { r: 200, g: 50, b: 50 });
    await fitToView(page);
    await page.waitForTimeout(300);

    const layerId = await getActiveLayerId(page);

    // Snapshot original pixels by counting opaque pixels
    await pushHistory(page);
    const beforePixels = await readLayerPixels(page, layerId);
    const beforeOpaque = (beforePixels?.pixels ?? []).filter(
      (v, i) => i % 4 === 3 && v > 10,
    ).length;

    // Open Liquify and drag to warp
    await openLiquify(page);
    await liquifyDrag(page, 100, 100, 160, 100);

    // Screenshot showing the warp preview before cancel
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-cancel-preview.png') });

    // Cancel — should restore original
    await cancelLiquify(page);

    // Screenshot after cancel (should look identical to before)
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'liquify-cancelled.png') });

    // Pixel count should match the original
    const afterPixels = await readLayerPixels(page, layerId);
    const afterOpaque = (afterPixels?.pixels ?? []).filter(
      (v, i) => i % 4 === 3 && v > 10,
    ).length;

    // After cancel the layer should look unchanged — opaque pixel counts match
    expect(afterOpaque).toBeCloseTo(beforeOpaque, -1);

    // The center of the original red block should still be red
    const centerPixel = await getPixelAt(page, 100, 100, layerId);
    expect(centerPixel.r).toBeGreaterThan(150);
    expect(centerPixel.a).toBeGreaterThan(200);
  });

  test('Apply pushes to undo stack — undo restores original pixels', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    // Draw a distinctive blue rectangle
    await drawRect(page, 40, 40, 120, 120, { r: 0, g: 80, b: 200 });
    await fitToView(page);
    await page.waitForTimeout(300);

    const layerId = await getActiveLayerId(page);

    // Snapshot center pixel before warp
    await pushHistory(page);
    const beforeCenter = await getPixelAt(page, 100, 100, layerId);

    await openLiquify(page);
    // Push strongly from left to right across the center
    await liquifyDrag(page, 40, 100, 160, 100);
    await applyLiquify(page);

    // Undo the Liquify
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);

    // Pixels at center should be restored
    const afterUndo = await getPixelAt(page, 100, 100, layerId);
    expect(afterUndo.b).toBeCloseTo(beforeCenter.b, -1);
    expect(afterUndo.a).toBeCloseTo(beforeCenter.a, -1);
  });

});
