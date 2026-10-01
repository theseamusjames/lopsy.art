/**
 * #1089 — a hard Drop Shadow (Blur 0) left a light seam along the layer's
 * anti-aliased edge where that edge sits over its own shadow. The knockout
 * multiplied the shadow by (1 − a) and the layer was then composited over it
 * with the same a, so an edge pixel's coverage came out a + (1 − a)² instead
 * of a + (1 − a): a 50%-coverage black pixel over a black shadow showed 25%
 * of the white backdrop.
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
  setLayerOpacity,
} from './helpers';

const CX = 150;
const CY = 120;
const R = 100;

async function dragEllipticalMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

/**
 * Brightest composited channel value along a ray from the disc's centre,
 * from just inside its edge to just outside it. The shadow lies along the
 * lower-right rays, so on those every sample should be black.
 */
async function brightestAlongRay(page: Page, angleDeg: number): Promise<number[]> {
  return page.evaluate(async ({ cx, cy, r, angle }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const rad = (angle * Math.PI) / 180;
    const out: number[] = [];
    for (let d = r - 6; d <= r + 6; d++) {
      const x = Math.floor(cx + d * Math.cos(rad));
      const y = Math.floor(cy + d * Math.sin(rad));
      const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
      const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
      const i = ((p.height - 1 - sy) * p.width + sx) * 4;
      out.push(Math.max(p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0));
    }
    return out;
  }, { cx: CX, cy: CY, r: R, angle: angleDeg });
}

async function blackDiscWithHardShadow(page: Page): Promise<string> {
  await createDocument(page, 300, 240, false);
  await page.waitForTimeout(300);
  const layerId = await addLayer(page);
  await setForegroundColor(page, 0, 0, 0);
  await dragEllipticalMarquee(page, CX - R, CY - R, CX + R, CY + R);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  await configureEffect(page, 'Drop Shadow', {
    'Offset X': 16, 'Offset Y': 16, 'Blur': 0, 'Spread': 0, 'Opacity': 100,
  });
  await setEffectColor(page, 'Shadow color', 0, 0, 0);
  await closeEffectsPanel(page);
  await page.waitForTimeout(200);
  return layerId;
}

test.describe('Hard drop shadow knockout (#1089)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and the effects drawer need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('an anti-aliased edge over its own Blur 0 shadow shows no light seam', async ({ page }) => {
    await blackDiscWithHardShadow(page);
    const zoom = await page.evaluate(() => (window as unknown as {
      __editorStore: { getState: () => { viewport: { zoom: number } } };
    }).__editorStore.getState().viewport.zoom);
    expect(zoom).toBe(1);

    await page.screenshot({ path: 'e2e/screenshots/drop-shadow-knockout-seam-1089.png' });

    // 30°, 45° and 60° cross the disc's curved edge where the 16/16 shadow
    // sits right under it; every pixel there is black disc over black shadow.
    for (const angle of [30, 45, 60]) {
      const ray = await brightestAlongRay(page, angle);
      expect(Math.max(...ray), `ray at ${angle}°: ${ray.join(',')}`).toBeLessThanOrEqual(6);
    }

    // Control: the upper-left edge has no shadow under it, so the same scan
    // must run from black into the white backdrop.
    const bare = await brightestAlongRay(page, 225);
    expect(bare[0]).toBeLessThanOrEqual(6);
    expect(bare[bare.length - 1]).toBeGreaterThanOrEqual(250);
  });

  test('a half-opacity layer still hides its hard shadow beneath it', async ({ page }) => {
    const layerId = await blackDiscWithHardShadow(page);
    await setLayerOpacity(page, layerId, 50);
    await page.waitForTimeout(200);

    // Inside the disc, where the shadow also lies (centre + 30 px along 45°),
    // the knockout keeps the shadow out: the 50% black disc over white reads
    // ~128, not the ~0 a shadow showing through would give.
    const ray = await brightestAlongRay(page, 45);
    const inside = ray[0]!;
    expect(inside).toBeGreaterThanOrEqual(115);
    expect(inside).toBeLessThanOrEqual(140);
  });
});
