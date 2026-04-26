import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore
      && !!(window as unknown as Record<string, unknown>).__uiStore,
    { timeout: 30000 },
  );
}

async function createDocument(page: Page, width = 400, height = 400, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForTimeout(500);
}

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function setActiveTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool(t);
  }, tool);
  await page.waitForTimeout(100);
}

async function readPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ px, py }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (py * result.width + px) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { px: x, py: y },
  );
}

function paintRedBlueSplit(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        getOrCreateLayerPixelData: (id: string) => ImageData;
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    state.pushHistory('Paint');
    const data = state.getOrCreateLayerPixelData(id);
    const W = data.width;
    const H = data.height;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        if (px < W / 2) {
          data.data[idx] = 220;
          data.data[idx + 1] = 30;
          data.data[idx + 2] = 30;
        } else {
          data.data[idx] = 30;
          data.data[idx + 1] = 30;
          data.data[idx + 2] = 220;
        }
        data.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

/**
 * Returns a function that maps document-space coords to client-screen coords,
 * using the same math as `screenToCanvas` in App.tsx (inverted).
 */
async function getDocToScreenMapper(page: Page) {
  const t = await page.evaluate(() => {
    const editorStore = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { panX: number; panY: number; zoom: number }; document: { width: number; height: number } };
    };
    const state = editorStore.getState();
    const container = document.querySelector('[data-testid="canvas-container"]');
    const rect = (container as HTMLElement).getBoundingClientRect();
    const canvas = container?.querySelector('canvas') as HTMLCanvasElement;
    return {
      panX: state.viewport.panX,
      panY: state.viewport.panY,
      zoom: state.viewport.zoom,
      docW: state.document.width,
      docH: state.document.height,
      cw: canvas.width,
      ch: canvas.height,
      rectX: rect.left,
      rectY: rect.top,
    };
  });
  return (docX: number, docY: number) => ({
    x: (docX - t.docW / 2) * t.zoom + t.cw / 2 + t.panX + t.rectX,
    y: (docY - t.docH / 2) * t.zoom + t.ch / 2 + t.panY + t.rectY,
  });
}

async function activateMeshWarp(page: Page) {
  await setActiveTool(page, 'move');
  await page.locator('button:has-text("Mesh Warp")').click();
  await page.waitForTimeout(200);
  // Confirm session is active in the store
  const active = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { meshWarp: unknown };
    };
    return ui.getState().meshWarp !== null;
  });
  expect(active).toBe(true);
}

test.describe('Mesh Warp Inline Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('drag a grid handle on the canvas warps the layer pixels', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-before.png') });

    const beforeLeft = await readPixel(page, 100, 200);
    const beforeRight = await readPixel(page, 300, 200);
    expect(beforeLeft.r).toBeGreaterThan(200);
    expect(beforeRight.b).toBeGreaterThan(200);

    await activateMeshWarp(page);

    // After activation the toolbar shows the active row (Apply/Cancel/Reset).
    await expect(page.locator('button:has-text("Apply")')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible({ timeout: 2000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-active.png') });

    // The 4×4 default grid for a 400×400 doc has handles at (133, 133), (266, 133),
    // (133, 266), (266, 266) for the inner control points.
    // Drag the (266, 133) handle ~60px to the left in document space.
    const docToScreen = await getDocToScreenMapper(page);
    const handleStart = docToScreen(400 * (2 / 3), 400 * (1 / 3));
    const handleEnd = docToScreen(400 * (2 / 3) - 60, 400 * (1 / 3));

    await page.mouse.move(handleStart.x, handleStart.y);
    await page.mouse.down();
    await page.mouse.move(handleEnd.x, handleEnd.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Drag a second handle the opposite direction for asymmetry.
    const handle2Start = docToScreen(400 * (1 / 3), 400 * (2 / 3));
    const handle2End = docToScreen(400 * (1 / 3) + 60, 400 * (2 / 3));
    await page.mouse.move(handle2Start.x, handle2Start.y);
    await page.mouse.down();
    await page.mouse.move(handle2End.x, handle2End.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-dragging.png') });

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(400);

    // After applying, the inline session is cleared.
    const sessionAfter = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { meshWarp: unknown };
      };
      return ui.getState().meshWarp;
    });
    expect(sessionAfter).toBe(null);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-after.png') });

    const scanResults = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { totalDiff: 0 };
      let totalDiff = 0;
      const W = result.width;
      const H = result.height;
      const midX = W / 2;
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          const r = result.pixels[idx] ?? 0;
          const b = result.pixels[idx + 2] ?? 0;
          const a = result.pixels[idx + 3] ?? 0;
          const origR = px < midX ? 220 : 30;
          const origB = px < midX ? 30 : 220;
          if (a > 0 && (Math.abs(r - origR) > 20 || Math.abs(b - origB) > 20)) {
            totalDiff++;
          }
        }
      }
      return { totalDiff };
    });

    expect(scanResults.totalDiff).toBeGreaterThan(100);
  });

  test('cancel restores the original layer and clears the session', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);

    await activateMeshWarp(page);

    const cancelBtn = page.locator('button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible({ timeout: 2000 });
    await cancelBtn.click();
    await page.waitForTimeout(200);

    const session = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { meshWarp: unknown };
      };
      return ui.getState().meshWarp;
    });
    expect(session).toBe(null);

    // Pixels untouched
    const left = await readPixel(page, 100, 200);
    const right = await readPixel(page, 300, 200);
    expect(left.r).toBeGreaterThan(200);
    expect(right.b).toBeGreaterThan(200);
  });

  test('mesh bounds match selection bounding box when activated with a marquee', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);

    // Programmatically create a rectangular selection over a sub-region.
    await page.evaluate(() => {
      const editorStore = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            w: number,
            h: number,
          ) => void;
          document: { width: number; height: number };
        };
      };
      const state = editorStore.getState();
      const W = state.document.width;
      const H = state.document.height;
      const sx = 80, sy = 100, sw = 220, sh = 180;
      const mask = new Uint8ClampedArray(W * H);
      for (let y = sy; y < sy + sh; y++) {
        for (let x = sx; x < sx + sw; x++) {
          mask[y * W + x] = 255;
        }
      }
      state.setSelection({ x: sx, y: sy, width: sw, height: sh }, mask, W, H);
    });

    await activateMeshWarp(page);

    // The mesh warp session's bounds should match the selection bounding box.
    const bounds = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { meshWarp: { bounds: { x: number; y: number; width: number; height: number } } | null };
      };
      return ui.getState().meshWarp?.bounds ?? null;
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(80);
    expect(bounds!.y).toBe(100);
    expect(bounds!.width).toBe(220);
    expect(bounds!.height).toBe(180);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mesh-warp-selection-bounds.png') });
  });

  test('reset returns the grid to identity', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintRedBlueSplit(page);
    await page.waitForTimeout(300);
    await fitToView(page);

    await activateMeshWarp(page);

    // Drag a handle to make the grid non-identity.
    const docToScreen = await getDocToScreenMapper(page);
    const handleStart = docToScreen(400 * (2 / 3), 400 * (1 / 3));
    const handleEnd = docToScreen(400 * (2 / 3) - 60, 400 * (1 / 3));
    await page.mouse.move(handleStart.x, handleStart.y);
    await page.mouse.down();
    await page.mouse.move(handleEnd.x, handleEnd.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const draggedGrid = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { meshWarp: { grid: { points: { x: number; y: number }[] } } | null };
      };
      return ui.getState().meshWarp?.grid.points ?? null;
    });
    expect(draggedGrid).not.toBeNull();
    // At least one point should differ from its identity position.
    const anyMoved = draggedGrid!.some((p, i) => {
      const cols = 4;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const ox = c / (cols - 1);
      const oy = r / (cols - 1);
      return Math.abs(p.x - ox) > 0.01 || Math.abs(p.y - oy) > 0.01;
    });
    expect(anyMoved).toBe(true);

    await page.locator('button:has-text("Reset")').click();
    await page.waitForTimeout(100);

    const resetGrid = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { meshWarp: { grid: { points: { x: number; y: number }[] } } | null };
      };
      return ui.getState().meshWarp?.grid.points ?? null;
    });
    expect(resetGrid).not.toBeNull();
    // All points should now be at identity.
    for (let i = 0; i < resetGrid!.length; i++) {
      const cols = 4;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const ox = c / (cols - 1);
      const oy = r / (cols - 1);
      const p = resetGrid![i]!;
      expect(Math.abs(p.x - ox)).toBeLessThan(0.001);
      expect(Math.abs(p.y - oy)).toBeLessThan(0.001);
    }
  });
});
