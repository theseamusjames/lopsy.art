import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, setBrushModalOption, closeBrushModal } from './helpers';

// #666: while shift-click drawing a straight line with a paint tool,
// holding cmd/meta should snap the second click to the nearest 15°
// angle relative to the origin point — mirroring the gradient tool.

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, w = 600, h = 400) {
  await page.evaluate(({ w, h }) => {
    (window as unknown as { __editorStore: { getState: () => { createDocument: (w: number, h: number, t: boolean) => void } } }).__editorStore
      .getState()
      .createDocument(w, h, false);
  }, { w, h });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __editorStore?: { getState: () => { document: { layers: unknown[] }; undoStack: unknown[] } } }).__editorStore;
    if (!s) return false;
    const st = s.getState();
    return st.document.layers.length > 0 && st.undoStack.length > 0;
  });
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(({ docX, docY }) => {
    const state = (window as unknown as { __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } } }).__editorStore.getState();
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
      y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
    };
  }, { docX, docY });
}

async function readPixelAt(page: Page, docX: number, docY: number) {
  return page.evaluate(async ({ docX, docY }) => {
    const readFn = (window as unknown as { __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] } | null> }).__readCompositedPixels;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const state = (window as unknown as { __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } } }).__editorStore.getState();
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const sx = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
    const sy = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
    const px = Math.round(sx);
    const py = result.height - 1 - Math.round(sy);
    if (px < 0 || px >= result.width || py < 0 || py >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
    const idx = (py * result.width + px) * 4;
    return { r: result.pixels[idx]!, g: result.pixels[idx + 1]!, b: result.pixels[idx + 2]!, a: result.pixels[idx + 3]! };
  }, { docX, docY });
}

test('shift+cmd click snaps the brush line to the nearest 15° angle (#666)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'meta modifier not available on touch');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(400);

  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolOption(page, 'Size', 10);
  await setToolOption(page, 'Hardness', 100);
  await setToolOption(page, 'Opacity', 100);
  await setBrushModalOption(page, 'Spacing', 5);
  await closeBrushModal(page);
  await setForegroundColor(page, 255, 0, 0);

  // 1. Click at (200, 200) to place the origin.
  const origin = await docToScreen(page, 200, 200);
  await page.mouse.click(origin.x, origin.y);
  await page.waitForTimeout(300);

  // 2. Shift + cmd click at (400, 200 + 3) — i.e. ~1° below horizontal.
  //    Without cmd, that would draw a very slightly diagonal line.
  //    With cmd it must snap to the horizontal 0° axis.
  const target = await docToScreen(page, 400, 203);
  await page.keyboard.down('Shift');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Meta';
  await page.keyboard.down(modifier);
  await page.mouse.click(target.x, target.y);
  await page.keyboard.up(modifier);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);

  // Sample along y=200 at the mid + end. If the snap worked, the line
  // is at y=200; the green channel should be near 0 (fully red brush).
  const midOnAxis = await readPixelAt(page, 300, 200);
  const endOnAxis = await readPixelAt(page, 400, 200);
  expect(midOnAxis.r).toBeGreaterThan(200);
  expect(midOnAxis.g).toBeLessThan(60);
  expect(endOnAxis.r).toBeGreaterThan(200);
  expect(endOnAxis.g).toBeLessThan(60);

  // A pixel FAR from the snap axis should still be the untouched white
  // background — i.e. green channel is bright. If the snap misbehaved
  // and the line dipped diagonally, green would drop as the brush
  // covered this area with pure red.
  const farAbove = await readPixelAt(page, 400, 130);
  expect(farAbove.g).toBeGreaterThan(200);
  const farBelow = await readPixelAt(page, 400, 270);
  expect(farBelow.g).toBeGreaterThan(200);
});
