/**
 * Spray "Softness" means softness: a higher value paints softer dots.
 *
 * The slider used to write the brush dab's `hardness` uniform verbatim, so
 * Softness 100 painted the hardest possible dots and Softness 0 the softest.
 *
 * A hard dot is fully opaque out to its rim; a soft dot (hardness 0) fades
 * with `1 - smoothstep(t)`, which integrates to about 30 % of the hard dot's
 * coverage. One spray emission is a cloud of `Density` dots, so summing
 * alpha over a cloud averages that out: at the same Size, Density and
 * Opacity the Softness 0 cloud carries well over twice the alpha of the
 * Softness 100 cloud, whatever the random dot placement.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { waitForStore, createDocument, setToolOption, docToScreen } from './helpers';

const DOC_W = 600;
const DOC_H = 300;
const LEFT_CX = 150;
const RIGHT_CX = 450;
const CY = 150;

async function sprayOnce(page: Page, docX: number, docY: number): Promise<void> {
  const p = await docToScreen(page, docX, docY);
  await page.mouse.move(p.x, p.y);
  // Down and straight up: one emission. Holding for 166 ms would let the
  // airbrush timer add a second cloud.
  await page.mouse.down();
  await page.mouse.up();
}

/** Sum of alpha over the active layer, split at the document's vertical midline. */
async function alphaByHalf(page: Page): Promise<{ left: number; right: number }> {
  return page.evaluate(async (midX) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => {
        pushHistory: (label?: string) => void;
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    store.getState().pushHistory('flush');
    const state = store.getState();
    const id = state.document.activeLayerId;
    const layer = state.document.layers.find((l) => l.id === id);
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const img = await read(id);
    let left = 0;
    let right = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const a = img.pixels[(y * img.width + x) * 4 + 3] ?? 0;
        if ((layer?.x ?? 0) + x < midX) left += a;
        else right += a;
      }
    }
    return { left, right };
  }, DOC_W / 2);
}

test.describe('Spray Softness', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
  });

  test('Softness 100 sprays softer dots than Softness 0', async ({ page }) => {
    await page.keyboard.press('j');
    await setToolOption(page, 'Size', 200);
    await setToolOption(page, 'Density', 100);
    await setToolOption(page, 'Opacity', 100);

    await setToolOption(page, 'Softness', 0);
    await sprayOnce(page, LEFT_CX, CY);

    await setToolOption(page, 'Softness', 100);
    await sprayOnce(page, RIGHT_CX, CY);

    await page.screenshot({ path: 'e2e/screenshots/spray-softness-0-vs-100.png' });

    const { left: crisp, right: soft } = await alphaByHalf(page);
    expect(crisp, 'Softness 0 cloud (left) should have painted').toBeGreaterThan(0);
    expect(soft, 'Softness 100 cloud (right) should have painted').toBeGreaterThan(0);
    expect(soft, `Softness 100 alpha ${soft} vs Softness 0 alpha ${crisp}`).toBeLessThan(crisp * 0.6);
  });

  test('the default Softness reads 70', async ({ page }) => {
    await page.keyboard.press('j');
    await expect(page.locator('role=toolbar >> [aria-label="Softness value"]').first()).toHaveValue('70');
  });
});
