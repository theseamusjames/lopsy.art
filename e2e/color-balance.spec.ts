import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, paintRect } from './helpers';

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<PixelSnap | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

interface ColorBalanceJSON {
  shadowsCyanRed: number;
  shadowsMagentaGreen: number;
  shadowsYellowBlue: number;
  midtonesCyanRed: number;
  midtonesMagentaGreen: number;
  midtonesYellowBlue: number;
  highlightsCyanRed: number;
  highlightsMagentaGreen: number;
  highlightsYellowBlue: number;
}

async function setGroupColorBalance(page: Page, cb: ColorBalanceJSON): Promise<void> {
  await page.evaluate(({ cb }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { rootGroupId: string };
        setGroupAdjustments: (id: string, adj: Record<string, unknown>) => void;
        setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
      };
    };
    const state = store.getState();
    const groupId = state.document.rootGroupId;
    state.setGroupAdjustmentsEnabled(groupId, true);
    state.setGroupAdjustments(groupId, {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      whites: 0, blacks: 0, vignette: 0, saturation: 0, vibrance: 0,
      colorBalance: cb,
    });
  }, { cb });
}

const ZERO_CB: ColorBalanceJSON = {
  shadowsCyanRed: 0, shadowsMagentaGreen: 0, shadowsYellowBlue: 0,
  midtonesCyanRed: 0, midtonesMagentaGreen: 0, midtonesYellowBlue: 0,
  highlightsCyanRed: 0, highlightsMagentaGreen: 0, highlightsYellowBlue: 0,
};

test.describe('Color Balance adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
  });

  test('midtone cyan-red shift tints a gray fill toward red', async ({ page }) => {
    await paintRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128, a: 255 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/color-balance-before.png' });

    const before = await readCompositedAtDoc(page, 50, 50);
    expect(before.r).toBeGreaterThan(120);
    expect(before.r).toBeLessThan(140);

    await setGroupColorBalance(page, {
      ...ZERO_CB,
      midtonesCyanRed: 80,
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/color-balance-midtone-red.png' });

    const after = await readCompositedAtDoc(page, 50, 50);
    expect(after.r, 'red channel should increase with positive cyan-red').toBeGreaterThan(before.r + 20);
    expect(after.g, 'green should stay close to original').toBeGreaterThan(110);
    expect(after.g).toBeLessThan(150);
    expect(after.b, 'blue should stay close to original').toBeGreaterThan(110);
    expect(after.b).toBeLessThan(150);
  });

  test('shadow yellow-blue shift only affects dark tones', async ({ page }) => {
    // Paint two halves: dark (left) and bright (right)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const w = state.document.width;
      const h = state.document.height;
      const data = new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const v = x < w / 2 ? 40 : 220;
          data.data[idx] = v;
          data.data[idx + 1] = v;
          data.data[idx + 2] = v;
          data.data[idx + 3] = 255;
        }
      }
      store.getState().updateLayerPixelData(state.document.activeLayerId, data);
    });
    await page.waitForTimeout(300);

    const darkBefore = await readCompositedAtDoc(page, 25, 50);
    const brightBefore = await readCompositedAtDoc(page, 75, 50);

    await setGroupColorBalance(page, {
      ...ZERO_CB,
      shadowsYellowBlue: 100,
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/color-balance-shadow-blue.png' });

    const darkAfter = await readCompositedAtDoc(page, 25, 50);
    const brightAfter = await readCompositedAtDoc(page, 75, 50);

    const darkBlueShift = darkAfter.b - darkBefore.b;
    const brightBlueShift = brightAfter.b - brightBefore.b;

    expect(darkBlueShift, 'dark pixels should get a strong blue shift').toBeGreaterThan(15);
    expect(brightBlueShift, 'bright pixels should get little or no shift').toBeLessThan(darkBlueShift / 2);
  });

  test('highlight magenta-green shift only affects bright tones', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const w = state.document.width;
      const h = state.document.height;
      const data = new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const v = x < w / 2 ? 40 : 220;
          data.data[idx] = v;
          data.data[idx + 1] = v;
          data.data[idx + 2] = v;
          data.data[idx + 3] = 255;
        }
      }
      store.getState().updateLayerPixelData(state.document.activeLayerId, data);
    });
    await page.waitForTimeout(300);

    const darkBefore = await readCompositedAtDoc(page, 25, 50);
    const brightBefore = await readCompositedAtDoc(page, 75, 50);

    await setGroupColorBalance(page, {
      ...ZERO_CB,
      highlightsMagentaGreen: 80,
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/color-balance-highlight-green.png' });

    const darkAfter = await readCompositedAtDoc(page, 25, 50);
    const brightAfter = await readCompositedAtDoc(page, 75, 50);

    const darkGreenShift = darkAfter.g - darkBefore.g;
    const brightGreenShift = brightAfter.g - brightBefore.g;

    expect(brightGreenShift, 'bright pixels should get a strong green shift').toBeGreaterThan(15);
    expect(darkGreenShift, 'dark pixels should get little or no shift').toBeLessThan(brightGreenShift / 2);
  });

  test('resetting color balance restores original pixels', async ({ page }) => {
    await paintRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128, a: 255 });
    await page.waitForTimeout(200);

    const original = await readCompositedAtDoc(page, 50, 50);

    await setGroupColorBalance(page, {
      ...ZERO_CB,
      midtonesCyanRed: 100,
      midtonesMagentaGreen: -50,
      highlightsYellowBlue: 80,
    });
    await page.waitForTimeout(200);

    const shifted = await readCompositedAtDoc(page, 50, 50);
    expect(shifted.r).not.toEqual(original.r);

    await setGroupColorBalance(page, ZERO_CB);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/color-balance-after-reset.png' });

    const restored = await readCompositedAtDoc(page, 50, 50);
    expect(restored.r).toBeGreaterThan(original.r - 5);
    expect(restored.r).toBeLessThan(original.r + 5);
    expect(restored.g).toBeGreaterThan(original.g - 5);
    expect(restored.g).toBeLessThan(original.g + 5);
  });
});
