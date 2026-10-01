/**
 * An outside Stroke effect left a thin seam between the shape and its
 * stroke. The stroke only covered pixels whose alpha was below 0.5 and was
 * drawn on top, so the layer's partly covered edge pixels (alpha 0.5 – 1)
 * were neither stroked nor opaque and let the backdrop through: a dark
 * hairline between a pale shape and a pale stroke on a dark backdrop. The
 * duotone data-visualisation tutorial hit it around a pale pollen basket.
 * Outside strokes are now drawn behind the layer, under its edge pixels.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setForegroundColor,
  docToScreen,
  configureEffect,
  setEffectColor,
  closeEffectsPanel,
} from './helpers';

const CX = 150;
const CY = 120;
const R = 80;
const BACKDROP = 0x20;
const SHAPE = 0xc7;
const STROKE = 0xbd;

async function menu(page: Page, top: string, item: string): Promise<void> {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

/** Red channel of the composite along a ray from the disc centre, distances r0..r1. */
async function ray(page: Page, angleDeg: number, r0: number, r1: number): Promise<number[]> {
  return page.evaluate(async ({ cx, cy, angle, r0, r1 }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const rad = (angle * Math.PI) / 180;
    const out: number[] = [];
    for (let d = r0; d <= r1; d++) {
      const x = Math.floor(cx + d * Math.cos(rad));
      const y = Math.floor(cy + d * Math.sin(rad));
      const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
      const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
      out.push(p.pixels[((p.height - 1 - sy) * p.width + sx) * 4] ?? 0);
    }
    return out;
  }, { cx: CX, cy: CY, angle: angleDeg, r0, r1 });
}

/** Pale disc on a dark backdrop with an outside Stroke of `width` px. */
async function strokedDisc(page: Page, width: number): Promise<void> {
  await createDocument(page, 300, 240, false);
  await page.waitForTimeout(300);
  await setForegroundColor(page, BACKDROP, BACKDROP, BACKDROP);
  await menu(page, 'Edit', 'Fill');
  await addLayer(page);
  await setForegroundColor(page, SHAPE, SHAPE, SHAPE);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  const a = await docToScreen(page, CX - R, CY - R);
  const b = await docToScreen(page, CX + R, CY + R);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await menu(page, 'Edit', 'Fill');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
  await configureEffect(page, 'Stroke', { Width: width });
  await setEffectColor(page, 'Stroke color', STROKE, STROKE, STROKE);
  await closeEffectsPanel(page);
  await page.waitForTimeout(300);
}

test.describe('Outside stroke meets its shape without a seam', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and the effects drawer need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  // 7 px runs the single-pass distance shader, 14 px the separable dilation.
  for (const width of [7, 14]) {
    test(`width ${width}: no backdrop between the disc and its stroke`, async ({ page }) => {
      await strokedDisc(page, width);
      await page.screenshot({ path: `e2e/screenshots/stroke-effect-edge-seam-${width}.png` });

      for (const angle of [20, 30, 45, 60, 75]) {
        // From inside the disc, across its anti-aliased edge, into the stroke.
        const across = await ray(page, angle, R - 4, R + width - 3);
        const darkest = Math.min(...across);
        expect(darkest, `ray at ${angle}°: ${across.join(',')}`).toBeGreaterThanOrEqual(STROKE - 3);
      }
      // Control: past the stroke the dark backdrop is back. (Measured along
      // the axis: the wide-stroke dilation is square, so it reaches further
      // on the diagonals.)
      const beyond = await ray(page, 0, R + width + 3, R + width + 3);
      expect(beyond[0]).toBeLessThanOrEqual(BACKDROP + 3);
    });
  }
});
