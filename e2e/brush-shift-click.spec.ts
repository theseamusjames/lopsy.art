import { test, expect, type Page } from '@playwright/test';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 600, height = 300) {
  await page.evaluate(({ w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
    };
    store.getState().createDocument(w, h, false);
  }, { w: width, h: height });
  await page.waitForTimeout(300);
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

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function setUIState(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function readCompositedPixelAt(page: Page, docX: number, docY: number) {
  return page.evaluate(async ({ docX, docY }) => {
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
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    if (!container) return { r: 0, g: 0, b: 0, a: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
    const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(screenX * dpr);
    const py = result.height - 1 - Math.round(screenY * dpr);
    if (px < 0 || px >= result.width || py < 0 || py >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
    const idx = (py * result.width + px) * 4;
    return { r: result.pixels[idx] ?? 0, g: result.pixels[idx + 1] ?? 0, b: result.pixels[idx + 2] ?? 0, a: result.pixels[idx + 3] ?? 0 };
  }, { docX, docY });
}

test('shift-click line has uniform opacity — no darker circle at start', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 300);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(500);

  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolSetting(page, 'setBrushSize', 40);
  await setToolSetting(page, 'setBrushHardness', 100);
  await setToolSetting(page, 'setBrushOpacity', 30);
  await setToolSetting(page, 'setBrushSpacing', 0);
  await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });

  // Step 1: Click at the left to place initial point (no drag)
  const left = await docToScreen(page, 100, 150);
  await page.mouse.click(left.x, left.y);
  await page.waitForTimeout(400);

  // Step 2: Shift-click at the right to draw a straight line
  const right = await docToScreen(page, 500, 150);
  await page.keyboard.down('Shift');
  await page.mouse.click(right.x, right.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'test-results/screenshots/shift-click-line.png' });

  // Sample at the start point (100, 150), midpoint (300, 150), and end (500, 150)
  const pxStart = await readCompositedPixelAt(page, 100, 150);
  const pxMid = await readCompositedPixelAt(page, 300, 150);
  const pxEnd = await readCompositedPixelAt(page, 500, 150);

  console.log('Start:', pxStart);
  console.log('Mid:  ', pxMid);
  console.log('End:  ', pxEnd);

  // All three points should have similar G values (red over white)
  // With 30% red opacity: G ≈ 255 * 0.7 = 179
  // The start point should NOT be darker (lower G) than the midpoint
  const tolerance = 15;
  expect(Math.abs(pxStart.g - pxMid.g)).toBeLessThan(tolerance);
  expect(Math.abs(pxEnd.g - pxMid.g)).toBeLessThan(tolerance);
});
