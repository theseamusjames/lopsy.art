import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor } from './helpers';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300) {
  await page.evaluate(({ w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(w, h, true);
  }, { w: width, h: height });
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
  return page.evaluate(({ docX, docY }) => {
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
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
      y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
    };
  }, { docX, docY });
}

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function readLayerPixelAt(page: Page, docX: number, docY: number) {
  return page.evaluate(async ({ docX, docY }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
        pushHistory: (label: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const layer = state.document.layers.find((l) => l.id === id);
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    state.pushHistory('Flush');
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const localX = docX - lx;
    const localY = docY - ly;
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
  }, { docX, docY });
}

test.describe('Brush color coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
  });

  test('black brush covers green on transparent layer', async ({ page }) => {
    await setToolOption(page, 'Size', 80);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    // Step 1: Paint black across the center
    await setForegroundColor(page, 0, 0, 0);
    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 15);

    // Step 2: Paint green over the same area
    await setForegroundColor(page, 0, 255, 0);
    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 15);

    // Step 3: Paint black over the green
    await setForegroundColor(page, 0, 0, 0);
    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 15);

    await page.screenshot({ path: 'e2e/screenshots/brush-color-coverage.png' });

    // Read the layer pixels at the center of the stroke (pushHistory
    // finalizes the pending stroke so the layer texture is up to date)
    const center = await readLayerPixelAt(page, 200, 150);

    // The center pixel should be fully opaque black.
    // With 100% hardness and 100% opacity, black must completely cover green.
    expect(center.a).toBeGreaterThan(200);
    expect(center.r).toBeLessThan(10);
    expect(center.g).toBeLessThan(10);
    expect(center.b).toBeLessThan(10);
  });

  test('dark color covers bright color at full opacity', async ({ page }) => {
    await setToolOption(page, 'Size', 80);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    // Paint bright yellow
    await setForegroundColor(page, 255, 255, 0);
    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 15);

    // Paint dark blue over it
    await setForegroundColor(page, 0, 0, 128);
    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 15);

    await page.screenshot({ path: 'e2e/screenshots/brush-dark-over-bright.png' });

    const center = await readLayerPixelAt(page, 200, 150);
    // Dark blue should fully cover yellow at the center
    expect(center.a).toBeGreaterThan(200);
    expect(center.r).toBeLessThan(10);
    expect(center.g).toBeLessThan(10);
    expect(center.b).toBeGreaterThan(100);
  });

  test('color replacement across three strokes', async ({ page }) => {
    test.setTimeout(600_000);
    await setToolOption(page, 'Size', 60);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    // Stroke 1: Red
    await setForegroundColor(page, 255, 0, 0);
    await drawStroke(page, { x: 150, y: 150 }, { x: 250, y: 150 }, 10);

    // Stroke 2: Green over red
    await setForegroundColor(page, 0, 255, 0);
    await drawStroke(page, { x: 150, y: 150 }, { x: 250, y: 150 }, 10);

    // Stroke 3: Blue over green
    await setForegroundColor(page, 0, 0, 255);
    await drawStroke(page, { x: 150, y: 150 }, { x: 250, y: 150 }, 10);

    await page.screenshot({ path: 'e2e/screenshots/brush-three-color-replace.png' });

    const center = await readLayerPixelAt(page, 200, 150);
    // The final color should be blue — earlier colors fully replaced
    expect(center.a).toBeGreaterThan(200);
    expect(center.r).toBeLessThan(10);
    expect(center.g).toBeLessThan(10);
    expect(center.b).toBeGreaterThan(200);
  });

  test('black single click covers green single click', async ({ page }) => {
    await setToolOption(page, 'Size', 100);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);

    const centerScreen = await docToScreen(page, 200, 150);

    // Click once with green
    await setForegroundColor(page, 0, 255, 0);
    await page.mouse.click(centerScreen.x, centerScreen.y);
    await page.waitForTimeout(300);

    // Click once with black at the same spot
    await setForegroundColor(page, 0, 0, 0);
    await page.mouse.click(centerScreen.x, centerScreen.y);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/brush-black-click-over-green.png' });

    const center = await readLayerPixelAt(page, 200, 150);

    // Black should fully cover green at the center of the click
    expect(center.a).toBeGreaterThan(200);
    expect(center.r).toBeLessThan(10);
    expect(center.g).toBeLessThan(10);
    expect(center.b).toBeLessThan(10);
  });
});
