import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, closeBrushModal, setBrushModalOption } from './helpers';

// #666 (preview half) — after a paint tool paints an initial dot, holding
// shift while hovering the canvas should render a preview line from that
// origin to the cursor. Holding cmd/meta on top of shift should render the
// line snapped to the nearest 15° angle.

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, w = 400, h = 300) {
  await page.evaluate(({ w, h }) => {
    const s = (window as unknown as { __editorStore: { getState: () => { createDocument: (w: number, h: number, t: boolean) => void } } }).__editorStore;
    s.getState().createDocument(w, h, false);
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
    return {
      x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2,
      y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2,
    };
  }, { docX, docY });
}

test.describe('#666 shift-hold paint line preview', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'shift + hover UI is desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 10);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Opacity', 100);
    await setBrushModalOption(page, 'Spacing', 5);
    await closeBrushModal(page);
    await setForegroundColor(page, 255, 0, 0);
  });

  test('no preview before a paint stroke has been laid down', async ({ page }) => {
    const start = await docToScreen(page, 100, 150);
    await page.keyboard.down('Shift');
    await page.mouse.move(start.x, start.y);
    await page.waitForTimeout(80);
    const preview = await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: unknown } } }).__uiStore.getState().paintLinePreview);
    await page.keyboard.up('Shift');
    expect(preview).toBeNull();
  });

  test('shift+hover after a paint stroke publishes a preview line to the cursor', async ({ page }) => {
    // 1. Click at doc (100, 150) to lay an initial point.
    const origin = await docToScreen(page, 100, 150);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);

    // 2. Hold shift and hover at (300, 150).
    const hover = await docToScreen(page, 300, 150);
    await page.keyboard.down('Shift');
    await page.mouse.move(hover.x, hover.y);
    await page.waitForTimeout(120);

    const preview = await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: { start: { x: number; y: number }; end: { x: number; y: number }; snapped: boolean } | null } } }).__uiStore.getState().paintLinePreview);
    await page.keyboard.up('Shift');

    expect(preview).not.toBeNull();
    expect(preview!.start.x).toBeCloseTo(100, 0);
    expect(preview!.start.y).toBeCloseTo(150, 0);
    expect(preview!.end.x).toBeCloseTo(300, 0);
    expect(preview!.end.y).toBeCloseTo(150, 0);
    expect(preview!.snapped).toBe(false);
  });

  test('shift+meta+hover snaps the preview endpoint to nearest 15°', async ({ page }) => {
    // Lay an initial point.
    const origin = await docToScreen(page, 100, 150);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Hover a couple of pixels below the horizontal axis with shift+meta.
    const hover = await docToScreen(page, 300, 155);
    await page.keyboard.down('Shift');
    await page.keyboard.down('Meta');
    await page.mouse.move(hover.x, hover.y);
    await page.waitForTimeout(120);

    const preview = await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: { start: { x: number; y: number }; end: { x: number; y: number }; snapped: boolean } | null } } }).__uiStore.getState().paintLinePreview);
    await page.keyboard.up('Meta');
    await page.keyboard.up('Shift');

    expect(preview).not.toBeNull();
    expect(preview!.snapped).toBe(true);
    // Snapped to 0° — the end y should collapse back onto the origin's row.
    expect(preview!.end.y).toBeCloseTo(150, 0);
  });

  test('releasing shift clears the preview line', async ({ page }) => {
    const origin = await docToScreen(page, 100, 150);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);

    const hover = await docToScreen(page, 300, 150);
    await page.keyboard.down('Shift');
    await page.mouse.move(hover.x, hover.y);
    await page.waitForTimeout(80);
    let preview = await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: unknown } } }).__uiStore.getState().paintLinePreview);
    expect(preview).not.toBeNull();

    await page.keyboard.up('Shift');
    await page.waitForTimeout(80);
    preview = await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: unknown } } }).__uiStore.getState().paintLinePreview);
    expect(preview).toBeNull();
  });

  test('switching to a non-paint tool clears the preview', async ({ page }) => {
    const origin = await docToScreen(page, 100, 150);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);

    const hover = await docToScreen(page, 300, 150);
    await page.keyboard.down('Shift');
    await page.mouse.move(hover.x, hover.y);
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: unknown } } }).__uiStore.getState().paintLinePreview)).not.toBeNull();

    // Switch to move tool.
    await page.keyboard.up('Shift');
    await page.keyboard.press('v');
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => (window as unknown as { __uiStore: { getState: () => { paintLinePreview: unknown } } }).__uiStore.getState().paintLinePreview)).toBeNull();
  });
});
