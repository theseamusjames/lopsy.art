import { test, expect } from './fixtures';
import { createDocument, waitForStore, getPixelAt, setForegroundColor, selectTool, drawRect } from './helpers';

// Regression tests for #667:
//   1. Empty-layer fast path — filling an empty layer should just work
//      (this was the reported "lag" case on 5000x4000 canvases).
//   2. Non-contiguous fill fast path — must produce the same pixels as
//      the old readback+CPU-flood path.
//   3. Fill with an active selection stays constrained to the selection.

test.describe('#667 bucket fill fast paths', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'bucket fill tests use desktop pointer events');
    await page.goto('/');
    await waitForStore(page);
  });

  test('empty-layer fast path fills the entire layer with the fg color', async ({ page }) => {
    // Transparent doc so the initial raster layer is empty.
    await createDocument(page, 400, 300, true);
    await selectTool(page, 'fill');
    await setForegroundColor(page, 30, 200, 60);

    // Click anywhere — no need to be near content.
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      const rect = container.getBoundingClientRect();
      const ev = (type: string) => new PointerEvent(type, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons: 1,
        pointerType: 'mouse',
        pointerId: 1,
        bubbles: true,
      });
      container.dispatchEvent(ev('pointerdown'));
      container.dispatchEvent(ev('pointerup'));
    });
    await page.waitForTimeout(300);

    // Every corner should now be the fill color — a corner is a spot the
    // CPU flood fill would reach only after walking through the whole
    // layer, so this exercises the "fill covers everything" outcome.
    for (const [x, y] of [[10, 10], [390, 10], [10, 290], [390, 290], [200, 150]]) {
      const p = await getPixelAt(page, x, y);
      expect(p.r, `pixel r@(${x},${y})`).toBe(30);
      expect(p.g, `pixel g@(${x},${y})`).toBe(200);
      expect(p.b, `pixel b@(${x},${y})`).toBe(60);
      expect(p.a, `pixel a@(${x},${y})`).toBe(255);
    }
  });

  test('non-contiguous GPU fill turns every red pixel green regardless of gap', async ({ page }) => {
    await createDocument(page, 400, 300, true);

    // Paint two disconnected red patches — a contiguous fill from one
    // would only fill that patch, but non-contiguous must fill both.
    await drawRect(page, 50, 50, 40, 40, { r: 255, g: 0, b: 0 });
    await drawRect(page, 300, 200, 40, 40, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(100);

    // Non-contiguous fill via UI.
    await selectTool(page, 'fill');
    await page.evaluate(() => {
      const store = (window as unknown as { __toolSettingsStore: { getState: () => { setFillSetting: (k: string, v: number | boolean) => void } } }).__toolSettingsStore;
      store.getState().setFillSetting('contiguous', false);
      store.getState().setFillSetting('tolerance', 10);
    });
    await setForegroundColor(page, 0, 255, 0);

    // Click on one of the red patches.
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      const rect = container.getBoundingClientRect();
      const state = (window as unknown as { __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } } }).__editorStore.getState();
      const cx = rect.width / 2, cy = rect.height / 2;
      const docX = 70, docY = 70;
      const sx = rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
      const sy = rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
      const ev = (type: string) => new PointerEvent(type, {
        clientX: sx, clientY: sy, button: 0, buttons: 1,
        pointerType: 'mouse', pointerId: 1, bubbles: true,
      });
      container.dispatchEvent(ev('pointerdown'));
      container.dispatchEvent(ev('pointerup'));
    });
    await page.waitForTimeout(300);

    // Both patches should be green now.
    const leftPatch = await getPixelAt(page, 70, 70);
    const rightPatch = await getPixelAt(page, 320, 220);
    expect(leftPatch.g).toBeGreaterThan(200);
    expect(leftPatch.r).toBeLessThan(50);
    expect(rightPatch.g).toBeGreaterThan(200);
    expect(rightPatch.r).toBeLessThan(50);
  });

  test('empty-layer fast path respects an active selection', async ({ page }) => {
    await createDocument(page, 400, 300, true);

    // Rectangle-select the left half of the doc.
    await page.evaluate(() => {
      type Rect = { x: number; y: number; width: number; height: number };
      const store = (window as unknown as {
        __editorStore: {
          getState: () => {
            setSelection: (b: Rect, mask: Uint8ClampedArray, w: number, h: number) => void;
            document: { width: number; height: number };
          };
        };
      }).__editorStore.getState();
      const w = store.document.width, h = store.document.height;
      const mask = new Uint8ClampedArray(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < Math.floor(w / 2); x++) {
          mask[y * w + x] = 255;
        }
      }
      store.setSelection({ x: 0, y: 0, width: Math.floor(w / 2), height: h }, mask, w, h);
    });

    await selectTool(page, 'fill');
    await setForegroundColor(page, 255, 128, 0);
    // Click at doc (50, 150) — inside the left-half selection.
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      const rect = container.getBoundingClientRect();
      const state = (window as unknown as { __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } } }).__editorStore.getState();
      const cx = rect.width / 2, cy = rect.height / 2;
      const docX = 50, docY = 150;
      const sx = rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
      const sy = rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
      const ev = (type: string) => new PointerEvent(type, {
        clientX: sx, clientY: sy, button: 0, buttons: 1,
        pointerType: 'mouse', pointerId: 1, bubbles: true,
      });
      container.dispatchEvent(ev('pointerdown'));
      container.dispatchEvent(ev('pointerup'));
    });
    await page.waitForTimeout(300);

    // Left half filled, right half untouched.
    const left = await getPixelAt(page, 50, 150);
    const right = await getPixelAt(page, 350, 150);
    expect(left.r).toBeGreaterThan(200);
    expect(right.a).toBe(0);
  });
});
