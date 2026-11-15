import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';

// #670 + #671: the zoom indicator in the status bar responds to
// double-click (reset zoom to 100% AND recenter) and click-and-drag
// (scrub at ~1%/pixel between 10% and 400%).

test.describe('Status-bar zoom indicator', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'status bar is desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('double-click resets zoom AND recenters the canvas (#670)', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setZoom: (z: number) => void; setPan: (x: number, y: number) => void };
      };
      s.getState().setZoom(2.5);
      s.getState().setPan(120, -80);
    });

    const zoomLabel = page.getByRole('button', { name: /Zoom \d+%/ });
    await zoomLabel.dblclick();

    const state = await page.evaluate(() => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number; panX: number; panY: number } };
      };
      const v = s.getState().viewport;
      return { zoom: v.zoom, panX: v.panX, panY: v.panY };
    });
    expect(state.zoom).toBeCloseTo(1);
    expect(state.panX).toBe(0);
    expect(state.panY).toBe(0);
  });

  test('drag-right scrubs zoom up, drag-left scrubs down (#671)', async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setZoom: (z: number) => void; setPan: (x: number, y: number) => void };
      };
      s.getState().setZoom(1);
      s.getState().setPan(0, 0);
    });

    const zoomLabel = page.getByRole('button', { name: /Zoom \d+%/ });
    const box = await zoomLabel.boundingBox();
    if (!box) throw new Error('zoom label not visible');
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Drag right by 60px → +60% at 1%/px → zoom becomes ~1.6.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    // Move in a few steps so the pointermove handler fires each frame.
    await page.mouse.move(startX + 20, y, { steps: 4 });
    await page.mouse.move(startX + 60, y, { steps: 8 });
    const midZoom = await page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore.getState().viewport.zoom);
    await page.mouse.up();
    expect(midZoom).toBeGreaterThan(1.4);
    expect(midZoom).toBeLessThan(1.8);

    // Drag left past the min — should clamp to 10%. The scrub is
    // measured from the pointer-down x, and the zoom label sits ~25px
    // from the left edge; Firefox clamps pointer clientX to the
    // viewport, so a leftward drag can never be wider than that. Start
    // from a low zoom so dragging to x=0 overshoots the 10% floor in
    // every browser rather than relying on off-screen coordinates.
    await page.evaluate(() => {
      const s = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setZoom: (z: number) => void };
      };
      s.getState().setZoom(0.15);
    });
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(0, y, { steps: 10 });
    const lowZoom = await page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore.getState().viewport.zoom);
    await page.mouse.up();
    expect(lowZoom).toBeCloseTo(0.1, 2);

    // Drag right far beyond max — should clamp to 400%.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 900, y, { steps: 10 });
    const highZoom = await page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore.getState().viewport.zoom);
    await page.mouse.up();
    expect(highZoom).toBeCloseTo(4.0, 2);
  });

  test('losing focus mid-drag releases the scrub (#671)', async ({ page }) => {
    const zoomLabel = page.getByRole('button', { name: /Zoom \d+%/ });
    const box = await zoomLabel.boundingBox();
    if (!box) throw new Error('zoom label not visible');
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Start a scrub.
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 40, y, { steps: 4 });
    const midZoom = await page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore.getState().viewport.zoom);
    expect(midZoom).toBeGreaterThan(1.2);

    // Simulate the tab losing focus (alt-tab, switch app) — the
    // scrub should end without a pointer-up event.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await page.waitForTimeout(50);

    // Now moving the mouse across the page shouldn't change zoom.
    const beforeMove = await page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore.getState().viewport.zoom);
    await page.mouse.move(startX + 200, y, { steps: 5 });
    const afterMove = await page.evaluate(() => (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore.getState().viewport.zoom);
    expect(afterMove).toBe(beforeMove);
    await page.mouse.up();
  });
});
