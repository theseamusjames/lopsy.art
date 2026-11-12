// #1601 — An inside Stroke only covered pixels at least half covered by the
// shape. It is drawn over the layer, so the shape's faint anti-aliased edge
// pixels (alpha below 0.5) kept the fill colour: a lime fringe around the
// outside of a black ring. Those pixels now take the stroke colour.

import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  closeEffectsPanel,
  configureEffect,
  createDocument,
  docToScreen,
  setEffectColor,
  setForegroundColor,
  waitForStore,
} from './helpers';

const DOC_W = 600;
const DOC_H = 400;
const CX = 300;
const CY = 200;
const RX = 200;
const RY = 140;

async function menu(page: Page, top: string, item: string): Promise<void> {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

async function strokedEllipse(page: Page, width: number): Promise<void> {
  await createDocument(page, DOC_W, DOC_H, false);
  await page.waitForTimeout(300);
  await addLayer(page);
  await setForegroundColor(page, 0xc8, 0xf0, 0x31);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  const a = await docToScreen(page, CX - RX, CY - RY);
  const b = await docToScreen(page, CX + RX, CY + RY);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await menu(page, 'Edit', 'Fill');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
  await configureEffect(page, 'Stroke', { Width: width });
  await setEffectColor(page, 'Stroke color', 0x14, 0x14, 0x14);
  await page.getByTestId('effects-drawer').locator('[aria-label="Stroke position: inside"]').click();
  await closeEffectsPanel(page);
  await page.waitForTimeout(300);
}

/**
 * Pixels around the ellipse's rim, from just inside the ring's centre line
 * outward, whose colour leans clearly toward the lime fill (green well above
 * blue). The white backdrop and the near-black stroke are both neutral.
 */
async function fringePixels(page: Page, insetPx: number): Promise<{ count: number; rimPixels: number; samples: string[] }> {
  return page.evaluate(async ({ docW, docH, cx, cy, rx, ry, insetPx }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const vp = w.__editorStore.getState().viewport;
    let count = 0;
    let rimPixels = 0;
    const samples: string[] = [];
    for (let y = 0; y < docH; y++) {
      for (let x = 0; x < docW; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const f = Math.sqrt(dx * dx + dy * dy);
        // Distance from the rim in pixels, to first order.
        const grad = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
        const dist = (f - 1) * f / Math.max(grad, 1e-9);
        if (dist < -insetPx || dist > 4) continue;
        rimPixels++;
        const sx = Math.floor((x + 0.5 - docW / 2) * vp.zoom + vp.panX + p.width / 2);
        const sy = Math.floor((y + 0.5 - docH / 2) * vp.zoom + vp.panY + p.height / 2);
        const i = ((p.height - 1 - sy) * p.width + sx) * 4;
        const r = p.pixels[i] ?? 0;
        const g = p.pixels[i + 1] ?? 0;
        const b = p.pixels[i + 2] ?? 0;
        if (g - b > 40) {
          count++;
          if (samples.length < 8) samples.push(`(${x},${y}) d=${dist.toFixed(2)} rgb=${r},${g},${b}`);
        }
      }
    }
    return { count, rimPixels, samples };
  }, { docW: DOC_W, docH: DOC_H, cx: CX, cy: CY, rx: RX, ry: RY, insetPx });
}

test.describe('#1601 inside stroke leaves no fill-coloured fringe', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and the effects drawer need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  // 6 px runs the single-pass distance shader, 14 px the separable band.
  for (const width of [6, 14]) {
    test(`width ${width}: no lime pixels outside the ring`, async ({ page }) => {
      await strokedEllipse(page, width);
      await page.screenshot({ path: `e2e/screenshots/stroke-inside-fringe-1601-${width}.png` });

      // Control: the fill is still lime well inside the ring.
      const interior = await fringePixels(page, width + 20);
      expect(interior.count).toBeGreaterThan(1000);

      const rim = await fringePixels(page, width / 2);
      expect(rim.rimPixels).toBeGreaterThan(1000);
      expect(rim.count, rim.samples.join('\n')).toBe(0);
    });
  }
});
