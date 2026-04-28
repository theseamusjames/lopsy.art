// Regression test for #237: Smudge tool produced full-width horizontal
// streak artifacts because the GPU dispatch wrote to a doc-sized scratch
// FBO with the viewport set to the (smaller) layer size, then blitted
// the scratch back into the layer — reading garbage from the scratch's
// unwritten region in the process. Same root cause as #235.

import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  drawRect,
  selectTool,
  setToolOption,
  docToScreen,
} from './helpers';

async function getLayerPixelAt(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(({ x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: { id: string; x: number; y: number }[] };
        getOrCreateLayerPixelData: (id: string) => ImageData;
      };
    };
    const s = store.getState();
    const id = s.document.activeLayerId;
    const layer = s.document.layers.find((l) => l.id === id)!;
    const data = s.getOrCreateLayerPixelData(id);
    const lx = x - layer.x;
    const ly = y - layer.y;
    if (lx < 0 || ly < 0 || lx >= data.width || ly >= data.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const i = (ly * data.width + lx) * 4;
    return { r: data.data[i]!, g: data.data[i + 1]!, b: data.data[i + 2]!, a: data.data[i + 3]! };
  }, { x, y });
}

test.describe('smudge bounds (#237)', () => {
  test('smudge stroke does not leave full-width streaks far from the brush', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // A small dark rectangle on a transparent layer.
    await drawRect(page, 200, 100, 100, 80, { r: 30, g: 30, b: 30 });

    // Smudge across the top edge of the rectangle. The stroke is small
    // (~30 px) and stays inside the rectangle; pixels far away should
    // be unaffected.
    await selectTool(page, 'smudge');
    await setToolOption(page, 'Size', 20);
    await setToolOption(page, 'Strength', 50);

    const start = await docToScreen(page, 220, 110);
    const end = await docToScreen(page, 250, 105);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Sample a pixel FAR from the smudge brush — somewhere on the right
    // half of the canvas at the same Y as the smudge stroke.
    // Before the fix, scratch-FBO leakage would create a horizontal
    // streak across the full layer width, so this pixel would pick up
    // the dark colour. After the fix it should remain transparent.
    const farPixel = await getLayerPixelAt(page, 600, 110);
    expect(farPixel.a).toBeLessThan(20);
  });
});
