import { test, expect, type Page } from './fixtures';

// Reproduces the user-reported bug: after centering an aligned layer,
// drawing a brush STROKE (not just a dot) appears scaled/stretched and
// far from the cursor path. Stroke is a diagonal drag from top-left to
// bottom-right; painted pixels must sit along that diagonal at brush size.

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
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
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

async function clickAlign(page: Page, label: string) {
  await page.locator(`button[aria-label="${label}"]`).click();
  await page.waitForTimeout(250);
}

async function selectMoveTool(page: Page) {
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
}

async function brushDiagonalDrag(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const s = await docToScreen(page, fromX, fromY);
  const e = await docToScreen(page, toX, toY);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  // Multi-step drag so interpolateWithSpacing fires many dabs along the path
  await page.mouse.move(e.x, e.y, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test('Centered then stroked — stroke follows drag path, not stretched', async ({ page, isMobile }) => {
  test.skip(isMobile, 'compositing precision test requires larger viewport');
  test.setTimeout(120_000);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1920, 1080, true);
  await page.waitForSelector('[data-testid="canvas-container"]');

  // Step 1: paint a small mark in the top-left (50–100 x 50–150)
  await setBrush(page, 8);
  await paintRectWithBrush(page, 50, 50, 50, 100);

  // Step 2: center it using align buttons
  await selectMoveTool(page);
  await clickAlign(page, 'Align center horizontally');
  await clickAlign(page, 'Align center vertically');

  const beforeStroke = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
    };
    const s = store.getState();
    const l = s.document.layers.find((l) => l.id === s.document.activeLayerId);
    return l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null;
  });
  console.log('before stroke:', beforeStroke);

  // Step 3: draw a diagonal stroke from (200, 200) to (600, 600)
  await setBrush(page, 20);
  await brushDiagonalDrag(page, 200, 200, 600, 600);

  const afterStroke = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
    };
    const s = store.getState();
    const l = s.document.layers.find((l) => l.id === s.document.activeLayerId);
    return l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null;
  });
  console.log('after stroke:', afterStroke);

  await page.screenshot({ path: 'test-results/align-then-stroke-scale/final.png', fullPage: false });

  // The bug shows up in the composited output, not the layer texture — the
  // layer bake is correct, but compositing with an oversized layer leaks the
  // wrong viewport state into blend passes that write to doc-sized scratch.
  // Read the composited screen pixels and verify the stroke lands where the
  // drag path predicts (in screen space).
  const probe = await page.evaluate(async () => {
    const read = (window as unknown as { __readCompositedPixels?: () => Promise<{ width: number; height: number; pixels: number[] } | null> }).__readCompositedPixels;
    if (!read) return null;
    const p = await read();
    if (!p) return null;
    const w = p.width, h = p.height;
    const data = p.pixels;

    // readPixels returns bottom-up; flip y when sampling.
    // Find bbox of dark pixels (stroke + rect).
    let minX = w, minY = h, maxX = -1, maxY = -1;
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((h - 1 - y) * w + x) * 4;
        const r = data[i] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a > 200 && r < 30) {
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

  console.log('composite probe:', probe);
  if (!probe || !probe.bbox) throw new Error('No dark pixels in composite');

  // Diagonal drag 200→600 in doc space has equal X and Y extent. In the
  // composite, this maps to equal screen-pixel extent (centered rect is
  // small enough that its contribution is near the center). Stretching on
  // one axis means extentX / extentY significantly ≠ 1.
  // Test: diagonal stroke extent should be roughly square — drag is 400x400
  // in doc space, so any scaled version is still square. If blend passes
  // compound-stretch on X, extentX will exceed extentY by ~2x.
  //
  // Sample the stroke-only region: the rect is small and near the center of
  // the composite, while the stroke diagonal runs near the top-left. Use
  // samples within the diagonal path region (screen top-left quadrant) only,
  // ignoring the rect region at the center.

  // Compute where doc (200,200) and (600,600) map to screen pixels. Use the
  // main canvas (the one inside the canvas-container, not the overlay).
  const mapped = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const s = store.getState();
    const container = document.querySelector('[data-testid="canvas-container"]');
    const canvas = container?.querySelector('canvas:first-of-type') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const cw = canvas.width;
    const ch = canvas.height;
    const toScreen = (dx: number, dy: number) => ({
      x: (dx - s.document.width / 2) * s.viewport.zoom + s.viewport.panX + cw / 2,
      y: (dy - s.document.height / 2) * s.viewport.zoom + s.viewport.panY + ch / 2,
    });
    return { cw, ch, start: toScreen(200, 200), end: toScreen(600, 600) };
  });
  if (!mapped) throw new Error('Canvas not found');
  console.log('expected screen stroke:', mapped);

  const expectedExtentX = Math.abs(mapped.end.x - mapped.start.x);
  const expectedExtentY = Math.abs(mapped.end.y - mapped.start.y);
  console.log(`expected ~${expectedExtentX.toFixed(0)}x${expectedExtentY.toFixed(0)}`);

  // Count dark pixels ONLY in the expected stroke region (with some margin).
  // Outside this region = stretching artifact.
  const strokeRegion = await page.evaluate(async (region) => {
    const read = (window as unknown as { __readCompositedPixels?: () => Promise<{ width: number; height: number; pixels: number[] } | null> }).__readCompositedPixels;
    if (!read) return null;
    const p = await read();
    if (!p) return null;
    const w = p.width, h = p.height;
    const data = p.pixels;
    let inside = 0, outside = 0;
    const padX = 40, padY = 40;
    const xmin = Math.min(region.sx, region.ex) - padX;
    const xmax = Math.max(region.sx, region.ex) + padX;
    const ymin = Math.min(region.sy, region.ey) - padY;
    const ymax = Math.max(region.sy, region.ey) + padY;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((h - 1 - y) * w + x) * 4;
        const rv = data[i] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a > 200 && rv < 30) {
          if (x >= xmin && x <= xmax && y >= ymin && y <= ymax) inside++;
          else {
            // Skip pixels near the centered rect (small 50x100 region around doc center).
            // We don't have its exact screen coords here; a large margin of
            // 150 around the canvas center is enough to exclude it.
            const cx = w / 2, cy = h / 2;
            const dx = x - cx, dy = y - cy;
            if (Math.abs(dx) > 150 || Math.abs(dy) > 150) outside++;
          }
        }
      }
    }
    return { inside, outside };
  }, { sx: mapped.start.x, sy: mapped.start.y, ex: mapped.end.x, ey: mapped.end.y });

  console.log('stroke-region pixel counts:', strokeRegion);
  if (!strokeRegion) throw new Error('strokeRegion probe failed');

  // Stroke should have pixels inside the expected diagonal region.
  expect(strokeRegion.inside, 'no stroke pixels in expected screen region').toBeGreaterThan(200);
  // And no significant pixels outside the expected region (ignoring the rect
  // area near the center). If compositing stretches, the stroke bleeds outside.
  expect(strokeRegion.outside, 'dark pixels outside expected stroke region — composite is stretched').toBeLessThan(200);
});
