import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
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
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function paintDocContent(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: () => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const dw = state.document.width;
    const dh = state.document.height;
    const data = new ImageData(dw, dh);
    for (let py = 0; py < dh; py++) {
      for (let px = 0; px < dw; px++) {
        const idx = (py * dw + px) * 4;
        data.data[idx] = Math.floor((px / dw) * 255);
        data.data[idx + 1] = Math.floor((py / dh) * 200);
        data.data[idx + 2] = 100;
        data.data[idx + 3] = 255;
      }
    }
    state.pushHistory();
    state.updateLayerPixelData(id, data);
  });
  await page.waitForTimeout(300);
}

/** Read overlay canvas pixel data at a screen position. */
async function readOverlayAt(page: Page, screenX: number, screenY: number) {
  return page.evaluate(
    ({ sx, sy }) => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { r: 0, g: 0, b: 0, a: 0 };
      const canvases = container.querySelectorAll('canvas');
      let overlay: HTMLCanvasElement | null = null;
      for (const c of canvases) {
        if (c.className.includes('overlay')) {
          overlay = c;
          break;
        }
      }
      if (!overlay) return { r: 0, g: 0, b: 0, a: 0 };
      const ctx = overlay.getContext('2d');
      if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
      const rect = overlay.getBoundingClientRect();
      const px = Math.round(sx - rect.left);
      const py = Math.round(sy - rect.top);
      if (px < 0 || py < 0 || px >= overlay.width || py >= overlay.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const imgData = ctx.getImageData(px, py, 1, 1);
      return {
        r: imgData.data[0] ?? 0,
        g: imgData.data[1] ?? 0,
        b: imgData.data[2] ?? 0,
        a: imgData.data[3] ?? 0,
      };
    },
    { sx: screenX, sy: screenY },
  );
}

/** Count non-transparent pixels in a region of the overlay canvas. */
async function countOverlayPixels(
  page: Page,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
  threshold = 5,
) {
  return page.evaluate(
    ({ sx, sy, w, h, threshold }) => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return 0;
      const canvases = container.querySelectorAll('canvas');
      let overlay: HTMLCanvasElement | null = null;
      for (const c of canvases) {
        if (c.className.includes('overlay')) {
          overlay = c;
          break;
        }
      }
      if (!overlay) return 0;
      const ctx = overlay.getContext('2d');
      if (!ctx) return 0;
      const rect = overlay.getBoundingClientRect();
      const px = Math.round(sx - rect.left);
      const py = Math.round(sy - rect.top);
      const imgData = ctx.getImageData(px, py, w, h);
      let count = 0;
      for (let i = 3; i < imgData.data.length; i += 4) {
        if ((imgData.data[i] ?? 0) > threshold) count++;
      }
      return count;
    },
    { sx: screenX, sy: screenY, w: width, h: height, threshold },
  );
}

test.describe('Stamp & Heal Cursor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await paintDocContent(page);
  });

  test('healing brush shows circular cursor on canvas', async ({ page }) => {
    await page.keyboard.press('h');
    await page.waitForTimeout(100);

    const center = await docToScreen(page, 200, 150);
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/stamp-heal-cursor-01-heal-cursor.png' });

    const pixel = await readOverlayAt(page, center.x, center.y);
    const region = await countOverlayPixels(
      page,
      center.x - 30, center.y - 30,
      60, 60,
    );
    expect(region).toBeGreaterThan(0);
  });

  test('clone stamp shows circular cursor on canvas', async ({ page }) => {
    await page.keyboard.press('s');
    await page.waitForTimeout(100);

    const center = await docToScreen(page, 200, 150);
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/stamp-heal-cursor-02-stamp-cursor.png' });

    const region = await countOverlayPixels(
      page,
      center.x - 30, center.y - 30,
      60, 60,
    );
    expect(region).toBeGreaterThan(0);
  });

  test('clone stamp shows source preview after alt+click', async ({ page }) => {
    await page.keyboard.press('s');
    await page.waitForTimeout(100);

    const source = await docToScreen(page, 50, 50);
    await page.mouse.move(source.x, source.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);

    const cursor = await docToScreen(page, 250, 200);
    await page.mouse.move(cursor.x, cursor.y);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/stamp-heal-cursor-03-stamp-preview.png' });

    const previewPixels = await countOverlayPixels(
      page,
      cursor.x - 20, cursor.y - 20,
      40, 40,
    );
    expect(previewPixels).toBeGreaterThan(10);
  });

  test('healing brush shows source preview after alt+click', async ({ page }) => {
    await page.keyboard.press('h');
    await page.waitForTimeout(100);

    const source = await docToScreen(page, 50, 50);
    await page.mouse.move(source.x, source.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);

    const cursor = await docToScreen(page, 250, 200);
    await page.mouse.move(cursor.x, cursor.y);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/stamp-heal-cursor-04-heal-preview.png' });

    const previewPixels = await countOverlayPixels(
      page,
      cursor.x - 20, cursor.y - 20,
      40, 40,
    );
    expect(previewPixels).toBeGreaterThan(10);
  });
});
