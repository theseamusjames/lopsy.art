import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, setBrushModalOption, closeBrushModal } from './helpers';

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

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function readComposited(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
      Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
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
    const px = Math.round(screenX);
    const py = result.height - 1 - Math.round(screenY);
    if (px < 0 || px >= result.width || py < 0 || py >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
    const idx = (py * result.width + px) * 4;
    return { r: result.pixels[idx] ?? 0, g: result.pixels[idx + 1] ?? 0, b: result.pixels[idx + 2] ?? 0, a: result.pixels[idx + 3] ?? 0 };
  }, { docX, docY });
}

test.describe('Soft brush dab overlap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('overlapping soft brush dabs do not compound opacity', async ({ page }) => {
    // Use a large soft brush with 50% opacity so overlapping dabs are obvious
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 80);
    await setToolOption(page, 'Hardness', 0);
    await setToolOption(page, 'Opacity', 50);
    await setBrushModalOption(page, 'Spacing', 10);
    await closeBrushModal(page);
    await setForegroundColor(page, 255, 0, 0);

    // Draw a single dab (click without drag)
    const singleDabPos = await docToScreen(page, 100, 150);
    await page.mouse.click(singleDabPos.x, singleDabPos.y);
    await page.waitForTimeout(300);

    // Read center pixel of single dab
    const singleDabCenter = await readCompositedPixelAt(page, 100, 150);

    // Draw a slow stroke through a different area so many dabs overlap
    const start = await docToScreen(page, 250, 150);
    const end = await docToScreen(page, 300, 150);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Move slowly with many steps to ensure dense overlapping dabs
    await page.mouse.move(end.x, end.y, { steps: 30 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Read center pixel where many dabs overlapped
    const overlapCenter = await readCompositedPixelAt(page, 275, 150);

    console.log(`Single dab center: R=${singleDabCenter.r}`);
    console.log(`Overlap center: R=${overlapCenter.r}`);

    // Both should have painted something
    expect(singleDabCenter.r).toBeGreaterThan(0);
    expect(overlapCenter.r).toBeGreaterThan(0);

    // The overlap center should NOT be significantly darker/more opaque than
    // the single dab center. With MAX blending, they should be very close.
    // Allow 15% tolerance for slight differences in dab positioning.
    const ratio = overlapCenter.r / singleDabCenter.r;
    console.log(`Overlap/Single ratio: ${ratio.toFixed(3)}`);
    expect(ratio).toBeLessThanOrEqual(1.15);
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });
});
