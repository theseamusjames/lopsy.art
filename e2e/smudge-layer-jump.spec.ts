// Regression test: using the smudge tool on a cropped / offset layer — the
// shape a freshly pasted selection has — used to make the layer "jump" to a
// different spot on the canvas.
//
// The smudge GPU dispatch calls `ensure_layer_full_size`, which expands the
// layer texture to cover the document and repositions its origin to (<=0, <=0).
// The JS store kept the old offset bounds, so the stale position was later
// pushed back to the engine and the content shifted. The fix reconciles the JS
// layer bounds with the engine before the first dab (syncLayerAfterFullSize).

import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  drawEllipse,
  selectTool,
  setToolOption,
  docToScreen,
} from './helpers';

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

test.describe('smudge layer jump', () => {
  test('smudging an offset layer reconciles its position with the engine', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'drawEllipse helper uses shape tool which does not rasterize reliably on Firefox');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // A small ellipse away from the doc origin — the layer is cropped to its
    // content, so it sits at x>0, y>0 just like a pasted selection.
    await drawEllipse(page, 400, 300, 100, 60, { r: 60, g: 120, b: 220 });

    const before = await getActiveLayerBounds(page);
    expect(before.x).toBeGreaterThan(0);
    expect(before.y).toBeGreaterThan(0);
    expect(before.width).toBeLessThan(before.docW);

    // Smudge across the ellipse via the real tool.
    await selectTool(page, 'smudge');
    await setToolOption(page, 'Size', 30);
    await setToolOption(page, 'Strength', 60);
    const start = await docToScreen(page, 370, 300);
    const end = await docToScreen(page, 430, 300);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // After the stroke the layer must have been expanded to cover the document
    // and its origin reconciled to (<=0, <=0). A stale positive offset here is
    // the bug: the engine moved the layer but the store didn't follow.
    const after = await getActiveLayerBounds(page);
    expect(after.x).toBeLessThanOrEqual(0);
    expect(after.y).toBeLessThanOrEqual(0);
    expect(after.width).toBeGreaterThanOrEqual(before.docW);
    expect(after.height).toBeGreaterThanOrEqual(before.docH);
  });
});
