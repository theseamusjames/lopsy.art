import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setForegroundColor,
  getEditorState,
  enableEffect,
  closeEffectsPanel,
} from './helpers';

// Coverage for the nightly autofix batch:
// - #918 (undoing a pixel edit through a later layer-effect edit left the
//   Layers panel thumbnail showing the undone pixels, even though the
//   canvas and the layer's GPU texture were both back to empty. Root
//   cause: `pixelDataManager.clearAll()` bumps every layer's cached
//   version then drains the version map — a one-shot invalidation meant
//   for document teardown. History's undo/redo reused it to invalidate
//   the JS pixel cache after every GPU restore, so the *second*
//   consecutive undo/redo call (with no intervening cache write in
//   between, e.g. undoing straight through a metadata-only "Enable Drop
//   Shadow" entry) found the maps already empty and returned without
//   notifying — LayerThumbnail's `usePixelDataVersion` subscriber never
//   saw a version bump and never re-read the GPU texture.
//   `pixelDataManager.invalidateLayers()` replaces it at every undo/redo
//   call site: it always bumps and always notifies.)

const DARK = { r: 0x14, g: 0x14, b: 0x14 };

async function clickEditMenuFill(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
}

/** Read the Layers panel thumbnail canvas (24x24) for the given layer. */
async function readThumbnailOpaqueCount(page: Page, layerId: string): Promise<number> {
  const count = await page.evaluate((id) => {
    const row = document.querySelector(`[data-layer-id="${id}"]`);
    if (!row) return -1;
    const canvases = Array.from(row.querySelectorAll('canvas')) as HTMLCanvasElement[];
    const thumb = canvases.find((c) => c.width === 24 && c.height === 24);
    if (!thumb) return -1;
    const ctx = thumb.getContext('2d');
    if (!ctx) return -1;
    const img = ctx.getImageData(0, 0, 24, 24);
    let opaque = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if ((img.data[i + 3] ?? 0) > 128) opaque++;
    }
    return opaque;
  }, layerId);
  expect(count).toBeGreaterThanOrEqual(0);
  return count;
}

test.describe('#918 — thumbnail stays stale after undo crosses an effects-only entry', () => {
  test('two undos through an effects edit refresh the thumbnail without re-selecting the row', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel and menu bar require desktop layout');
    await page.goto('/');
    await waitForStore(page);

    // 1. New doc 400x300 White.
    await createDocument(page, 400, 300, false);

    // 2. Add Layer (Layer 1 active).
    const layerId = await addLayer(page);

    // 3. FG dark #141414, Edit -> Fill (no selection).
    await setForegroundColor(page, DARK.r, DARK.g, DARK.b);
    await clickEditMenuFill(page);
    // Let the thumbnail coalescer's idle callback drain.
    await page.waitForTimeout(500);

    const afterFill = await readThumbnailOpaqueCount(page, layerId);
    expect(afterFill).toBeGreaterThan(300); // most of 24*24=576 opaque

    // 4. Open layer effects, tick Enable Drop Shadow. Close drawer.
    await enableEffect(page, 'Drop Shadow');
    await closeEffectsPanel(page);
    await page.waitForTimeout(300);

    // The pixels haven't changed yet — thumbnail should still read as filled.
    const afterEffect = await readThumbnailOpaqueCount(page, layerId);
    expect(afterEffect).toBeGreaterThan(300);

    // 5. Cmd+Z twice: undo "Enable Drop Shadow", then undo "Fill".
    // Crucially, do NOT click any layer row in between or after — that's
    // the crux of the bug (re-selecting the row was the only thing that
    // used to refresh the stale thumbnail).
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+z');
    // Let the thumbnail coalescer's idle callback drain.
    await page.waitForTimeout(500);

    // Undo stack: ['New Document', 'Add Layer', 'Fill', 'Enable Drop
    // Shadow'] before the two undos — after undoing 'Enable Drop Shadow'
    // and 'Fill', only 'New Document' and 'Add Layer' remain.
    const state = await getEditorState(page);
    expect(state.undoStackLength).toBe(2);

    // The GPU texture and JS-visible layer data are back to empty.
    const layerPixels = await page.evaluate(async (id) => {
      const readLayerPixels = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        layerId?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readLayerPixels(id);
      const opaque = result.pixels.filter((v, i) => i % 4 === 3 && v > 10).length;
      return { width: result.width, height: result.height, opaque };
    }, layerId);
    expect(layerPixels.opaque).toBe(0);

    // The thumbnail must reflect that emptiness too, without a re-select.
    const afterUndos = await readThumbnailOpaqueCount(page, layerId);
    expect(afterUndos).toBeLessThan(50);
  });
});
