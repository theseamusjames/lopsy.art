// Regression test for #235: Gaussian Blur (and other filters that read
// from scratch FBOs) must work correctly on layers smaller than the
// document. Before the fix, the scratch textures were doc-sized but the
// viewport was set to the layer size, so pass-2 sampled garbage outside
// the valid sub-region and destroyed layer content.

import { test, expect } from './fixtures';
import { createDocument, waitForStore, drawEllipse, applyFilter } from './helpers';

async function getLayerPixelAt(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: { id: string; x: number; y: number }[] };
      };
    };
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const s = store.getState();
    const id = s.document.activeLayerId;
    const layer = s.document.layers.find((l) => l.id === id)!;
    const gpu = await readFn(id);
    if (!gpu) return { r: 0, g: 0, b: 0, a: 0 };
    const lx = x - layer.x;
    const ly = y - layer.y;
    if (lx < 0 || ly < 0 || lx >= gpu.width || ly >= gpu.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const i = (ly * gpu.width + lx) * 4;
    return { r: gpu.pixels[i]!, g: gpu.pixels[i + 1]!, b: gpu.pixels[i + 2]!, a: gpu.pixels[i + 3]! };
  }, { x, y });
}

test.describe('filter bounds (#235)', () => {
  test('Gaussian Blur on a small ellipse layer preserves the ellipse content', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // A small ellipse positioned away from the doc origin — this is the
    // case that used to break: the layer's content area is much smaller
    // than the doc-sized scratch texture.
    const cream = { r: 240, g: 230, b: 210 };
    await drawEllipse(page, 400, 300, 100, 50, cream);

    // Force GPU readback so pixel data is available (Firefox needs this)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: (label: string) => void };
      };
      store.getState().pushHistory('draw ellipse');
    });
    await page.waitForTimeout(500);

    // Sample the ellipse center BEFORE the blur to confirm content exists.
    const before = await getLayerPixelAt(page, 400, 300);
    expect(before.a).toBeGreaterThan(200);
    expect(before.r).toBeGreaterThan(200);
    expect(before.g).toBeGreaterThan(200);
    expect(before.b).toBeGreaterThan(150);

    // Apply Gaussian Blur radius=2 — should soften the edges, not blank
    // the ellipse out.
    await applyFilter(page, 'Gaussian Blur...', { Radius: 2 });

    // After the blur the center pixel should still be near the cream
    // colour. Before the fix it became near-zero (alpha mostly gone),
    // because the shader read garbage outside the layer's sub-region of
    // the scratch texture.
    const after = await getLayerPixelAt(page, 400, 300);
    expect(after.a).toBeGreaterThan(200);
    expect(after.r).toBeGreaterThan(180);
    expect(after.g).toBeGreaterThan(180);
    expect(after.b).toBeGreaterThan(140);
  });
});
