import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  getEditorState,
  getPixelAt,
  addLayer,
  setActiveLayer,
  enableEffect,
  closeEffectsPanel,
  undo,
} from './helpers';

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
});

test('undo color overlay does not shift layer content (#350)', async ({ page }) => {
  await createDocument(page, 200, 200, true);
  const s0 = await getEditorState(page);
  const layer1Id = s0.document.layers[0]!.id;

  // Paint a red block at an offset position (60,60)→(140,140) on layer 1.
  await page.evaluate(
    ({ id }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label: string) => void;
        };
      };
      const s = store.getState();
      const layer = s.document.layers.find((l) => l.id === id);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;

      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;

      return readFn(id).then((gpu) => {
        const w = gpu?.width ?? 200;
        const h = gpu?.height ?? 200;
        const img = new ImageData(w, h);
        if (gpu && gpu.width > 0) {
          for (let i = 0; i < gpu.pixels.length; i++) img.data[i] = gpu.pixels[i]!;
        }

        for (let y = 60 - ly; y < 140 - ly && y < h; y++) {
          for (let x = 60 - lx; x < 140 - lx && x < w; x++) {
            if (x < 0 || y < 0) continue;
            const idx = (y * w + x) * 4;
            img.data[idx] = 255;
            img.data[idx + 1] = 0;
            img.data[idx + 2] = 0;
            img.data[idx + 3] = 255;
          }
        }

        s.updateLayerPixelData(id, img);
        s.pushHistory('Paint red block');
      });
    },
    { id: layer1Id },
  );

  // Verify: red content is at (100, 100) in doc space.
  const pixBefore = await getPixelAt(page, 100, 100, layer1Id);
  expect(pixBefore.r).toBeGreaterThan(200);
  expect(pixBefore.a).toBeGreaterThan(200);

  // Add a new layer. This pushes history capturing layer 1's current state
  // (expanded, full-size texture). Then on the next render frame, the
  // active-layer transition crops layer 1's GPU texture to its content
  // bounds (80x80 at x=60, y=60) without marking it dirty.
  await addLayer(page);

  // Wait for the render frame to fire the active-layer crop transition.
  await page.waitForTimeout(300);

  // Verify: layer 1 has been cropped by the transition.
  const afterCrop = await getEditorState(page);
  const l1Cropped = afterCrop.document.layers.find((l) => l.id === layer1Id)!;
  expect(l1Cropped.x).toBe(60);
  expect(l1Cropped.y).toBe(60);

  const s1 = afterCrop;
  const layer2Id = s1.document.activeLayerId;

  // Paint blue on layer 2 and push history. At this point, layer 1's
  // GPU texture has been cropped but is NOT in dirtyLayerIds. Without
  // the fix, snapshotGpuLayers would reuse the stale full-size blob
  // from the addLayer snapshot.
  await page.evaluate(
    ({ id }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label: string) => void;
        };
      };
      const s = store.getState();
      const layer = s.document.layers.find((l) => l.id === id);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;

      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;

      return readFn(id).then((gpu) => {
        const w = gpu?.width ?? 200;
        const h = gpu?.height ?? 200;
        const img = new ImageData(w, h);
        if (gpu && gpu.width > 0) {
          for (let i = 0; i < gpu.pixels.length; i++) img.data[i] = gpu.pixels[i]!;
        }

        for (let y = 10 - ly; y < 50 - ly && y < h; y++) {
          for (let x = 10 - lx; x < 50 - lx && x < w; x++) {
            if (x < 0 || y < 0) continue;
            const idx = (y * w + x) * 4;
            img.data[idx] = 0;
            img.data[idx + 1] = 0;
            img.data[idx + 2] = 255;
            img.data[idx + 3] = 255;
          }
        }

        s.updateLayerPixelData(id, img);
        s.pushHistory('Paint blue block');
      });
    },
    { id: layer2Id },
  );

  // Select layer 1 (expands it back) and add a color overlay.
  await setActiveLayer(page, layer1Id);
  await page.waitForTimeout(200);
  await enableEffect(page, 'Color Overlay');
  await closeEffectsPanel(page);

  // Undo the color overlay (back to pre-effect expanded state).
  await undo(page);
  await page.waitForTimeout(200);

  // Undo again (back to paint2 snapshot — this is where the bug manifests).
  // The paint2 snapshot has layer 1 at x=60, y=60 (cropped state).
  // Without the fix, the blob was reused from addLayer (200x200 with content
  // at texture offset 60,60). Restoring this at layer position (60,60) puts
  // content at doc (120, 120) instead of (60, 60).
  await undo(page);
  await page.waitForTimeout(200);

  // THE CRITICAL CHECK: After undoing to the paint2 state, layer 1's
  // red content at doc (100, 100) must still be there.
  const centerPixel = await getPixelAt(page, 100, 100, layer1Id);
  expect(centerPixel.r).toBeGreaterThan(200);
  expect(centerPixel.a).toBeGreaterThan(200);

  // Verify: content at the bug location (120, 120) — without the fix,
  // the content would have shifted here. With the fix, it should be at
  // (60,60)-(140,140) as expected, so (120,120) would still be red,
  // but (5,5) would be transparent.
  const originPixel = await getPixelAt(page, 5, 5, layer1Id);
  expect(originPixel.a).toBe(0);

  // Also verify a pixel just outside the expected content bounds is empty.
  const outsidePixel = await getPixelAt(page, 145, 145, layer1Id);
  expect(outsidePixel.a).toBe(0);

  await page.screenshot({ path: 'e2e/screenshots/undo-effect-position.png' });
});
