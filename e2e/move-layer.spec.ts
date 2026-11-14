import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  addLayer,
  getEditorState,
  getPixelAt,
  selectTool,
  setToolOption,
  setForegroundColor,
  docToScreen,
} from './helpers';

/**
 * A whole-layer drag with the Move tool moves the layer's content and
 * nothing else, keeps content that leaves the canvas, and is not undone by
 * the next press, whichever tool makes it.
 *
 * Everything here goes through the tools: the content is brushed on (so it
 * lives only on the GPU), the layer is dragged with the Move tool, and
 * pixels are read back with the awaited layer read.
 */

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function getLayerBounds(page: Page, layerId: string): Promise<Bounds> {
  return page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
        };
      };
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      return { x: layer?.x ?? 0, y: layer?.y ?? 0, width: layer?.width ?? 0, height: layer?.height ?? 0 };
    },
    layerId,
  );
}

async function brushStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/** Brush a solid block covering roughly `size` pixels around the stroke. */
async function brushBlock(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): Promise<void> {
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'brush');
  await setToolOption(page, 'Size', size);
  await setToolOption(page, 'Opacity', 100);
  await setToolOption(page, 'Hardness', 100);
  await brushStroke(page, from, to);
}

/** Press the Move tool at `at` and drag the active layer by (dx, dy). */
async function dragLayer(
  page: Page,
  at: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await selectTool(page, 'move');
  const start = await docToScreen(page, at.x, at.y);
  const end = await docToScreen(page, at.x + dx, at.y + dy);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Press and release the Move tool at `at` without moving. */
async function clickWithMoveTool(page: Page, at: { x: number; y: number }): Promise<void> {
  await selectTool(page, 'move');
  const point = await docToScreen(page, at.x, at.y);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function newLayer(page: Page): Promise<string> {
  await createDocument(page, 400, 300, true);
  await addLayer(page);
  await page.waitForTimeout(200);
  return (await getEditorState(page)).document.activeLayerId;
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
});

test.describe('Move Layer — content only', () => {
  test('a drag moves the content and leaves the rest of the canvas empty', async ({ page }) => {
    const layerId = await newLayer(page);
    // A block about 80 x 40 centred on (200, 150).
    await brushBlock(page, { x: 180, y: 150 }, { x: 220, y: 150 }, 40);
    expect((await getPixelAt(page, 200, 150, layerId)).a).toBe(255);

    await dragLayer(page, { x: 200, y: 150 }, 100, 80);
    await page.screenshot({ path: 'e2e/screenshots/move-layer-content-only.png' });

    // The layer is its content, not the canvas, and sits where it was dropped.
    const bounds = await getLayerBounds(page, layerId);
    expect(bounds.width).toBeLessThan(200);
    expect(bounds.height).toBeLessThan(150);
    expect(bounds.x).toBeGreaterThan(200);
    expect(bounds.y).toBeGreaterThan(150);

    const moved = await getPixelAt(page, 300, 230, layerId);
    expect(moved.r).toBe(255);
    expect(moved.a).toBe(255);
    // Nothing is left where the block was, and nothing came along elsewhere.
    expect((await getPixelAt(page, 200, 150, layerId)).a).toBe(0);
    expect((await getPixelAt(page, 5, 5, layerId)).a).toBe(0);
  });

  test('content dragged off the canvas survives a Move click and comes back', async ({ page }) => {
    const layerId = await newLayer(page);
    // A block about 60 x 40 near the right edge, centred on (350, 150).
    await brushBlock(page, { x: 340, y: 150 }, { x: 360, y: 150 }, 40);

    // Push it wholly past the right edge.
    await dragLayer(page, { x: 350, y: 150 }, 100, 0);
    const offCanvas = await getLayerBounds(page, layerId);
    expect(offCanvas.x).toBeGreaterThanOrEqual(400);

    // The pixels are still in the layer, out past the canvas.
    const kept = await getPixelAt(page, 450, 150, layerId);
    expect(kept.r).toBe(255);
    expect(kept.a).toBe(255);

    // A press with no drag must not pull the content back on-canvas.
    await clickWithMoveTool(page, { x: 200, y: 150 });
    expect(await getLayerBounds(page, layerId)).toEqual(offCanvas);

    // Dragging it back returns the same pixels to where they started.
    await dragLayer(page, { x: 200, y: 150 }, -100, 0);
    await page.screenshot({ path: 'e2e/screenshots/move-layer-off-canvas-and-back.png' });
    const restored = await getPixelAt(page, 350, 150, layerId);
    expect(restored.r).toBe(255);
    expect(restored.a).toBe(255);
    expect((await getLayerBounds(page, layerId)).x).toBeLessThan(400);
  });

  test('a brush click after a move does not snap the layer back', async ({ page }) => {
    const layerId = await newLayer(page);
    // A block about 80 x 40 centred on (200, 120).
    await brushBlock(page, { x: 180, y: 120 }, { x: 220, y: 120 }, 40);

    await dragLayer(page, { x: 200, y: 120 }, 100, 60);
    const afterMove = await getLayerBounds(page, layerId);
    expect(afterMove.x).toBeGreaterThan(200);
    expect(afterMove.y).toBeGreaterThan(120);

    // Paint one dab well away from the moved block.
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 12);
    const dab = await docToScreen(page, 60, 260);
    await page.mouse.click(dab.x, dab.y);
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/move-layer-brush-after-move.png' });

    // The block is still where it was dropped, not back at its origin.
    const moved = await getPixelAt(page, 300, 180, layerId);
    expect(moved.r).toBe(255);
    expect(moved.a).toBe(255);
    expect((await getPixelAt(page, 200, 120, layerId)).a).toBe(0);
    // And the dab landed where it was clicked.
    expect((await getPixelAt(page, 60, 260, layerId)).a).toBe(255);
  });
});
