import { test, expect } from '@playwright/test';
import { waitForStore } from './helpers';

async function getJSHeapUsedMB(page: import('@playwright/test').Page): Promise<number> {
  const client = await page.context().newCDPSession(page);
  // Force GC before measuring
  await client.send('HeapProfiler.collectGarbage');
  const { usedSize } = await client.send('Runtime.getHeapUsage');
  await client.detach();
  return usedSize / (1024 * 1024);
}

test.describe('Layer memory', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('empty layers cost near-zero memory on 4K canvas', async ({ page }) => {
    // Create a 4K canvas
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(4032, 3024, true);
    });

    await page.waitForTimeout(200);
    const baseline = await getJSHeapUsedMB(page);

    // Add 10 empty layers
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayer: () => void };
        };
        store.getState().addLayer();
      });
    }

    await page.waitForTimeout(200);
    const afterEmpty = await getJSHeapUsedMB(page);
    const emptyLayerCost = afterEmpty - baseline;

    console.log(`Baseline: ${baseline.toFixed(1)}MB`);
    console.log(`After 10 empty layers: ${afterEmpty.toFixed(1)}MB`);
    console.log(`Cost of 10 empty layers: ${emptyLayerCost.toFixed(1)}MB`);

    // 10 empty layers should cost < 10MB total (not 480MB)
    expect(emptyLayerCost).toBeLessThan(10);
  });

  test('layers with single dot cost proportional to content, not canvas', async ({ page }) => {
    // Create a 4K canvas
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(4032, 3024, true);
    });

    await page.waitForTimeout(200);
    const baseline = await getJSHeapUsedMB(page);

    // Add 5 layers and paint a single dot on each
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            addLayer: () => void;
            document: { activeLayerId: string };
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: () => void;
          };
        };
        const state = store.getState();
        state.addLayer();
        const s2 = store.getState();
        const layerId = s2.document.activeLayerId;
        s2.pushHistory();
        const data = s2.getOrCreateLayerPixelData(layerId);
        // Paint a single 10x10 dot near center
        for (let y = 1500; y < 1510; y++) {
          for (let x = 2000; x < 2010; x++) {
            const idx = (y * data.width + x) * 4;
            data.data[idx] = 255;
            data.data[idx + 1] = 0;
            data.data[idx + 2] = 0;
            data.data[idx + 3] = 255;
          }
        }
        s2.updateLayerPixelData(layerId, data);
      });
    }

    await page.waitForTimeout(500);
    const afterDots = await getJSHeapUsedMB(page);
    const dotLayerCost = afterDots - baseline;

    console.log(`Baseline: ${baseline.toFixed(1)}MB`);
    console.log(`After 5 dot layers: ${afterDots.toFixed(1)}MB`);
    console.log(`Cost of 5 dot layers: ${dotLayerCost.toFixed(1)}MB`);

    // 5 layers with tiny dots should cost << 240MB (5 × 48MB uncropped)
    // With cropping, each dot is ~10x10x4 = 400 bytes + history overhead
    // Allow generous 50MB for overhead, history snapshots, etc.
    expect(dotLayerCost).toBeLessThan(50);
  });
});
