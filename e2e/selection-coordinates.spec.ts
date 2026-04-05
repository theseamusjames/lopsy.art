import { test, expect } from '@playwright/test';
import {
  createDocument,
  waitForStore,
  getEditorState,
  getPixelAt,
  paintCircle,
  addLayer,
  moveLayer,
} from './helpers';

// ---------------------------------------------------------------------------
// Selection helpers (test-specific, not shared)
// ---------------------------------------------------------------------------

async function magicWandSelect(page: import('@playwright/test').Page, canvasX: number, canvasY: number, tolerance = 0, contiguous = true) {
  await page.evaluate(
    ({ cx, cy, tol, contig }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            width: number;
            height: number;
            layers: Array<{ id: string; x: number; y: number }>;
            activeLayerId: string;
          };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            maskWidth: number,
            maskHeight: number,
          ) => void;
        };
      };
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId)!;
      const data = state.getOrCreateLayerPixelData(layer.id);
      const docW = state.document.width;
      const docH = state.document.height;

      const lx = cx - layer.x;
      const ly = cy - layer.y;

      const w = data.width;
      const h = data.height;

      const getPixel = (px: number, py: number) => {
        const idx = (py * w + px) * 4;
        return {
          r: data.data[idx] ?? 0,
          g: data.data[idx + 1] ?? 0,
          b: data.data[idx + 2] ?? 0,
          a: data.data[idx + 3] ?? 0,
        };
      };

      if (lx < 0 || lx >= w || ly < 0 || ly >= h) {
        const mask = new Uint8ClampedArray(docW * docH);
        for (let y = 0; y < docH; y++) {
          for (let x = 0; x < docW; x++) {
            const slx = x - layer.x;
            const sly = y - layer.y;
            if (slx < 0 || slx >= w || sly < 0 || sly >= h) {
              mask[y * docW + x] = 255;
            } else {
              const p = getPixel(slx, sly);
              if (p.a === 0) {
                mask[y * docW + x] = 255;
              }
            }
          }
        }
        let minX = docW, minY = docH, maxX = 0, maxY = 0;
        for (let y = 0; y < docH; y++) {
          for (let x = 0; x < docW; x++) {
            if (mask[y * docW + x]! > 0) {
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        }
        if (maxX >= minX && maxY >= minY) {
          state.setSelection({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, mask, docW, docH);
        }
        return;
      }

      const targetColor = getPixel(lx, ly);
      const visited = new Set<number>();
      const selected: Array<{ x: number; y: number }> = [];

      const colorMatch = (px: number, py: number) => {
        const c = getPixel(px, py);
        const diff = Math.abs(c.r - targetColor.r) + Math.abs(c.g - targetColor.g) +
          Math.abs(c.b - targetColor.b) + Math.abs(c.a - targetColor.a);
        return diff <= tol * 4;
      };

      if (contig) {
        const stack = [{ x: lx, y: ly }];
        while (stack.length > 0) {
          const p = stack.pop()!;
          const key = p.y * w + p.x;
          if (visited.has(key)) continue;
          if (p.x < 0 || p.x >= w || p.y < 0 || p.y >= h) continue;
          if (!colorMatch(p.x, p.y)) continue;
          visited.add(key);
          selected.push(p);
          stack.push({ x: p.x + 1, y: p.y });
          stack.push({ x: p.x - 1, y: p.y });
          stack.push({ x: p.x, y: p.y + 1 });
          stack.push({ x: p.x, y: p.y - 1 });
        }
      } else {
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            if (colorMatch(px, py)) {
              selected.push({ x: px, y: py });
            }
          }
        }
      }

      const mask = new Uint8ClampedArray(docW * docH);
      for (const pt of selected) {
        const mx = pt.x + layer.x;
        const my = pt.y + layer.y;
        if (mx >= 0 && mx < docW && my >= 0 && my < docH) {
          mask[my * docW + mx] = 255;
        }
      }

      let minX = docW, minY = docH, maxX = 0, maxY = 0;
      for (let y = 0; y < docH; y++) {
        for (let x = 0; x < docW; x++) {
          if (mask[y * docW + x]! > 0) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX >= minX && maxY >= minY) {
        state.setSelection({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, mask, docW, docH);
      }
    },
    { cx: canvasX, cy: canvasY, tol: tolerance, contig: contiguous },
  );
}

async function fillSelection(page: import('@playwright/test').Page, color: { r: number; g: number; b: number; a: number }) {
  await page.evaluate(
    (color) => {
      const editorStore = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            width: number;
            height: number;
            layers: Array<{ id: string; x: number; y: number; width: number; height: number }>;
          };
          selection: {
            active: boolean;
            mask: Uint8ClampedArray | null;
            maskWidth: number;
            maskHeight: number;
          };
          layerPixelData: Map<string, ImageData>;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = editorStore.getState();
      const activeId = state.document.activeLayerId;
      if (!activeId) return;
      const layer = state.document.layers.find((l) => l.id === activeId);
      if (!layer) return;
      state.pushHistory();
      const existing = state.layerPixelData.get(activeId);
      const w = existing?.width ?? layer.width ?? state.document.width;
      const h = existing?.height ?? layer.height ?? state.document.height;
      const imageData = existing ?? new ImageData(w, h);
      const sel = state.selection;

      if (sel.active && sel.mask) {
        for (let y = 0; y < sel.maskHeight; y++) {
          for (let x = 0; x < sel.maskWidth; x++) {
            if ((sel.mask[y * sel.maskWidth + x] ?? 0) > 0) {
              const lx = x - layer.x;
              const ly = y - layer.y;
              if (lx < 0 || lx >= imageData.width || ly < 0 || ly >= imageData.height) continue;
              const idx = (ly * imageData.width + lx) * 4;
              imageData.data[idx] = color.r;
              imageData.data[idx + 1] = color.g;
              imageData.data[idx + 2] = color.b;
              imageData.data[idx + 3] = Math.round(color.a);
            }
          }
        }
      } else {
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = color.r;
          imageData.data[i + 1] = color.g;
          imageData.data[i + 2] = color.b;
          imageData.data[i + 3] = Math.round(color.a);
        }
      }
      state.updateLayerPixelData(activeId, imageData);
    },
    color,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ===========================================================================
// Magic Wand + Fill on Offset Layer
// ===========================================================================

test.describe('Selection Coordinates with Layer Offset', () => {
  test('magic wand outside circle on offset layer fills entire empty area', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    await paintCircle(page, 100, 100, 40, { r: 255, g: 0, b: 0, a: 255 }, bgId);
    await moveLayer(page, bgId, 0, -50);
    await magicWandSelect(page, 10, 180);

    await addLayer(page);
    await page.waitForTimeout(200);
    const s1 = await getEditorState(page);
    const fillLayerId = s1.document.activeLayerId;

    // Snapshot composited before fill
    const beforeFill = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });

    await fillSelection(page, { r: 0, g: 0, b: 255, a: 255 });
    await page.waitForTimeout(300);

    // Snapshot composited after fill — should have changed
    const afterFill = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });

    expect(beforeFill).not.toBeNull();
    expect(afterFill).not.toBeNull();
    let diffCount = 0;
    if (beforeFill && afterFill) {
      for (let i = 0; i < beforeFill.pixels.length; i += 4) {
        if (
          beforeFill.pixels[i] !== afterFill.pixels[i] ||
          beforeFill.pixels[i + 1] !== afterFill.pixels[i + 1] ||
          beforeFill.pixels[i + 2] !== afterFill.pixels[i + 2]
        ) diffCount++;
      }
    }
    // The fill should have produced visible blue pixels
    expect(diffCount).toBeGreaterThan(0);
  });

  test('fill selection respects layer offset correctly', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint a small square in the center
    await page.evaluate(
      ({ id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Paint');
        const data = state.getOrCreateLayerPixelData(id);
        for (let y = 30; y < 70; y++) {
          for (let x = 30; x < 70; x++) {
            const idx = (y * data.width + x) * 4;
            data.data[idx] = 255;
            data.data[idx + 1] = 0;
            data.data[idx + 2] = 0;
            data.data[idx + 3] = 255;
          }
        }
        state.updateLayerPixelData(id, data);
      },
      { id: bgId },
    );

    await moveLayer(page, bgId, 20, 20);
    await magicWandSelect(page, 5, 5);

    await addLayer(page);
    const s1 = await getEditorState(page);
    const fillLayerId = s1.document.activeLayerId;

    await fillSelection(page, { r: 0, g: 255, b: 0, a: 255 });

    const br = await getPixelAt(page, 99, 99, fillLayerId);
    expect(br.g).toBe(255);
    expect(br.a).toBe(255);

    const tl = await getPixelAt(page, 0, 0, fillLayerId);
    expect(tl.g).toBe(255);
    expect(tl.a).toBe(255);

    const center = await getPixelAt(page, 60, 60, fillLayerId);
    expect(center.a).toBe(0);
  });

  test('selection on layer moved far off-canvas edge', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint entire layer red
    await page.evaluate(
      ({ id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Paint');
        const data = state.getOrCreateLayerPixelData(id);
        for (let i = 0; i < data.data.length; i += 4) {
          data.data[i] = 255;
          data.data[i + 1] = 0;
          data.data[i + 2] = 0;
          data.data[i + 3] = 255;
        }
        state.updateLayerPixelData(id, data);
      },
      { id: bgId },
    );

    await moveLayer(page, bgId, -75, -75);

    // Create a full-canvas selection manually
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            maskWidth: number,
            maskHeight: number,
          ) => void;
        };
      };
      const state = store.getState();
      const w = state.document.width;
      const h = state.document.height;
      const mask = new Uint8ClampedArray(w * h);
      mask.fill(255);
      state.setSelection({ x: 0, y: 0, width: w, height: h }, mask, w, h);
    });

    await addLayer(page);
    const s1 = await getEditorState(page);
    const fillLayerId = s1.document.activeLayerId;

    await fillSelection(page, { r: 0, g: 0, b: 255, a: 255 });

    const topLeft = await getPixelAt(page, 0, 0, fillLayerId);
    expect(topLeft.b).toBe(255);

    const bottomRight = await getPixelAt(page, 99, 99, fillLayerId);
    expect(bottomRight.b).toBe(255);

    const center = await getPixelAt(page, 50, 50, fillLayerId);
    expect(center.b).toBe(255);
  });
});
