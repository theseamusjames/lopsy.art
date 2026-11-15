import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  drawRect,
  setActiveLayer,
  getEditorState,
  addLayer,
  selectTool,
  docToScreen,
  getPixelAt,
} from './helpers';

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Read a single pixel from the composited GPU canvas at a doc coordinate.
 * Projects doc → canvas-pixel using the viewport state, then reads
 * __readCompositedPixels (bottom-up buffer).
 */
async function readCompositedPixelAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<Pixel> {
  return page.evaluate(
    async ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const canvas = document.querySelector('[data-testid="canvas-container"] canvas:not([class*="overlayCanvas"])') as HTMLCanvasElement | null;
      if (!canvas) return { r: 0, g: 0, b: 0, a: 0 };

      // Canvas internal size matches container CSS size (see useAppEffects).
      const cw = canvas.width;
      const ch = canvas.height;
      const docCx = cw / 2 + state.viewport.panX;
      const docCy = ch / 2 + state.viewport.panY;
      const canvasX = Math.round(docCx + (x - state.document.width / 2) * state.viewport.zoom);
      const canvasY = Math.round(docCy + (y - state.document.height / 2) * state.viewport.zoom);
      if (canvasX < 0 || canvasX >= cw || canvasY < 0 || canvasY >= ch) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const data = await readFn();
      // Buffer is bottom-up.
      const fy = data.height - 1 - canvasY;
      const idx = (fy * data.width + canvasX) * 4;
      return {
        r: data.pixels[idx] ?? 0,
        g: data.pixels[idx + 1] ?? 0,
        b: data.pixels[idx + 2] ?? 0,
        a: data.pixels[idx + 3] ?? 0,
      };
    },
    { x: docX, y: docY },
  );
}

async function optionDrag(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
): Promise<void> {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(150);
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
});

test.describe('Move tool — option-drag duplicate', () => {
  test.use({ allowConsoleErrors: [/ERR_CERT_AUTHORITY_INVALID/] });

  // Regression for issue #543: option-dragging an already-duplicated layer
  // caused the original layer's content to visibly shift, even though its
  // stored bounds were unchanged. Root cause: the active-layer-change handler
  // in useCanvasRendering ran GPU-side cropLayerToContent / expandLayerToDocSize
  // and updated the JS layer bounds, but left the stale (pre-expand) JS pixel
  // data in pixelDataManager. The next syncLayers re-uploaded that stale data,
  // re-expanding the GPU texture so the layer's content rendered offset by the
  // expansion delta.
  test('repeated option-drag does not displace the original layer', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await addLayer(page);
    await page.waitForTimeout(150);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Paint a 60×60 red square in the upper-left quadrant.
    await setActiveLayer(page, layerId);
    await drawRect(page, 50, 50, 60, 60, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(150);

    // Sanity: a pixel inside the painted square should be red in the layer
    // texture.
    const sanityRead = await getPixelAt(page, 80, 80, layerId);
    expect(sanityRead.r).toBeGreaterThan(200);
    expect(sanityRead.g).toBeLessThan(30);
    expect(sanityRead.b).toBeLessThan(30);
    expect(sanityRead.a).toBeGreaterThan(200);

    // Record the initial bounds for the original layer.
    const beforeOriginalBounds = await page.evaluate((lid) => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
      };
      const layer = s.getState().document.layers.find((l) => l.id === lid);
      return layer ? { x: layer.x, y: layer.y, width: layer.width, height: layer.height } : null;
    }, layerId);
    expect(beforeOriginalBounds).not.toBeNull();

    // The composited canvas should also show red at the square's centre.
    const beforeComp = await readCompositedPixelAtDoc(page, 80, 80);
    expect(beforeComp.r).toBeGreaterThan(200);
    expect(beforeComp.g).toBeLessThan(30);
    expect(beforeComp.b).toBeLessThan(30);

    // First option-drag: switch to move tool, alt+drag to create a copy and
    // move it to the right.
    await selectTool(page, 'move');
    await optionDrag(page, { x: 80, y: 80 }, { x: 200, y: 80 });

    const afterFirst = await page.evaluate(() => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number; type: string }> } };
      };
      const doc = s.getState().document;
      return { activeLayerId: doc.activeLayerId, layers: doc.layers.map((l) => ({ id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, type: l.type })) };
    });
    const copyOneId = afterFirst.activeLayerId;
    expect(copyOneId).not.toBe(layerId);

    const origAfterFirst = afterFirst.layers.find((l) => l.id === layerId);
    expect(origAfterFirst).toBeDefined();
    expect(origAfterFirst!.x).toBe(beforeOriginalBounds!.x);
    expect(origAfterFirst!.y).toBe(beforeOriginalBounds!.y);

    // Original red square should still render at its starting position.
    const compAfterFirst = await readCompositedPixelAtDoc(page, 80, 80);
    expect(compAfterFirst.r).toBeGreaterThan(200);
    expect(compAfterFirst.g).toBeLessThan(30);
    expect(compAfterFirst.b).toBeLessThan(30);

    // Second option-drag: duplicate the copy.
    await optionDrag(page, { x: 200, y: 80 }, { x: 300, y: 80 });
    await page.waitForTimeout(200);

    const afterSecond = await page.evaluate(() => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number; type: string }> } };
      };
      const doc = s.getState().document;
      return { activeLayerId: doc.activeLayerId, layers: doc.layers.map((l) => ({ id: l.id, x: l.x, y: l.y, width: l.width, height: l.height, type: l.type })) };
    });

    const copyTwoId = afterSecond.activeLayerId;
    expect(copyTwoId).not.toBe(layerId);
    expect(copyTwoId).not.toBe(copyOneId);

    // Original layer's JS bounds remain unchanged.
    const origAfterSecond = afterSecond.layers.find((l) => l.id === layerId);
    expect(origAfterSecond).toBeDefined();
    expect(origAfterSecond!.x).toBe(beforeOriginalBounds!.x);
    expect(origAfterSecond!.y).toBe(beforeOriginalBounds!.y);
    expect(origAfterSecond!.width).toBe(beforeOriginalBounds!.width);
    expect(origAfterSecond!.height).toBe(beforeOriginalBounds!.height);

    // The crux of the bug: the original red square must STILL render at its
    // starting position in the composited output after the second
    // option-drag.
    await page.screenshot({ path: 'e2e/screenshots/option-drag-duplicate-after-second.png' });
    const compAfterSecond = await readCompositedPixelAtDoc(page, 80, 80);
    expect(compAfterSecond.r).toBeGreaterThan(200);
    expect(compAfterSecond.g).toBeLessThan(30);
    expect(compAfterSecond.b).toBeLessThan(30);

    // Also probe the corners of the original square to make sure the whole
    // thing is in place.
    const probeTL = await readCompositedPixelAtDoc(page, 60, 60);
    expect(probeTL.r).toBeGreaterThan(200);
    expect(probeTL.g).toBeLessThan(30);
    const probeBR = await readCompositedPixelAtDoc(page, 100, 100);
    expect(probeBR.r).toBeGreaterThan(200);
    expect(probeBR.g).toBeLessThan(30);
  });
});
