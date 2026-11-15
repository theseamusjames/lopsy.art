import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

test.describe('Zoom scroll behavior (#54)', () => {
  test('ctrl+scroll down does not cause extreme zoom out', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);

    const initialZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Simulate ctrl+scroll down (zoom out) - single notch
    const container = page.locator('[data-testid="canvas-container"]');
    await container.dispatchEvent('wheel', {
      deltaY: 120,
      ctrlKey: true,
      clientX: 640,
      clientY: 360,
    });

    await page.waitForTimeout(100);

    const afterZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // With the fix (exponential model), a single scroll should change zoom by ~27%
    // NOT by 120% (the old bug)
    const ratio = afterZoom / initialZoom;
    expect(ratio).toBeGreaterThan(0.5); // Should not zoom out more than 50%
    expect(ratio).toBeLessThan(1.0); // Should zoom out

    await page.screenshot({ path: 'test-results/screenshots/zoom-scroll-single-notch.png' });
  });

  test('zoom in and zoom out are symmetric', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);

    const initialZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Zoom out
    const container = page.locator('[data-testid="canvas-container"]');
    await container.dispatchEvent('wheel', {
      deltaY: 120,
      ctrlKey: true,
      clientX: 640,
      clientY: 360,
    });
    await page.waitForTimeout(50);

    // Zoom back in
    await container.dispatchEvent('wheel', {
      deltaY: -120,
      ctrlKey: true,
      clientX: 640,
      clientY: 360,
    });
    await page.waitForTimeout(50);

    const finalZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Should return to approximately the initial zoom (symmetric)
    expect(finalZoom).toBeCloseTo(initialZoom, 1);

    await page.screenshot({ path: 'test-results/screenshots/zoom-scroll-symmetric.png' });
  });
});

test.describe('Zoom anchors at the cursor', () => {
  test('ctrl+scroll keeps the document point under the cursor fixed', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);

    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    if (!box) throw new Error('canvas container not found');
    // Well off-centre, so zooming about the centre would visibly drift.
    // Whole pixels, since that's what the wheel event's clientX/Y report.
    const cursorX = Math.round(box.x + box.width * 0.25);
    const cursorY = Math.round(box.y + box.height * 0.3);

    const docPointUnderCursor = () => page.evaluate(({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          viewport: { zoom: number; panX: number; panY: number };
          document: { width: number; height: number };
        };
      };
      const { viewport, document: doc } = store.getState();
      const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
      return {
        zoom: viewport.zoom,
        x: (x - rect.left - viewport.panX - rect.width / 2) / viewport.zoom + doc.width / 2,
        y: (y - rect.top - viewport.panY - rect.height / 2) / viewport.zoom + doc.height / 2,
      };
    }, { x: cursorX, y: cursorY });

    const before = await docPointUnderCursor();
    await page.mouse.move(cursorX, cursorY);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    const after = await docPointUnderCursor();

    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });
});
