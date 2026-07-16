import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  drawRect,
  addAdjustment,
  getRootGroupId,
  setActiveLayer,
  addLayer,
  enableEffect,
  setEffectColor,
  closeEffectsPanel,
} from './helpers';

// Regression test for #663: a child layer under a group with adjustments
// wouldn't visually update when its own layer effects changed until the
// user switched active layers. The compositor caches the pre-adjustment
// scratch texture; `update_layer` marked `needs_recomposite` but didn't
// invalidate `group_pre_adj_valid`, so subsequent frames replayed the
// stale cached scratch and skipped re-blending the child (whose new
// effect never made it into the visible frame).

test.describe('#663 layer-effect changes on group-adjustment children', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects panel is desktop-only');
    await page.goto('/');
    await waitForStore(page);
  });

  test('color overlay on child updates without switching layers', async ({ page }) => {
    await createDocument(page, 400, 400, false);

    // Add a curves adjustment on the root group so the compositor
    // populates its pre-adjustment children cache.
    const rootId = await getRootGroupId(page);
    await addAdjustment(page, rootId, 'curves');
    await page.waitForTimeout(100);
    await closeEffectsPanel(page);

    // Layer 1: draw a red patch centred so a color overlay clearly
    // changes its pixels (bright green overlay should turn red → green).
    const layer1Id = await addLayer(page);
    await setActiveLayer(page, layer1Id);
    await drawRect(page, 100, 100, 200, 200, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(150);

    // Let the render loop run for a couple of frames so the compositor
    // caches the pre-adjustment scratch.
    await page.waitForTimeout(200);

    // Now flip on Color Overlay for Layer 1 (bright green). Before the
    // fix this changes the layer descriptor but the compositor keeps
    // replaying its cached pre-adjustment scratch and the change never
    // reaches the screen until you switch active layers.
    await enableEffect(page, 'Color Overlay');
    await setEffectColor(page, 'Overlay color', 0, 255, 0);
    await closeEffectsPanel(page);

    // Give the render loop a couple frames to catch up.
    await page.waitForTimeout(400);

    // Screenshot the canvas region and inspect the centre pixel — this is
    // what the user SEES. Screenshot uses the browser's page compositor
    // path so it reflects the WebGL drawing buffer at last natural render.
    const canvasEl = page.locator('main[data-testid="canvas-container"]');
    const buf = await canvasEl.screenshot();
    const b64 = buf.toString('base64');
    const avg = await page.evaluate(async (b64Src) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64Src}`;
      await img.decode();
      const off = document.createElement('canvas');
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const cx = Math.floor(off.width / 2);
      const cy = Math.floor(off.height / 2);
      const data = ctx.getImageData(cx - 3, cy - 3, 7, 7).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
      }
      return { r: r / n, g: g / n, b: b / n };
    }, b64);

    // After the fix: predominantly green. Before the fix: still red.
    expect(avg.g).toBeGreaterThan(140);
    expect(avg.r).toBeLessThan(120);
  });
});
