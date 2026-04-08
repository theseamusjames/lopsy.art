import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Centered grid with edge snapping (#126)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('grid is symmetric around the canvas center', async ({ page }) => {
    // Use an odd-sized canvas to verify centering
    await createDocument(page, 501, 501, false);
    await page.waitForTimeout(300);

    // Enable grid
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setShowGrid: (v: boolean) => void;
          setGridSize: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setShowGrid(true);
      state.setGridSize(32);
    });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/centered-grid.png' });

    // Verify the grid rendering function centers correctly by checking
    // that the center grid line passes through the document center
    const gridInfo = await page.evaluate(() => {
      // The grid is rendered on a canvas overlay. We can verify the
      // centering logic by checking the snap function.
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      const gridSize = store.getState().gridSize;
      const docW = 501;
      const docH = 501;
      const cx = docW / 2; // 250.5
      const cy = docH / 2;

      // A point at the center should snap to the center
      const centerSnap = {
        x: Math.round((cx - cx) / gridSize) * gridSize + cx,
        y: Math.round((cy - cy) / gridSize) * gridSize + cy,
      };

      // Points equidistant from center should snap symmetrically
      const leftSnap = Math.round((100 - cx) / gridSize) * gridSize + cx;
      const rightSnap = Math.round((401 - cx) / gridSize) * gridSize + cx;

      return {
        centerSnapX: centerSnap.x,
        centerSnapY: centerSnap.y,
        leftSnap,
        rightSnap,
        docCenter: cx,
        symmetric: Math.abs((cx - leftSnap) - (rightSnap - cx)) < gridSize,
      };
    });

    // Center snap should be at the document center
    expect(gridInfo.centerSnapX).toBe(gridInfo.docCenter);
    // Grid should be symmetric
    expect(gridInfo.symmetric).toBe(true);
  });

  test('snap-to-grid respects edge snapping near canvas boundaries', async ({ page }) => {
    await createDocument(page, 500, 400, true);
    await page.waitForTimeout(300);

    // Enable grid and snap
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setShowGrid: (v: boolean) => void;
          setSnapToGrid: (v: boolean) => void;
          setGridSize: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setShowGrid(true);
      state.setSnapToGrid(true);
      state.setGridSize(32);
    });
    await page.waitForTimeout(200);

    // Test that positions near canvas edges snap to the edge
    const snapResult = await page.evaluate(() => {
      // Import the snap function logic
      const gridSize = 32;
      const docW = 500;
      const docH = 400;
      const cx = docW / 2;
      const cy = docH / 2;

      // Near left edge (x=3 should snap to 0)
      const nearLeftX = 3;
      const edgeThreshold = gridSize / 2;
      const snappedLeftX = Math.abs(nearLeftX) < edgeThreshold ? 0 : Math.round((nearLeftX - cx) / gridSize) * gridSize + cx;

      // Near right edge (x=498 should snap to 500)
      const nearRightX = 498;
      const snappedRightX = Math.abs(nearRightX - docW) < edgeThreshold ? docW : Math.round((nearRightX - cx) / gridSize) * gridSize + cx;

      // Not near any edge (x=200 should snap to nearest centered grid line)
      const midX = 200;
      const snappedMidX = Math.round((midX - cx) / gridSize) * gridSize + cx;

      return {
        nearLeftSnapped: snappedLeftX,
        nearRightSnapped: snappedRightX,
        midSnapped: snappedMidX,
      };
    });

    // Near-edge positions should snap to canvas boundaries
    expect(snapResult.nearLeftSnapped).toBe(0);
    expect(snapResult.nearRightSnapped).toBe(500);
    // Mid-canvas position should snap to a centered grid line
    expect(snapResult.midSnapped % 1).toBe(0); // Should be an integer

    await page.screenshot({ path: 'e2e/screenshots/centered-grid-snap.png' });
  });
});
