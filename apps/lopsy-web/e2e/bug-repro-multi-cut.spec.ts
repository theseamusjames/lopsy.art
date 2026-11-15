/**
 * Regression coverage for issue #224 — sequential cut() calls on a
 * shape-drawn disc must not wipe pixels far outside the selected stripes.
 *
 * The reported scenario:
 *   1. 800x600 doc with default white background.
 *   2. Add a new layer.
 *   3. Draw a yellow ellipse via the shape tool (drag center→edge).
 *   4. Marquee {x:260, y:325, w:280, h:5} → cut.
 *   5. Marquee {x:260, y:370, w:280, h:10} → cut.
 *
 * The disc must still be visible with two thin stripes cut out; pixels
 * far above the cuts (e.g. (400, 220), (400, 200), (340/460, 300)) must
 * still be yellow on the active layer.
 *
 * The test also covers a more aggressive 4-stripe variant that catches
 * the same family of regression with extra cuts.
 */
import { test, expect, type Page } from './fixtures';
import {
  selectTool,
  setForegroundColor,
  docToScreen,
} from './helpers';

async function createDocument(page: Page, width: number, height: number, transparent = false) {
  await page.evaluate(({ w, h, t }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(w, h, t);
  }, { w: width, h: height, t: transparent });
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
  await page.waitForSelector('[data-testid="canvas-container"]');
}

async function setSelection(page: Page, x: number, y: number, w: number, h: number) {
  await page.evaluate(({ x, y, w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        setSelection: (
          bounds: { x: number; y: number; width: number; height: number },
          mask: Uint8ClampedArray, maskWidth: number, maskHeight: number,
        ) => void;
      };
    };
    const state = store.getState();
    const maskW = state.document.width;
    const maskH = state.document.height;
    const mask = new Uint8ClampedArray(maskW * maskH);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px >= 0 && px < maskW && py >= 0 && py < maskH) {
          mask[py * maskW + px] = 255;
        }
      }
    }
    state.setSelection({ x, y, width: w, height: h }, mask, maskW, maskH);
  }, { x, y, w, h });
}

async function cutViaStore(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { cut: () => void };
    };
    store.getState().cut();
  });
}

/** Read a single pixel from the active layer's GPU texture at doc-space (x, y). */
async function readLayerPixel(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(async ({ x, y, lid }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const state = store.getState();
    const id = lid ?? state.document.activeLayerId;
    const layer = state.document.layers.find((l) => l.id === id);
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const localX = x - lx;
    const localY = y - ly;
    if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const idx = (localY * result.width + localX) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x, y, lid: layerId ?? null });
}

test.describe('Issue #224: sequential cut() calls', () => {
  // ERR_CERT_AUTHORITY_INVALID fires from external Google Fonts in the
  // test environment and is unrelated to the bug under test.
  test.use({ allowConsoleErrors: [/ERR_CERT_AUTHORITY_INVALID/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  });

  test('two stripe cuts on a yellow disc preserve pixels far from the cuts', async ({ page }) => {
    // 800x600 white doc.
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(200);

    // Add a fresh layer for the disc so the background stays white.
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(150);

    // Draw a yellow ellipse via the shape tool, dragging from doc center
    // (400, 300) → (530, 430) — the shape tool treats the start point as the
    // ellipse centre, so this produces a 260px-wide disc centred at (400, 300).
    // (The drawEllipse helper drags corner-to-corner and would produce a
    // very different shape; mimic the bug-report drag path manually.)
    await setForegroundColor(page, 255, 220, 0);
    await selectTool(page, 'shape');
    await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
    const start = await docToScreen(page, 400, 300);
    const end = await docToScreen(page, 530, 430);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/multi-cut-before.png' });

    // Sanity: the disc should be drawn — pixel at (400, 220) should be yellow.
    const before = await readLayerPixel(page, 400, 220);
    expect(before.r).toBeGreaterThan(200);
    expect(before.g).toBeGreaterThan(150);
    expect(before.b).toBeLessThan(120);

    // First cut: thin horizontal stripe at y=325..330.
    await setSelection(page, 260, 325, 280, 5);
    await page.waitForTimeout(100);
    await cutViaStore(page);
    await page.waitForTimeout(200);

    // After cut #1, pixel above the cut should still be yellow.
    const afterCut1 = await readLayerPixel(page, 400, 220);
    expect(afterCut1.b).toBeLessThan(120);

    // Second cut: thin horizontal stripe at y=370..380.
    await setSelection(page, 260, 370, 280, 10);
    await page.waitForTimeout(100);
    await cutViaStore(page);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/multi-cut-after.png' });

    // Bug assertion: pixel at (400, 220) — far above both cuts — must
    // still be yellow. If the entire disc was wiped, the pixel reads
    // pure white (b=255) instead.
    const afterCut2 = await readLayerPixel(page, 400, 220);
    expect(afterCut2.b).toBeLessThan(120);
    expect(afterCut2.r).toBeGreaterThan(200);
    expect(afterCut2.g).toBeGreaterThan(150);

    // Probe several other pixels around the disc that should still be
    // yellow — any wholesale wipe would clear these too.
    for (const [px, py] of [[400, 200], [340, 300], [460, 300], [400, 250]] as const) {
      const p = await readLayerPixel(page, px, py);
      expect(p.b, `pixel (${px}, ${py})`).toBeLessThan(120);
      expect(p.r, `pixel (${px}, ${py})`).toBeGreaterThan(200);
    }

    // The cut stripes themselves must read transparent (cleared) on the
    // layer texture so we know the cut actually did something — guards
    // against a stub regression where cut() silently no-ops.
    const inCut1 = await readLayerPixel(page, 400, 327);
    expect(inCut1.a).toBe(0);

    const inCut2 = await readLayerPixel(page, 400, 374);
    expect(inCut2.a).toBe(0);
  });

  test('four sequential stripe cuts on a yellow disc preserve disc body', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(200);

    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(150);

    await setForegroundColor(page, 255, 220, 0);
    await selectTool(page, 'shape');
    await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
    const start = await docToScreen(page, 400, 300);
    const end = await docToScreen(page, 530, 430);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Four thin horizontal stripe cuts within the disc.
    const stripes: Array<[number, number, number, number]> = [
      [260, 240, 280, 4],
      [260, 280, 280, 4],
      [260, 320, 280, 4],
      [260, 360, 280, 4],
    ];
    for (const [sx, sy, sw, sh] of stripes) {
      await setSelection(page, sx, sy, sw, sh);
      await page.waitForTimeout(80);
      await cutViaStore(page);
      await page.waitForTimeout(150);
    }

    // Pixel above the first cut should still be yellow.
    const top = await readLayerPixel(page, 400, 200);
    expect(top.b).toBeLessThan(120);
    expect(top.r).toBeGreaterThan(200);

    // Pixels between the cuts (e.g. y=260, y=300) should still be yellow.
    const between1 = await readLayerPixel(page, 400, 260);
    expect(between1.b).toBeLessThan(120);
    expect(between1.r).toBeGreaterThan(200);

    const between2 = await readLayerPixel(page, 400, 300);
    expect(between2.b).toBeLessThan(120);
    expect(between2.r).toBeGreaterThan(200);

    // Pixel below the last cut should still be yellow.
    const bottom = await readLayerPixel(page, 400, 410);
    expect(bottom.b).toBeLessThan(120);
    expect(bottom.r).toBeGreaterThan(200);
  });
});
