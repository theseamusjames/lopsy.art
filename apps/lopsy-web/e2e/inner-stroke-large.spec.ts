import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, paintRect } from './helpers';

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function countColorPixels(snap: PixelSnapshot, target: { r: number; g: number; b: number }, tolerance = 30): number {
  let count = 0;
  for (let i = 0; i < snap.pixels.length; i += 4) {
    const dr = Math.abs((snap.pixels[i] ?? 0) - target.r);
    const dg = Math.abs((snap.pixels[i + 1] ?? 0) - target.g);
    const db = Math.abs((snap.pixels[i + 2] ?? 0) - target.b);
    const a = snap.pixels[i + 3] ?? 0;
    if (a > 50 && dr <= tolerance && dg <= tolerance && db <= tolerance) count++;
  }
  return count;
}

test.describe('Inner stroke at large widths', () => {
  test('inner stroke remains visible at width 11 (separable dilation path)', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Fill the entire layer with solid blue
    await paintRect(page, 0, 0, 200, 200, { r: 0, g: 0, b: 255, a: 255 });
    await page.waitForTimeout(200);

    // Add a red inner stroke at width 10 (brute-force EDT path — known to work)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const { document: doc, updateLayerEffects } = store.getState();
      const id = doc.activeLayerId!;
      const layer = doc.layers.find((l) => l.id === id)!;
      updateLayerEffects(id, {
        ...layer.effects,
        stroke: { enabled: true, color: { r: 255, g: 0, b: 0, a: 1 }, width: 10, position: 'inside' },
      });
    });
    await page.waitForTimeout(300);

    const snapAt10 = await snapshot(page);
    const redAt10 = countColorPixels(snapAt10, { r: 255, g: 0, b: 0 });
    console.log(`Inner stroke width=10: ${redAt10} red pixels`);
    expect(redAt10).toBeGreaterThan(100);

    await page.screenshot({ path: 'e2e/screenshots/inner-stroke-width-10.png' });

    // Increase to width 11 (separable dilation path — this is the regression)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const { document: doc, updateLayerEffects } = store.getState();
      const id = doc.activeLayerId!;
      const layer = doc.layers.find((l) => l.id === id)!;
      updateLayerEffects(id, {
        ...layer.effects,
        stroke: { enabled: true, color: { r: 255, g: 0, b: 0, a: 1 }, width: 11, position: 'inside' },
      });
    });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/inner-stroke-width-11.png' });

    const snapAt11 = await snapshot(page);
    const redAt11 = countColorPixels(snapAt11, { r: 255, g: 0, b: 0 });
    console.log(`Inner stroke width=11: ${redAt11} red pixels`);

    // The stroke must still be visible — at least as many red pixels as width=10
    expect(redAt11).toBeGreaterThan(100);
    // Larger stroke should produce at least as much red
    expect(redAt11).toBeGreaterThanOrEqual(redAt10 * 0.8);
  });
});
