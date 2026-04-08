import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Mobile canvas', () => {
  test.use({
    ...({ isMobile: true } as Record<string, unknown>),
    viewport: { width: 390, height: 844 },
  });

  test('canvas container is visible on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const container = page.getByTestId('canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('two-finger pinch-to-zoom changes the zoom level', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const initialZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    const container = page.getByTestId('canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    const startGap = 20;
    const stepSize = 30;

    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx, y: cy - startGap, id: 0 },
        { x: cx, y: cy + startGap, id: 1 },
      ],
    });

    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx, y: cy - startGap - i * stepSize, id: 0 },
          { x: cx, y: cy + startGap + i * stepSize, id: 1 },
        ],
      });
    }

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    await page.waitForTimeout(100);

    const finalZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    expect(finalZoom).toBeGreaterThan(initialZoom);
  });

  test('single-finger touch draws instead of panning', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const initialPan = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { panX: number; panY: number } };
      };
      const v = store.getState().viewport;
      return { panX: v.panX, panY: v.panY };
    });

    const container = page.getByTestId('canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy, id: 0 }],
    });

    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx + i * 20, y: cy + i * 10, id: 0 }],
      });
    }

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    await page.waitForTimeout(100);

    // Single-finger touch should NOT pan — it should draw
    const finalPan = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { panX: number; panY: number } };
      };
      const v = store.getState().viewport;
      return { panX: v.panX, panY: v.panY };
    });

    expect(finalPan.panX).toBe(initialPan.panX);
    expect(finalPan.panY).toBe(initialPan.panY);
  });

  test('two-finger gesture pans the canvas', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const initialPan = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { panX: number; panY: number } };
      };
      const v = store.getState().viewport;
      return { panX: v.panX, panY: v.panY };
    });

    const container = page.getByTestId('canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const cdp = await page.context().newCDPSession(page);

    // Two fingers, fixed distance apart (no zoom), moving together (pan)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 20, y: cy, id: 0 },
        { x: cx + 20, y: cy, id: 1 },
      ],
    });

    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - 20 + i * 20, y: cy + i * 10, id: 0 },
          { x: cx + 20 + i * 20, y: cy + i * 10, id: 1 },
        ],
      });
    }

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    await page.waitForTimeout(100);

    const finalPan = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { panX: number; panY: number } };
      };
      const v = store.getState().viewport;
      return { panX: v.panX, panY: v.panY };
    });

    expect(finalPan.panX).toBeGreaterThan(initialPan.panX);
    expect(finalPan.panY).toBeGreaterThan(initialPan.panY);
  });
});
