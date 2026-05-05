/**
 * Group Mask E2E Tests
 *
 * Verifies that a layer mask applied to a group layer is respected by the
 * compositor: masked regions are hidden, unmasked regions are visible.
 *
 * Architecture note: groups with masks are routed through the group scratch
 * FBO. After compositing all children into the group FBO, the group's mask
 * texture is sampled via blend.glsl before blending the group FBO onto the
 * parent composite. Masked (black = 0) pixels become transparent; unmasked
 * (white = 255) pixels pass through at full opacity.
 *
 * Reading strategy: __readCompositedPixels reads from the WebGL canvas after
 * final_blit.glsl runs. We set the document backgroundColor to opaque black
 * so that masked (transparent) areas render as black in final_blit rather
 * than as the gray checkerboard pattern. This lets tests assert on RGB values:
 *  - Unmasked red: r>200, g<50
 *  - Masked (black bg): r<50, g<50, b<50
 *  - Unmasked blue: b>200, r<50
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the composited pixel at the given document coordinate.
 * Accounts for the screen-space transform and WebGL Y-flip.
 */
async function readPixelAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ docX, docY }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn();
      if (!result) return { r: 0, g: 0, b: 0, a: 0 };
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { r: 0, g: 0, b: 0, a: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const sx = Math.round(
        (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
      );
      const canvas = container.querySelector('canvas');
      const canvasH = canvas?.height ?? result.height;
      const sy = canvasH - 1 - Math.round(
        (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      );
      if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (sy * result.width + sx) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { docX, docY },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Group Mask — compositor integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // Transparent document — the layer pixels provide all visible content.
    await createDocument(page, 100, 100, true);
    // Set document background to opaque black so that masked (transparent)
    // regions are rendered as solid black by final_blit.glsl. This avoids
    // the gray checkerboard pattern that final_blit uses for transparent docs
    // and makes pixel assertions predictable (r<50 = masked, r>200 = red layer).
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        setState: (patch: Record<string, unknown>) => void;
        getState: () => { document: Record<string, unknown> };
      };
      const doc = store.getState().document;
      store.setState({ document: { ...doc, backgroundColor: { r: 0, g: 0, b: 0, a: 1 } } });
    });
  });

  test('group mask hides the masked half of group content', async ({ page }) => {
    // -----------------------------------------------------------------------
    // 1. Get the first raster layer and the root group.
    // -----------------------------------------------------------------------
    const { layerId, groupId } = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string; name: string }>;
            rootGroupId: string;
          };
        };
      };
      const state = store.getState();
      return {
        layerId: state.document.layers.find((l) => l.type === 'raster')?.id ?? '',
        groupId: state.document.rootGroupId,
      };
    });

    expect(layerId).toBeTruthy();
    expect(groupId).toBeTruthy();

    // -----------------------------------------------------------------------
    // 2. Paint the raster layer fully red.
    // -----------------------------------------------------------------------
    await page.evaluate(({ lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const s = store.getState();
      const data = s.getOrCreateLayerPixelData(lid);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = 255; data.data[i + 1] = 0; data.data[i + 2] = 0; data.data[i + 3] = 255;
      }
      s.updateLayerPixelData(lid, data);
    }, { lid: layerId });
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // 3. Baseline: entire visible area should be red.
    // -----------------------------------------------------------------------
    const pixelBeforeCenter = await readPixelAtDoc(page, 50, 50);
    expect(pixelBeforeCenter.r).toBeGreaterThan(200);
    expect(pixelBeforeCenter.g).toBeLessThan(50);

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'group-mask-before.png') });

    // -----------------------------------------------------------------------
    // 4. Add a mask to the group (starts all-white = fully visible).
    // -----------------------------------------------------------------------
    await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayerMask: (id: string) => void };
      };
      store.getState().addLayerMask(gid);
    }, { gid: groupId });

    // -----------------------------------------------------------------------
    // 5. Black out the right half of the mask (x >= 50 → masked out).
    // -----------------------------------------------------------------------
    const maskAdded = await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{
              id: string;
              mask: { width: number; height: number; data: Uint8ClampedArray } | null;
            }>;
          };
          updateLayerMaskData: (id: string, data: Uint8ClampedArray) => void;
        };
      };
      const s = store.getState();
      const group = s.document.layers.find((l) => l.id === gid);
      if (!group?.mask) return false;
      const { width, height, data } = group.mask;
      const newData = new Uint8ClampedArray(data);
      for (let y = 0; y < height; y++) {
        for (let x = Math.floor(width / 2); x < width; x++) {
          newData[y * width + x] = 0;
        }
      }
      s.updateLayerMaskData(gid, newData);
      return true;
    }, { gid: groupId });

    expect(maskAdded).toBe(true);

    // Wait for mask sync to GPU and a recomposite frame
    await page.waitForTimeout(600);

    // -----------------------------------------------------------------------
    // 6. Read composited result and take screenshot.
    // -----------------------------------------------------------------------

    // Verify the mask data is actually set (sanity check before pixel read)
    const maskDataCheck = await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number; height: number } | null }> };
        };
      };
      const s = store.getState();
      const group = s.document.layers.find((l) => l.id === gid);
      if (!group?.mask) return { hasMask: false, rightHalfBlack: false };
      const { width, height, data } = group.mask;
      let allBlack = true;
      for (let y = 0; y < height && allBlack; y++) {
        for (let x = Math.floor(width / 2); x < width && allBlack; x++) {
          if (data[y * width + x] !== 0) allBlack = false;
        }
      }
      return { hasMask: true, rightHalfBlack: allBlack };
    }, { gid: groupId });
    expect(maskDataCheck.hasMask).toBe(true);
    expect(maskDataCheck.rightHalfBlack).toBe(true);

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'group-mask-applied.png') });

    // Left quarter (x=25): mask is white — should show red layer content.
    const leftPixel = await readPixelAtDoc(page, 25, 50);
    expect(leftPixel.r).toBeGreaterThan(200);
    expect(leftPixel.g).toBeLessThan(50);

    // Right quarter (x=75): mask is black — group contribution transparent → black bg.
    const rightPixel = await readPixelAtDoc(page, 75, 50);
    expect(rightPixel.r).toBeLessThan(50);
    expect(rightPixel.g).toBeLessThan(50);
    expect(rightPixel.b).toBeLessThan(50);

    // Just inside the black boundary at x=51 should also be masked.
    const borderPixel = await readPixelAtDoc(page, 51, 50);
    expect(borderPixel.r).toBeLessThan(50);
  });

  test('group mask with all-white leaves content fully visible', async ({ page }) => {
    const { layerId, groupId } = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string }>;
            rootGroupId: string;
          };
        };
      };
      const state = store.getState();
      return {
        layerId: state.document.layers.find((l) => l.type === 'raster')?.id ?? '',
        groupId: state.document.rootGroupId,
      };
    });

    // Paint layer blue
    await page.evaluate(({ lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const s = store.getState();
      const data = s.getOrCreateLayerPixelData(lid);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = 0; data.data[i + 1] = 0; data.data[i + 2] = 255; data.data[i + 3] = 255;
      }
      s.updateLayerPixelData(lid, data);
    }, { lid: layerId });
    await page.waitForTimeout(200);

    // Add mask (fills all-white by default)
    await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayerMask: (id: string) => void };
      };
      store.getState().addLayerMask(gid);
    }, { gid: groupId });
    await page.waitForTimeout(400);

    const px = await readPixelAtDoc(page, 50, 50);
    // All-white mask must not hide anything — blue content fully visible.
    // Blue: b>200, r<50, g<50
    expect(px.b).toBeGreaterThan(200);
    expect(px.r).toBeLessThan(50);
  });

  test('disabling group mask restores full visibility', async ({ page }) => {
    const { layerId, groupId } = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string }>;
            rootGroupId: string;
          };
        };
      };
      const state = store.getState();
      return {
        layerId: state.document.layers.find((l) => l.type === 'raster')?.id ?? '',
        groupId: state.document.rootGroupId,
      };
    });

    // Paint layer blue
    await page.evaluate(({ lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const s = store.getState();
      const data = s.getOrCreateLayerPixelData(lid);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = 0; data.data[i + 1] = 0; data.data[i + 2] = 255; data.data[i + 3] = 255;
      }
      s.updateLayerPixelData(lid, data);
    }, { lid: layerId });
    await page.waitForTimeout(200);

    // Add a mask and immediately black it out entirely.
    // Note: re-fetch state after addLayerMask since Zustand state is immutable;
    // `s` captured before addLayerMask won't see the updated layers.
    await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          addLayerMask: (id: string) => void;
          document: {
            layers: Array<{
              id: string;
              mask: { width: number; height: number; data: Uint8ClampedArray } | null;
            }>;
          };
          updateLayerMaskData: (id: string, data: Uint8ClampedArray) => void;
        };
      };
      store.getState().addLayerMask(gid);
      // Re-fetch state after mutation to see updated layers
      const s2 = store.getState();
      const group = s2.document.layers.find((l) => l.id === gid);
      if (!group?.mask) return;
      const allBlack = new Uint8ClampedArray(group.mask.data.length).fill(0);
      s2.updateLayerMaskData(gid, allBlack);
    }, { gid: groupId });
    await page.waitForTimeout(400);

    // All-black mask: layer content must be hidden → shows black background.
    const maskedPx = await readPixelAtDoc(page, 50, 50);
    expect(maskedPx.r).toBeLessThan(50);
    expect(maskedPx.g).toBeLessThan(50);
    expect(maskedPx.b).toBeLessThan(50);

    // Disable the mask
    await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { toggleLayerMask: (id: string) => void };
      };
      store.getState().toggleLayerMask(gid);
    }, { gid: groupId });
    await page.waitForTimeout(400);

    // With mask disabled, layer content fully visible again — blue.
    const unmaskedPx = await readPixelAtDoc(page, 50, 50);
    expect(unmaskedPx.b).toBeGreaterThan(200);
    expect(unmaskedPx.r).toBeLessThan(50);
  });
});
