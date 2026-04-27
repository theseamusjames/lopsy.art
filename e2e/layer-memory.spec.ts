import { test, expect } from './fixtures';
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
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP heap profiling requires Chromium');
    await page.goto('/');
    await waitForStore(page);
  });

  test('empty layers cost near-zero memory on 4K canvas', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(4032, 3024, true);
    });

    await page.waitForTimeout(200);
    const baseline = await getJSHeapUsedMB(page);

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

    expect(emptyLayerCost).toBeLessThan(10);
  });

  test('layers with single dot cost proportional to content, not canvas', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(4032, 3024, true);
    });

    await page.waitForTimeout(200);
    const baseline = await getJSHeapUsedMB(page);

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

    expect(dotLayerCost).toBeLessThan(50);
  });

  test('sparse: dots at opposite corners cost near-zero memory', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(4032, 3024, true);
    });

    await page.waitForTimeout(200);
    const baseline = await getJSHeapUsedMB(page);

    // Add 5 layers, each with dots at opposite corners
    // (content bounds span full canvas, but actual pixels are tiny)
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            addLayer: () => void;
            document: { activeLayerId: string; width: number; height: number };
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: () => void;
          };
        };
        const state = store.getState();
        state.addLayer();
        const s2 = store.getState();
        const layerId = s2.document.activeLayerId;
        const docW = s2.document.width;
        const docH = s2.document.height;
        s2.pushHistory();
        const data = s2.getOrCreateLayerPixelData(layerId);

        // Dot at top-left corner
        for (let y = 0; y < 5; y++) {
          for (let x = 0; x < 5; x++) {
            const idx = (y * data.width + x) * 4;
            data.data[idx] = 255;
            data.data[idx + 1] = 0;
            data.data[idx + 2] = 0;
            data.data[idx + 3] = 255;
          }
        }

        // Dot at bottom-right corner
        for (let y = docH - 5; y < docH; y++) {
          for (let x = docW - 5; x < docW; x++) {
            const idx = (y * data.width + x) * 4;
            data.data[idx] = 0;
            data.data[idx + 1] = 0;
            data.data[idx + 2] = 255;
            data.data[idx + 3] = 255;
          }
        }

        s2.updateLayerPixelData(layerId, data);
      });
    }

    await page.waitForTimeout(500);
    const afterCornerDots = await getJSHeapUsedMB(page);
    const cornerDotCost = afterCornerDots - baseline;

    console.log(`Baseline: ${baseline.toFixed(1)}MB`);
    console.log(`After 5 corner-dot layers: ${afterCornerDots.toFixed(1)}MB`);
    console.log(`Cost of 5 corner-dot layers: ${cornerDotCost.toFixed(1)}MB`);

    // Without sparse storage, each layer would hold ~48MB (full canvas bounds)
    // With sparse storage, only 50 pixels × 8 bytes = negligible per layer
    expect(cornerDotCost).toBeLessThan(10);
  });
});
