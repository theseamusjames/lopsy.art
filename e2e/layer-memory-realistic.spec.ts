import { test, expect } from './fixtures';
import { waitForStore } from './helpers';

async function getJSHeapUsedMB(page: import('@playwright/test').Page): Promise<number> {
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.collectGarbage');
  const { usedSize } = await client.send('Runtime.getHeapUsage');
  await client.detach();
  return usedSize / (1024 * 1024);
}

test.describe('Layer memory (realistic 4K scenario)', () => {
  test('user scenario: load image, add layers, paint dots, add more layers', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);

    // Step 1: Load a 4K "image" (simulate by creating a white-filled canvas)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          createDocument: (w: number, h: number, t: boolean) => void;
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      store.getState().createDocument(4032, 3024, false);
    });
    await page.waitForTimeout(300);
    const afterLoad = await getJSHeapUsedMB(page);
    console.log(`After loading 4K image: ${afterLoad.toFixed(1)}MB`);

    // Step 2: Add 2 empty layers
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayer: () => void };
        };
        store.getState().addLayer();
      });
    }
    await page.waitForTimeout(200);
    const after2Empty = await getJSHeapUsedMB(page);
    const empty2Cost = after2Empty - afterLoad;
    console.log(`After 2 empty layers: ${after2Empty.toFixed(1)}MB (+${empty2Cost.toFixed(1)}MB)`);

    // Step 3: Select the background layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: { id: string }[] };
          setActiveLayer: (id: string) => void;
        };
      };
      const state = store.getState();
      const bgId = state.document.layers[0]!.id;
      state.setActiveLayer(bgId);
    });
    await page.waitForTimeout(200);
    const afterSelectBg = await getJSHeapUsedMB(page);
    console.log(`After selecting bg: ${afterSelectBg.toFixed(1)}MB`);

    // Step 4: Add another empty layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayer: () => void };
      };
      store.getState().addLayer();
    });
    await page.waitForTimeout(200);
    const afterLayer3 = await getJSHeapUsedMB(page);
    console.log(`After adding layer 3: ${afterLayer3.toFixed(1)}MB`);

    // Step 5: Paint dots in corners on layer 3
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: () => void;
        };
      };
      const s = store.getState();
      const layerId = s.document.activeLayerId;
      s.pushHistory();
      const data = s.getOrCreateLayerPixelData(layerId);
      const w = s.document.width;
      const h = s.document.height;

      // Top-left corner
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const idx = (y * data.width + x) * 4;
          data.data[idx] = 255;
          data.data[idx + 3] = 255;
        }
      }
      // Bottom-right corner
      for (let y = h - 5; y < h; y++) {
        for (let x = w - 5; x < w; x++) {
          const idx = (y * data.width + x) * 4;
          data.data[idx + 2] = 255;
          data.data[idx + 3] = 255;
        }
      }

      s.updateLayerPixelData(layerId, data);
    });
    await page.waitForTimeout(300);
    const afterDots = await getJSHeapUsedMB(page);
    console.log(`After corner dots: ${afterDots.toFixed(1)}MB`);

    // Step 6: Add a new empty layer (this is where the user saw a 100MB jump)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayer: () => void };
      };
      store.getState().addLayer();
    });
    await page.waitForTimeout(300);
    const afterNewEmpty = await getJSHeapUsedMB(page);
    const jumpFromDots = afterNewEmpty - afterDots;
    console.log(`After adding empty layer: ${afterNewEmpty.toFixed(1)}MB (+${jumpFromDots.toFixed(1)}MB from previous)`);

    // The jump from adding an empty layer should be small (<10MB)
    // Before the fix, this was ~100MB because resolveAllPixelData expanded sparse entries
    expect(jumpFromDots).toBeLessThan(10);

    // Total overhead from all added layers should be modest
    const totalOverhead = afterNewEmpty - afterLoad;
    console.log(`Total overhead from all layers: ${totalOverhead.toFixed(1)}MB`);
    expect(totalOverhead).toBeLessThan(60);
  });
});
