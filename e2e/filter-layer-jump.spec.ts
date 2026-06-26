// Regression test: applying a GPU filter (e.g. Gaussian Blur) to a cropped /
// offset layer — the shape a freshly pasted selection has — used to make the
// layer "jump" to a different spot on the canvas.
//
// GPU filter dispatches call `ensure_layer_full_size`, which expands the layer
// texture to cover the document and repositions its origin to (<=0, <=0). The
// JS store kept the old offset bounds, so the stale position was later pushed
// back to the engine and the content shifted. The fix reconciles the JS layer
// bounds with the engine after the filter (syncLayerAfterFullSize), mirroring
// the GPU brush/smudge path.

import { test, expect } from './fixtures';
import { createDocument, waitForStore, drawEllipse, applyFilter } from './helpers';

async function getActiveLayerBounds(
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number; width: number; height: number; docW: number; docH: number }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          activeLayerId: string;
          width: number;
          height: number;
          layers: { id: string; x: number; y: number; width: number; height: number }[];
        };
      };
    };
    const s = store.getState();
    const layer = s.document.layers.find((l) => l.id === s.document.activeLayerId)!;
    return {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      docW: s.document.width,
      docH: s.document.height,
    };
  });
}

test.describe('filter layer jump', () => {
  test('Gaussian Blur on an offset layer reconciles its position with the engine', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'drawEllipse helper uses shape tool which does not rasterize reliably on Firefox');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // A small ellipse positioned away from the doc origin — the resulting layer
    // is cropped to its content, so it sits at x>0, y>0 just like a pasted
    // selection.
    await drawEllipse(page, 400, 300, 100, 60, { r: 220, g: 60, b: 60 });

    const before = await getActiveLayerBounds(page);
    expect(before.x).toBeGreaterThan(0);
    expect(before.y).toBeGreaterThan(0);
    expect(before.width).toBeLessThan(before.docW);

    await applyFilter(page, 'Gaussian Blur...', { Radius: 3 });

    // After the filter the layer must have been expanded to cover the document
    // and its origin reconciled to (<=0, <=0). A stale positive offset here is
    // the bug: the engine moved the layer but the store didn't follow, so the
    // content jumps on the next sync frame.
    const after = await getActiveLayerBounds(page);
    expect(after.x).toBeLessThanOrEqual(0);
    expect(after.y).toBeLessThanOrEqual(0);
    expect(after.width).toBeGreaterThanOrEqual(before.docW);
    expect(after.height).toBeGreaterThanOrEqual(before.docH);
  });
});
