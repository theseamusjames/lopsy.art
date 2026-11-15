/**
 * E2E tests for Auto Tone, Auto Contrast, and Auto Color (Image menu).
 *
 * Each test creates a multi-toned image, triggers the auto-enhance
 * action via the Image menu, and verifies the correction was applied
 * by reading composited pixels.
 */

import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getRootGroupId,
} from './helpers';

interface PixelResult { r: number; g: number; b: number; a: number }

async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<PixelResult> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
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

type AdjNodeShape = { id: string; type: string; enabled: boolean; [k: string]: unknown };

async function getGroupAdjustments(page: Page, groupId: string): Promise<AdjNodeShape[]> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; adjustments: AdjNodeShape[] }> } };
    };
    const state = store.getState();
    const group = state.document.layers.find((l) => l.id === id && l.type === 'group');
    return (group?.adjustments ?? []) as AdjNodeShape[];
  }, groupId);
}

async function clickImageMenuItem(page: Page, itemLabel: string): Promise<void> {
  await page.locator('button:has-text("Image")').first().click();
  await page.locator(`[role="menuitem"]:has-text("${itemLabel}")`).click();
  await page.waitForTimeout(300);
}

/**
 * Paint a three-band image directly on the active layer in a single
 * page.evaluate call. Avoids the auto-crop pitfall from multiple
 * paintRect calls.
 */
async function paintThreeBands(
  page: Page,
  dark: { r: number; g: number; b: number },
  mid: { r: number; g: number; b: number },
  bright: { r: number; g: number; b: number },
): Promise<void> {
  await page.evaluate(
    ({ dark, mid, bright }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const s = store.getState();
      const id = s.document.activeLayerId;
      const w = s.document.width;
      const h = s.document.height;
      s.pushHistory('Paint bands');
      const data = new ImageData(w, h);
      const bandH = Math.floor(h / 3);
      for (let y = 0; y < h; y++) {
        const color = y < bandH ? dark : y < bandH * 2 ? mid : bright;
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          data.data[idx] = color.r;
          data.data[idx + 1] = color.g;
          data.data[idx + 2] = color.b;
          data.data[idx + 3] = 255;
        }
      }
      s.updateLayerPixelData(id, data);
    },
    { dark, mid, bright },
  );
  await page.waitForTimeout(300);
}

test.describe('Auto Enhance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('Auto Tone stretches per-channel levels on a narrow-range image', async ({ page }) => {
    await createDocument(page, 200, 200);

    await paintThreeBands(
      page,
      { r: 60, g: 70, b: 50 },
      { r: 100, g: 110, b: 80 },
      { r: 130, g: 140, b: 120 },
    );

    await page.screenshot({ path: 'e2e/screenshots/auto-tone-before.png' });

    const beforeDark = await readCompositedAtDoc(page, 100, 30);
    const beforeBright = await readCompositedAtDoc(page, 100, 170);

    await clickImageMenuItem(page, 'Auto Tone');

    await page.screenshot({ path: 'e2e/screenshots/auto-tone-after.png' });

    const afterDark = await readCompositedAtDoc(page, 100, 30);
    const afterBright = await readCompositedAtDoc(page, 100, 170);

    // Auto Tone stretches the range: dark gets darker, bright gets brighter
    const beforeRange = (beforeBright.r + beforeBright.g + beforeBright.b) -
      (beforeDark.r + beforeDark.g + beforeDark.b);
    const afterRange = (afterBright.r + afterBright.g + afterBright.b) -
      (afterDark.r + afterDark.g + afterDark.b);
    expect(afterRange).toBeGreaterThan(beforeRange);

    // Verify a Levels adjustment node was added
    const rootGroupId = await getRootGroupId(page);
    const adjustments = await getGroupAdjustments(page, rootGroupId);
    const levelsNode = adjustments.find((n) => n.type === 'levels');
    expect(levelsNode).toBeTruthy();
    expect(levelsNode!.enabled).toBe(true);

    // Undo should revert
    await page.keyboard.press('Control+z');
    const undonePixel = await readCompositedAtDoc(page, 100, 30);
    expect(Math.abs(undonePixel.r - beforeDark.r)).toBeLessThanOrEqual(3);
  });

  test('Auto Contrast adjusts master luminance channel', async ({ page }) => {
    await createDocument(page, 200, 200);

    await paintThreeBands(
      page,
      { r: 80, g: 60, b: 40 },
      { r: 120, g: 100, b: 70 },
      { r: 150, g: 130, b: 100 },
    );

    await page.screenshot({ path: 'e2e/screenshots/auto-contrast-before.png' });

    const beforeDark = await readCompositedAtDoc(page, 100, 30);
    const beforeBright = await readCompositedAtDoc(page, 100, 170);

    await clickImageMenuItem(page, 'Auto Contrast');

    await page.screenshot({ path: 'e2e/screenshots/auto-contrast-after.png' });

    const afterDark = await readCompositedAtDoc(page, 100, 30);
    const afterBright = await readCompositedAtDoc(page, 100, 170);

    // Contrast should increase: luminance range widens
    const lumBefore = (0.299 * beforeBright.r + 0.587 * beforeBright.g + 0.114 * beforeBright.b) -
      (0.299 * beforeDark.r + 0.587 * beforeDark.g + 0.114 * beforeDark.b);
    const lumAfter = (0.299 * afterBright.r + 0.587 * afterBright.g + 0.114 * afterBright.b) -
      (0.299 * afterDark.r + 0.587 * afterDark.g + 0.114 * afterDark.b);
    expect(lumAfter).toBeGreaterThan(lumBefore);

    // Verify a Levels node was added
    const rootGroupId = await getRootGroupId(page);
    const adjustments = await getGroupAdjustments(page, rootGroupId);
    const levelsNode = adjustments.find((n) => n.type === 'levels');
    expect(levelsNode).toBeTruthy();
  });

  test('Auto Color neutralizes a red color cast', async ({ page }) => {
    await createDocument(page, 200, 200);

    // Strong red cast: R is much higher than G and B
    await paintThreeBands(
      page,
      { r: 100, g: 40, b: 40 },
      { r: 160, g: 80, b: 80 },
      { r: 220, g: 140, b: 140 },
    );

    await page.screenshot({ path: 'e2e/screenshots/auto-color-before.png' });

    const beforeMid = await readCompositedAtDoc(page, 100, 100);

    await clickImageMenuItem(page, 'Auto Color');

    await page.screenshot({ path: 'e2e/screenshots/auto-color-after.png' });

    const afterMid = await readCompositedAtDoc(page, 100, 100);

    // Red dominance should decrease (channels move toward balance)
    const beforeRedDominance = beforeMid.r - (beforeMid.g + beforeMid.b) / 2;
    const afterRedDominance = afterMid.r - (afterMid.g + afterMid.b) / 2;
    expect(afterRedDominance).toBeLessThan(beforeRedDominance);

    // Verify a Curves adjustment node was added
    const rootGroupId = await getRootGroupId(page);
    const adjustments = await getGroupAdjustments(page, rootGroupId);
    const curvesNode = adjustments.find((n) => n.type === 'curves');
    expect(curvesNode).toBeTruthy();
    expect(curvesNode!.enabled).toBe(true);
  });
});
