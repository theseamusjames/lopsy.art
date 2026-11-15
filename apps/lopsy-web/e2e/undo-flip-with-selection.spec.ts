import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getEditorState,
  undo,
  selectTool,
  drawRect,
} from './helpers';

/**
 * Regression test for #706: after Select All → Move tool → Flip Horizontal
 * → Undo, the flipped layer's content stayed pinned at (0, 0) rather than
 * returning to its original position.
 *
 * Root cause: `applyGpuTransform` calls `selectLayerAlpha` after dropping
 * the transform's float; `selectLayerAlpha` schedules a prefloat that
 * synchronously (setTimeout 0) re-creates a float on the same layer. Undo
 * did not drop that leftover float, so the engine's `update_layer` kept
 * preserving the float's expanded (0, 0, doc.w, doc.h) descriptor when
 * syncLayers pushed the restored (smaller) descriptor after
 * `restoreFromGpuSnapshot` shrank the texture back.
 */
test.describe('Undo after Select All → Flip', () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'options bar transform controls live in a sidebar');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, true);
    await page.waitForTimeout(300);
  });

  async function readLayerDims(page: Page, layerId: string) {
    return page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; x: number; y: number; width?: number; height?: number }>;
          };
        };
      };
      const l = store.getState().document.layers.find((ll) => ll.id === lid);
      if (!l) return null;
      return { x: l.x, y: l.y, width: l.width ?? 0, height: l.height ?? 0 };
    }, layerId);
  }

  async function readLayerContentCount(page: Page, layerId: string) {
    return page.evaluate(async (lid) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        | ((id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)
        | undefined;
      if (!readFn) return null;
      const r = await readFn(lid);
      if (!r || r.width === 0) return null;
      let opaque = 0;
      for (let i = 3; i < r.pixels.length; i += 4) {
        if ((r.pixels[i] ?? 0) > 10) opaque++;
      }
      return { texWidth: r.width, texHeight: r.height, opaque };
    }, layerId);
  }

  // Find the bounding box of red pixels in the composited canvas.
  // We use this to detect where the layer's content actually ends up on
  // screen — the store's descriptor can look fine while the engine's
  // layer_desc keeps stale expanded coordinates, and only the composited
  // output tells the truth.
  async function readCompositedRedBounds(page: Page) {
    return page.evaluate(async () => {
      const fn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        | (() => Promise<{ width: number; height: number; pixels: number[] }>)
        | undefined;
      if (!fn) return null;
      const r = await fn();
      let minX = r.width, minY = r.height, maxX = -1, maxY = -1, count = 0;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          const i = (y * r.width + x) * 4;
          const rr = r.pixels[i] ?? 0;
          const gg = r.pixels[i + 1] ?? 0;
          const bb = r.pixels[i + 2] ?? 0;
          if (rr > 100 && gg < 60 && bb < 60) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            count++;
          }
        }
      }
      return { canvasW: r.width, canvasH: r.height, minX, minY, maxX, maxY, count };
    });
  }

  test('flip via TransformControls then undo restores layer position', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Draw a small opaque rectangle offset from the origin — this is the
    // content whose position we expect undo to restore.
    await drawRect(page, 100, 100, 80, 40, { r: 200, g: 0, b: 0 });
    await page.waitForTimeout(300);

    const beforeDims = await readLayerDims(page, layerId);
    const beforeContent = await readLayerContentCount(page, layerId);
    const beforeRedBounds = await readCompositedRedBounds(page);
    expect(beforeDims).not.toBeNull();
    expect(beforeContent).not.toBeNull();
    expect(beforeContent!.opaque).toBeGreaterThan(0);
    // Layer should be cropped to content (not doc-sized) or at least
    // positioned somewhere other than the doc origin.
    expect(beforeDims!.x).toBeGreaterThan(0);
    expect(beforeDims!.y).toBeGreaterThan(0);
    expect(beforeRedBounds).not.toBeNull();
    expect(beforeRedBounds!.count).toBeGreaterThan(0);

    // Select All so a Flip via the transform controls floats + expands the
    // layer to the whole doc — this is the code path that leaves a stale
    // prefloat behind.
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);

    // Move tool activates the TransformControls flip buttons.
    await selectTool(page, 'move');
    await page.waitForTimeout(200);

    // Click the "Flip Horizontal" button from TransformControls (this uses
    // applyGpuTransform, not the Image-menu flipActiveLayer path).
    await page.locator('button[aria-label="Flip Horizontal"]').click();
    // Wait long enough for schedulePrefloat's setTimeout(0) to fire.
    await page.waitForTimeout(400);

    // Undo the flip.
    await undo(page);
    await page.waitForTimeout(400);

    const afterDims = await readLayerDims(page, layerId);
    const afterContent = await readLayerContentCount(page, layerId);
    const afterRedBounds = await readCompositedRedBounds(page);
    expect(afterDims).not.toBeNull();
    expect(afterContent).not.toBeNull();
    expect(afterRedBounds).not.toBeNull();

    // Layer position and dimensions must be restored to the pre-flip state.
    // Before the fix, x/y jumped to (0, 0) and width/height jumped to the
    // full document size because a leftover float pinned the engine's
    // descriptor at the expanded values.
    expect(afterDims!.x).toBe(beforeDims!.x);
    expect(afterDims!.y).toBe(beforeDims!.y);
    expect(afterDims!.width).toBe(beforeDims!.width);
    expect(afterDims!.height).toBe(beforeDims!.height);

    // And the texture on the GPU should be the pre-flip size, not doc-sized.
    expect(afterContent!.texWidth).toBe(beforeContent!.texWidth);
    expect(afterContent!.texHeight).toBe(beforeContent!.texHeight);
    // Opaque pixel count is preserved within a tight tolerance.
    expect(afterContent!.opaque).toBeGreaterThan(beforeContent!.opaque * 0.9);
    expect(afterContent!.opaque).toBeLessThan(beforeContent!.opaque * 1.1);

    // Composited output — the user-visible truth. Before the fix, the
    // stroke rendered at doc (0, 0); with the fix, it stays at its
    // original doc (100, 99) position. Compare bounding boxes in canvas
    // pixels — they should match within 1px of the pre-flip bounds.
    expect(afterRedBounds!.count).toBeGreaterThan(0);
    expect(Math.abs(afterRedBounds!.minX - beforeRedBounds!.minX)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterRedBounds!.minY - beforeRedBounds!.minY)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterRedBounds!.maxX - beforeRedBounds!.maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterRedBounds!.maxY - beforeRedBounds!.maxY)).toBeLessThanOrEqual(1);
  });
});
