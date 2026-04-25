import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore, { timeout: 30000 });
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
  await page.waitForTimeout(500);
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
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { px: x, py: y },
  );
}

function paintRedBlueSplit(page: Page) {
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
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        if (px < W / 2) {
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

async function openMeshWarpDialog(page: Page) {
  await page.click('button:has-text("Filter")');
  await page.waitForTimeout(200);
  await page.click('button[role="menuitem"]:has-text("Mesh Warp")');
  await page.waitForTimeout(300);
  const heading = page.locator('h2:has-text("Mesh Warp")');
  await expect(heading).toBeVisible({ timeout: 3000 });
}

test.describe('Mesh Warp Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('mesh warp displaces pixels when grid points are dragged', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-before.png') });

    const beforeLeft = await readPixel(page, 100, 200);
    const beforeRight = await readPixel(page, 300, 200);
    expect(beforeLeft.r).toBeGreaterThan(200);
    expect(beforeRight.b).toBeGreaterThan(200);

    await openMeshWarpDialog(page);

    const gridCanvas = page.locator('[role="dialog"] canvas');
    await expect(gridCanvas).toBeVisible({ timeout: 2000 });

    const box = await gridCanvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const canvasW = box.width;
    const canvasH = box.height;
    const pad = 20 * (canvasW / 360);
    const drawW = canvasW - pad * 2;
    const drawH = canvasH - pad * 2;

    const col2x = box.x + pad + (2 / 3) * drawW;
    const row1y = box.y + pad + (1 / 3) * drawH;

    await page.mouse.move(col2x, row1y);
    await page.mouse.down();
    await page.mouse.move(col2x - drawW * 0.15, row1y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const col1x = box.x + pad + (1 / 3) * drawW;
    const row2y = box.y + pad + (2 / 3) * drawH;
    await page.mouse.move(col1x, row2y);
    await page.mouse.down();
    await page.mouse.move(col1x + drawW * 0.15, row2y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-after.png') });

    const scanResults = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { totalDiff: 0 };
      let totalDiff = 0;
      const W = result.width;
      const H = result.height;
      const midX = W / 2;
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          const r = result.pixels[idx] ?? 0;
          const b = result.pixels[idx + 2] ?? 0;
          const a = result.pixels[idx + 3] ?? 0;
          const origR = px < midX ? 220 : 30;
          const origB = px < midX ? 30 : 220;
          if (a > 0 && (Math.abs(r - origR) > 20 || Math.abs(b - origB) > 20)) {
            totalDiff++;
          }
        }
      }
      return { totalDiff };
    });

    expect(scanResults.totalDiff).toBeGreaterThan(100);
  });

  test('mesh warp dialog opens with grid controls and closes on cancel', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);

    await openMeshWarpDialog(page);

    const gridSelect = page.locator('select');
    await expect(gridSelect).toBeVisible({ timeout: 2000 });

    const resetButton = page.locator('button:has-text("Reset")');
    await expect(resetButton).toBeVisible({ timeout: 2000 });

    const applyButton = page.locator('button:has-text("Apply")');
    await expect(applyButton).toBeVisible({ timeout: 2000 });

    const cancelButton = page.locator('button:has-text("Cancel")');
    await expect(cancelButton).toBeVisible({ timeout: 2000 });

    const gridCanvas = page.locator('[role="dialog"] canvas');
    await expect(gridCanvas).toBeVisible({ timeout: 2000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-dialog.png') });

    await cancelButton.click();
    await page.waitForTimeout(300);

    const heading = page.locator('h2:has-text("Mesh Warp")');
    await expect(heading).not.toBeVisible({ timeout: 2000 });
  });

  test('identity warp with undo restores pixels', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforePixel = await readPixel(page, 100, 200);
    expect(beforePixel.r).toBeGreaterThan(200);

    await openMeshWarpDialog(page);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    const afterApply = await readPixel(page, 100, 200);
    expect(afterApply.r).toBeGreaterThan(200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    const afterUndo = await readPixel(page, 100, 200);
    expect(afterUndo.r).toBeGreaterThan(200);
    expect(afterUndo.b).toBeLessThan(50);
  });
});
