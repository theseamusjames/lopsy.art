import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 400, transparent = false) {
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

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function readPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ px, py }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (py * result.width + px) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    },
    { px: x, py: y },
  );
}

function paintHorizontalStripes(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        getOrCreateLayerPixelData: (id: string) => ImageData;
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    state.pushHistory('Paint');
    const data = state.getOrCreateLayerPixelData(id);
    const W = data.width;
    const H = data.height;
    const stripeHeight = 20;
    for (let py = 0; py < H; py++) {
      const stripe = Math.floor(py / stripeHeight);
      const isEven = stripe % 2 === 0;
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        if (isEven) {
          data.data[idx] = 220;
          data.data[idx + 1] = 30;
          data.data[idx + 2] = 30;
        } else {
          data.data[idx] = 30;
          data.data[idx + 1] = 30;
          data.data[idx + 2] = 220;
        }
        data.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

test.describe('Tilt-Shift Blur Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('blurs edges while preserving sharp stripes in focus band', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintHorizontalStripes(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforeRed = await readPixel(page, 200, 10);
    const beforeBlue = await readPixel(page, 200, 30);
    expect(beforeRed.r).toBe(220);
    expect(beforeRed.b).toBe(30);
    expect(beforeBlue.r).toBe(30);
    expect(beforeBlue.b).toBe(220);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'tilt-shift-before.png') });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Tilt-Shift Blur...');
    await page.waitForTimeout(300);

    const dialog = page.locator('[role="dialog"][aria-label="Tilt-Shift Blur"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Set blur radius to max (32) for a strong effect
    const blurSlider = dialog.locator('input[type="range"]');
    await blurSlider.fill('32');
    await page.waitForTimeout(200);

    await dialog.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'tilt-shift-after.png') });

    // Center (y=200) is in the default focus band (position=0.5) — stripes should remain sharp
    const centerRed = await readPixel(page, 200, 190);
    const centerBlue = await readPixel(page, 200, 210);
    expect(Math.abs(centerRed.r - centerBlue.r)).toBeGreaterThan(100);

    // Top (y=10) is far from focus — stripes should be blurred
    const topPixel = await readPixel(page, 200, 10);
    const topRedDrift = Math.abs(topPixel.r - 220);
    const topBlueDrift = Math.abs(topPixel.b - 30);
    expect(topRedDrift + topBlueDrift).toBeGreaterThan(10);

    // Bottom (y=390) is also far from focus
    const bottomPixel = await readPixel(page, 200, 390);
    const bottomDrift = Math.abs(bottomPixel.r - 30) + Math.abs(bottomPixel.b - 220);
    expect(bottomDrift).toBeGreaterThan(10);
  });

  test('undo restores original pixels after tilt-shift blur', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintHorizontalStripes(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforePixel = await readPixel(page, 200, 10);
    const origR = beforePixel.r;
    const origB = beforePixel.b;

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Tilt-Shift Blur...');
    await page.waitForTimeout(300);

    const dialog = page.locator('[role="dialog"][aria-label="Tilt-Shift Blur"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const blurSlider = dialog.locator('input[type="range"]');
    await blurSlider.fill('30');
    await page.waitForTimeout(200);

    await dialog.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Verify the filter changed pixels
    const afterFilter = await readPixel(page, 200, 10);
    const changed = Math.abs(afterFilter.r - origR) + Math.abs(afterFilter.b - origB);
    expect(changed).toBeGreaterThan(0);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    const afterUndo = await readPixel(page, 200, 10);
    expect(afterUndo.r).toBe(origR);
    expect(afterUndo.b).toBe(origB);
  });

  test('dialog UI shows all controls and cancel works', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintHorizontalStripes(page);
    await page.waitForTimeout(300);
    await fitToView(page);

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Tilt-Shift Blur...');
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'tilt-shift-dialog.png') });

    const dialog = page.locator('[role="dialog"][aria-label="Tilt-Shift Blur"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const blurRadiusLabel = dialog.locator('text=Blur Radius');
    await expect(blurRadiusLabel).toBeVisible({ timeout: 2000 });

    const cancelBtn = dialog.locator('button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await page.waitForTimeout(300);

    await expect(dialog).not.toBeVisible();
  });
});
