/**
 * Regression tests for the photo filter group adjustment.
 *
 * Covers two bugs that caused the effect to be invisible or incorrect:
 * 1. Pass-through groups silently bypass all group adjustments. Adding an
 *    adjustment auto-switches such a group to "normal" so the adjustment
 *    actually composites. (Per issue #523, new groups default to normal
 *    these days, so the auto-switch only matters for groups the user has
 *    explicitly set to pass-through.)
 * 2. Preserve Luminosity was using an HSL L-channel swap that caused
 *    unexpected hue shifts on neutral colors (gray → greenish tones).
 *    Fixed to use luminance-proportional scaling instead.
 */

import { test, expect } from './fixtures';
import {
  waitForStore,
  createDocument,
  getRootGroupId,
  addAdjustment,
} from './helpers';

interface PixelResult { r: number; g: number; b: number; a: number }

async function readCompositedAt(page: import('@playwright/test').Page, docX: number, docY: number): Promise<PixelResult> {
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
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
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

test.describe('Photo filter group adjustment', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'adjustments panel not accessible on mobile');
    await page.goto('/');
    await waitForStore(page);
    // Create document WITHOUT manually switching to normal blend mode —
    // the fix should auto-switch when we add the adjustment.
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);
  });

  test('adding photo filter to pass-through group auto-switches blend mode', async ({ page }) => {
    const rootGroupId = await getRootGroupId(page);

    // Explicitly put the group into pass-through (issue #523 changed the
    // default to normal, but this regression is about a user-selected
    // pass-through group silently swallowing its adjustment).
    await page.evaluate((gid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (label: string) => void;
          updateLayerBlendMode: (id: string, mode: string) => void;
        };
      };
      const s = store.getState();
      s.pushHistory('Change Blend Mode');
      s.updateLayerBlendMode(gid, 'pass-through');
    }, rootGroupId);
    await page.waitForTimeout(100);

    const blendModeBefore = await page.evaluate((gid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; blendMode: string }> } };
      };
      return store.getState().document.layers.find((l) => l.id === gid)?.blendMode;
    }, rootGroupId);
    expect(blendModeBefore).toBe('pass-through');

    // Add photo filter — this should auto-switch group to normal
    await addAdjustment(page, rootGroupId, 'photo-filter');
    await page.waitForTimeout(300);

    const blendModeAfter = await page.evaluate((gid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; blendMode: string }> } };
      };
      return store.getState().document.layers.find((l) => l.id === gid)?.blendMode;
    }, rootGroupId);
    expect(blendModeAfter).toBe('normal');
  });

  test('photo filter on neutral gray produces warm (orange-shifted) result', async ({ page }) => {
    // Use neutral gray — warm filter should unambiguously shift it toward warm orange
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const rasterLayer = state.document.layers.find((l) => l.type === 'raster');
      if (!rasterLayer) return;
      const data = new ImageData(200, 200);
      // Mid-gray: R=G=B=128
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = 128; data.data[i + 1] = 128; data.data[i + 2] = 128; data.data[i + 3] = 255;
      }
      state.updateLayerPixelData(rasterLayer.id, data);
    });
    await page.waitForTimeout(500);

    const before = await readCompositedAt(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/photo-filter-group-gray-before.png' });

    const rootGroupId = await getRootGroupId(page);
    await addAdjustment(page, rootGroupId, 'photo-filter', { density: 50 });
    await page.waitForTimeout(500);

    const after = await readCompositedAt(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/photo-filter-group-gray-after.png' });
    console.log('Gray - before:', before, 'after:', after);

    // A warm orange filter on neutral gray MUST shift toward orange:
    // - Red should increase or stay the same
    // - Blue should decrease
    // - Red should be the dominant channel (R > G > B for warm result)
    expect(after.a).toBeGreaterThan(200);
    expect(after.r).toBeGreaterThan(before.r);     // red increases
    expect(after.b).toBeLessThan(before.b);         // blue decreases
    expect(after.r).toBeGreaterThan(after.b);       // red > blue (warm direction)
    expect(after.r).toBeGreaterThan(after.g);       // red > green (warm, not green)
  });

  test('photo filter on sky blue reduces blue and shifts toward warm', async ({ page }) => {
    // Sky blue image: the warm filter should reduce blue noticeably
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const rasterLayer = state.document.layers.find((l) => l.type === 'raster');
      if (!rasterLayer) return;
      const data = new ImageData(200, 200);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = 100; data.data[i + 1] = 180; data.data[i + 2] = 255; data.data[i + 3] = 255;
      }
      state.updateLayerPixelData(rasterLayer.id, data);
    });
    await page.waitForTimeout(500);

    const before = await readCompositedAt(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/photo-filter-group-blue-before.png' });

    const rootGroupId = await getRootGroupId(page);
    await addAdjustment(page, rootGroupId, 'photo-filter', { density: 50 });
    await page.waitForTimeout(500);

    const after = await readCompositedAt(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/photo-filter-group-blue-after.png' });
    console.log('Sky blue - before:', before, 'after:', after);

    // Warm filter on sky blue: blue must decrease significantly
    expect(after.a).toBeGreaterThan(200);
    expect(after.b).toBeLessThan(before.b - 30);  // Blue reduced noticeably

    // The filter is visibly applied (image changed overall)
    const totalDiff = Math.abs(after.r - before.r) + Math.abs(after.g - before.g) + Math.abs(after.b - before.b);
    expect(totalDiff).toBeGreaterThan(30);
  });
});
