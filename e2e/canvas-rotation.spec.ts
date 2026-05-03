import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures';
import { waitForStore, createDocument, drawRect, getPixelAt } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

test.describe('Canvas rotation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(500);
  });

  test('rotation indicator is hidden at 0°', async ({ page }) => {
    const indicator = page.locator('[data-testid="rotation-indicator"]');
    await expect(indicator).toHaveCount(0);
  });

  test('setting canvasRotation via store shows the indicator', async ({ page }) => {
    // Set rotation to 30° directly via the UI store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setCanvasRotation: (a: number) => void };
      };
      store.getState().setCanvasRotation(Math.PI / 6); // 30°
    });

    await page.waitForTimeout(200);

    const indicator = page.locator('[data-testid="rotation-indicator"]');
    await expect(indicator).toBeVisible();
    const text = await indicator.innerText();
    expect(text).toContain('30°');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'canvas-rotation-30deg.png') });
  });

  test('Shift+R resets canvas rotation to 0°', async ({ page }) => {
    // Set a non-zero rotation
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setCanvasRotation: (a: number) => void };
      };
      store.getState().setCanvasRotation(Math.PI / 4); // 45°
    });

    await page.waitForTimeout(200);

    // Verify indicator is shown
    const indicator = page.locator('[data-testid="rotation-indicator"]');
    await expect(indicator).toBeVisible();

    // Press Shift+R to reset
    await page.keyboard.press('Shift+R');
    await page.waitForTimeout(200);

    // Indicator should be gone
    await expect(indicator).toHaveCount(0);

    // Verify store is actually reset to 0
    const rotation = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { canvasRotation: number };
      };
      return store.getState().canvasRotation;
    });
    expect(rotation).toBe(0);
  });

  test('clicking rotation indicator resets rotation to 0°', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setCanvasRotation: (a: number) => void };
      };
      store.getState().setCanvasRotation(Math.PI / 3); // 60°
    });

    await page.waitForTimeout(200);

    const indicator = page.locator('[data-testid="rotation-indicator"]');
    await expect(indicator).toBeVisible();

    await indicator.click();
    await page.waitForTimeout(200);

    await expect(indicator).toHaveCount(0);

    const rotation = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { canvasRotation: number };
      };
      return store.getState().canvasRotation;
    });
    expect(rotation).toBe(0);
  });

  test('CSS rotation transform is applied to the canvas element', async ({ page }) => {
    // Set rotation to 45°
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setCanvasRotation: (a: number) => void };
      };
      store.getState().setCanvasRotation(Math.PI / 4);
    });

    await page.waitForTimeout(300);

    // The main WebGL canvas should have a CSS transform applied
    const canvasTransform = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return null;
      // The first canvas is the WebGL canvas (no overlayCanvas class)
      const canvases = container.querySelectorAll('canvas');
      const webglCanvas = Array.from(canvases).find(
        (c) => !c.className.includes('overlayCanvas'),
      );
      if (!webglCanvas) return null;
      return webglCanvas.style.transform;
    });

    expect(canvasTransform).toContain('rotate(');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'canvas-rotation-css-transform.png') });
  });

  test('CSS transform is removed when rotation resets to 0°', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setCanvasRotation: (a: number) => void };
      };
      store.getState().setCanvasRotation(Math.PI / 6);
    });

    await page.waitForTimeout(200);

    // Reset via keyboard
    await page.keyboard.press('Shift+R');
    await page.waitForTimeout(200);

    const canvasTransform = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return null;
      const canvases = container.querySelectorAll('canvas');
      const webglCanvas = Array.from(canvases).find(
        (c) => !c.className.includes('overlayCanvas'),
      );
      if (!webglCanvas) return null;
      return webglCanvas.style.transform;
    });

    // Transform should be empty or undefined when rotation is 0
    expect(canvasTransform ?? '').toBe('');
  });

  test('painted shape pixel data is unaffected by canvas rotation', async ({ page }) => {
    // Draw a red rect at known doc coordinates
    await drawRect(page, 150, 100, 100, 80, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(300);

    // Read pixel at center of the painted rect before rotation (ground truth)
    const pixelBefore = await getPixelAt(page, 200, 140);
    expect(pixelBefore.r).toBeGreaterThan(200);
    expect(pixelBefore.a).toBeGreaterThan(200);

    // Rotate the canvas 90°
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setCanvasRotation: (a: number) => void };
      };
      store.getState().setCanvasRotation(Math.PI / 2);
    });
    await page.waitForTimeout(300);

    // The layer pixel data must be unchanged — rotation is purely a view transform.
    // getPixelAt accounts for layer offsets (auto-crop shifts x/y) and reads from GPU.
    const pixelAfter = await getPixelAt(page, 200, 140);
    expect(pixelAfter.r).toBeGreaterThan(200);
    expect(pixelAfter.a).toBeGreaterThan(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'canvas-rotation-layer-unaffected.png') });
  });
});
