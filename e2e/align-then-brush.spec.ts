import { test, expect, type Page } from './fixtures';

// Regression test for the "transparent pixels being moved" bug:
// After a layer's GPU texture has been expanded to full doc size (by a brush
// stroke), aligning the layer shifts its x/y. The next brush stroke must
// paint at the cursor's doc position — not at an offset relative to where
// the aligned content now sits. The root cause was a bad early-return in
// WASM's `ensure_layer_full_size`: it skipped expansion based on texture
// size alone, without checking that the doc was contained in the layer's
// bounds. JS recomputed expansion to cover the uncovered doc columns →
// JS/WASM desync → brush dab painted at the aligned offset.

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, w: number, h: number, transparent: boolean) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w, h, t: transparent },
  );
  await page.waitForTimeout(200);
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2,
      };
    },
    { docX, docY },
  );
}

async function setBrush(page: Page, size: number) {
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await page.evaluate(
    ({ size }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setBrushSize: (v: number) => void;
          setBrushHardness: (v: number) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      store.getState().setBrushSize(size);
      store.getState().setBrushHardness(100);
      store.getState().setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
    },
    { size },
  );
}

async function paintRectWithBrush(page: Page, docX: number, docY: number, w: number, h: number) {
  for (let yy = docY; yy <= docY + h; yy += 4) {
    const s = await docToScreen(page, docX, yy);
    const e = await docToScreen(page, docX + w, yy);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(e.x, e.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(200);
}

async function brushDotAt(page: Page, docX: number, docY: number) {
  const p = await docToScreen(page, docX, docY);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 2, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function clickAlign(page: Page, label: string) {
  await page.locator(`button[aria-label="${label}"]`).click();
  await page.waitForTimeout(250);
}

async function selectMoveTool(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('move');
  });
  await page.waitForTimeout(100);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function readComposite(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(async () => {
    return (window as unknown as { __readCompositedPixels: () => Promise<PixelSnapshot | null> }).__readCompositedPixels();
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function countBlackInRect(
  snap: PixelSnapshot,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const sx = Math.floor((x0 / 1920) * snap.width);
  const ex = Math.ceil((x1 / 1920) * snap.width);
  const sy = Math.floor((y0 / 1080) * snap.height);
  const ey = Math.ceil((y1 / 1080) * snap.height);
  let count = 0;
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const i = (y * snap.width + x) * 4;
      const r = snap.pixels[i] ?? 0;
      const g = snap.pixels[i + 1] ?? 0;
      const b = snap.pixels[i + 2] ?? 0;
      const a = snap.pixels[i + 3] ?? 0;
      if (a > 50 && r < 60 && g < 60 && b < 60) count++;
    }
  }
  return count;
}

test.describe('Align then brush — brush paints at cursor, not offset by alignment', () => {
  test('brush top-left after aligning rect bottom-right lands in top-left', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1920, 1080, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const getLayerState = () => page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
      };
      const s = store.getState();
      const l = s.document.layers.find((l) => l.id === s.document.activeLayerId);
      return l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null;
    });

    await setBrush(page, 8);
    await paintRectWithBrush(page, 50, 50, 50, 100);
    console.log('after paint:', await getLayerState());
    await page.screenshot({ path: 'test-results/align-then-brush/01-after-paint.png' });

    await selectMoveTool(page);
    await clickAlign(page, 'Align right');
    console.log('after align right:', await getLayerState());
    await page.screenshot({ path: 'test-results/align-then-brush/02-after-right.png' });
    await clickAlign(page, 'Align bottom');
    console.log('after align bottom:', await getLayerState());
    await page.screenshot({ path: 'test-results/align-then-brush/03-after-bottom.png' });

    // Back to brush, paint a dot in the TOP-LEFT at (50, 50).
    await setBrush(page, 20);
    await brushDotAt(page, 50, 50);
    console.log('after brush dot:', await getLayerState());

    await page.screenshot({ path: 'test-results/align-then-brush/final.png' });

    // Read the active layer's pixel data directly from the WASM engine.
    // After the brush dot, layer should be at (0, 0) covering the full
    // doc + offset from the aligned rect. We expect:
    //  - Black near texture-local (50, 50) — the new brush dot (doc 50, 50)
    //  - Black near texture-local (L.x+original_rect_x, L.y+original_rect_y)
    //    — the old rect shifted into the expanded texture.
    const layer = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
      };
      const s = store.getState();
      return s.document.layers.find((l) => l.id === s.document.activeLayerId)!;
    });
    // Process pixels in-browser to avoid transferring a large array across
    // the evaluate boundary (a full-doc texture easily exceeds serialization
    // limits and crashes the worker).
    const counts = await page.evaluate(async (input: { id: string; lx: number; ly: number }) => {
      const read = (window as unknown as { __readLayerPixels?: (id: string) => Promise<{ width: number; height: number; pixels: number[] | Uint8Array } | null> }).__readLayerPixels;
      if (!read) return null;
      const p = await read(input.id);
      if (!p) return null;
      const w = p.width;
      const h = p.height;
      const data = p.pixels as unknown as { [i: number]: number; length: number };
      // Find bounding box(es) of black content in the texture.
      // Also count in the two expected regions.
      let allMinX = w, allMinY = h, allMaxX = -1, allMaxY = -1, totalBlack = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const rC = data[i] ?? 0;
          const gC = data[i + 1] ?? 0;
          const bC = data[i + 2] ?? 0;
          const aC = data[i + 3] ?? 0;
          if (aC > 50 && rC < 60 && gC < 60 && bC < 60) {
            totalBlack++;
            if (x < allMinX) allMinX = x;
            if (y < allMinY) allMinY = y;
            if (x > allMaxX) allMaxX = x;
            if (y > allMaxY) allMaxY = y;
          }
        }
      }
      const countBlack = (cx: number, cy: number, r: number): number => {
        let n = 0;
        for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
          for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
            const i = (y * w + x) * 4;
            const rC = data[i] ?? 0;
            const gC = data[i + 1] ?? 0;
            const bC = data[i + 2] ?? 0;
            const aC = data[i + 3] ?? 0;
            if (aC > 50 && rC < 60 && gC < 60 && bC < 60) n++;
          }
        }
        return n;
      };
      return {
        width: w, height: h,
        totalBlack,
        bbox: totalBlack > 0 ? { minX: allMinX, minY: allMinY, maxX: allMaxX, maxY: allMaxY } : null,
        dotBlack: countBlack(50 - input.lx, 50 - input.ly, 30),
        rectBlack: countBlack(1870 - input.lx, 980 - input.ly, 60),
      };
    }, { id: layer.id, lx: layer.x, ly: layer.y });

    if (!counts) throw new Error('No __readLayerPixels helper');

    console.log(`layer ${layer.width}x${layer.height} at (${layer.x},${layer.y})`);
    console.log(`texture ${counts.width}x${counts.height}`);
    console.log(`total black pixels: ${counts.totalBlack}`);
    console.log(`black bbox:`, counts.bbox);
    console.log(`dot area black (at texture ${50 - layer.x},${50 - layer.y}): ${counts.dotBlack}`);
    console.log(`rect area black (at texture ${1870 - layer.x},${980 - layer.y}): ${counts.rectBlack}`);

    const comp = await page.evaluate(async () => {
      const read = (window as unknown as { __readCompositedPixels?: () => Promise<{ width: number; height: number; pixels: number[] | Uint8Array } | null> }).__readCompositedPixels;
      if (!read) return null;
      const p = await read();
      if (!p) return null;
      const w = p.width, h = p.height;
      const data = p.pixels as unknown as { [i: number]: number; length: number };
      let minX = w, minY = h, maxX = -1, maxY = -1, total = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0, a = data[i + 3] ?? 0;
          if (a > 50 && r < 60 && g < 60 && b < 60) {
            total++;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { width: w, height: h, total, bbox: total > 0 ? { minX, minY, maxX, maxY } : null };
    });
    console.log('COMPOSITE:', comp);

    // The new brush dot (doc 50,50) must be in the top-left region of
    // the texture — NOT offset by the aligned rect's position.
    expect(counts.dotBlack).toBeGreaterThan(100);
    expect(counts.rectBlack).toBeGreaterThan(500);
  });
});
