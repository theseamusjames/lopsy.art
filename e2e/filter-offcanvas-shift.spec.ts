// Regression test for #862: running a filter (e.g. Motion Blur) on a layer
// whose pixels hang past the bottom edge of the canvas shifted the content
// downward. `ensure_layer_covers` grows the layer texture to the union of
// its content and the doc bounds before a filter runs, but the filter's
// scratch FBOs (scratch_texture_a/b) were only ever sized at doc_width x
// doc_height — a viewport set to the layer's larger, grown size then
// rendered into a scratch texture too small to hold it, clipping/
// misaligning the result. A vertical 10px Motion Blur on a block moved
// 200px down (so its bottom 40 rows hang off a 300px-tall canvas) pushed
// the block's top edge down by ~27px instead of only feathering it by
// ~10px.

import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  drawRect,
  moveLayerTo,
  applyFilter,
  getEditorState,
  getPixelAt,
} from './helpers';

test.describe('filter on layer past canvas bottom (#862)', () => {
  test('Motion Blur does not shift a block whose content hangs off the canvas bottom', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    const red = { r: 255, g: 0, b: 0 };
    // Marquee (100,40) -> (300,140), fill red: layer becomes x:100,y:40,200x100.
    await drawRect(page, 100, 40, 200, 100, red);

    const layerId = (await getEditorState(page)).document.activeLayerId;

    // Drag the block straight down by 200px, from (200,90) to (200,290) —
    // the block now covers doc y 240-339, with its bottom 40 rows below
    // the 300px-tall canvas.
    await moveLayerTo(page, layerId, 100, 240);

    const moved = (await getEditorState(page)).document.layers.find((l) => l.id === layerId)!;
    expect(moved.x).toBe(100);
    expect(moved.y).toBe(240);
    expect(moved.width).toBe(200);
    expect(moved.height).toBe(100);

    // Sanity: the block's content is where we expect before filtering.
    const beforeTop = await getPixelAt(page, 200, 250);
    expect(beforeTop.a).toBeGreaterThan(200);
    expect(beforeTop.r).toBeGreaterThan(200);

    await applyFilter(page, 'Motion Blur...', { Angle: 90, Distance: 10 });

    // The motion blur shader averages samples over roughly ±distance/2
    // pixels (see motion_blur.glsl), so a vertical 10px blur only feathers
    // the top edge across about y 235-245. A probe well past that feather
    // zone but still comfortably above the block's untouched interior
    // distinguishes "edge merely softened" (opaque here) from "block
    // shifted down" (transparent here, since before the fix the top edge
    // jumped to ~267).
    const afterTop = await getPixelAt(page, 200, 253);
    expect(afterTop.a).toBeGreaterThan(200);
    expect(afterTop.r).toBeGreaterThan(150);

    // The block's interior, far from any edge, must remain solid red —
    // catches the case where the layer is corrupted outright rather than
    // just shifted.
    const afterCenter = await getPixelAt(page, 200, 295);
    expect(afterCenter.a).toBeGreaterThan(200);
    expect(afterCenter.r).toBeGreaterThan(150);
  });
});
