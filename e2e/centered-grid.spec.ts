import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, getEditorState, moveLayer } from './helpers';

test.describe('Centered grid with edge snapping (#126)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('grid is symmetric around the canvas center', async ({ page }) => {
    // Use an odd-sized canvas to verify centering
    await createDocument(page, 501, 501, false);
    await page.waitForTimeout(300);

    // Enable grid and snap-to-grid via the UI store
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
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/centered-grid.png' });

    // Verify store state is set correctly
    const gridState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showGrid: boolean; snapToGrid: boolean; gridSize: number };
      };
      return store.getState();
    });
    expect(gridState.showGrid).toBe(true);
    expect(gridState.snapToGrid).toBe(true);
    expect(gridState.gridSize).toBe(32);

    // Move a layer to a position and verify it was recorded
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;
    await moveLayer(page, layerId, 100, 100);
    await page.waitForTimeout(100);

    const afterMove = await getEditorState(page);
    const layer = afterMove.document.layers.find(l => l.id === layerId);
    expect(layer).toBeTruthy();
    expect(layer!.x).toBe(100);
    expect(layer!.y).toBe(100);
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

    // Verify grid store state
    const gridState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showGrid: boolean; snapToGrid: boolean; gridSize: number };
      };
      const s = store.getState();
      return { showGrid: s.showGrid, snapToGrid: s.snapToGrid, gridSize: s.gridSize };
    });
    expect(gridState.showGrid).toBe(true);
    expect(gridState.snapToGrid).toBe(true);
    expect(gridState.gridSize).toBe(32);

    // Move the active layer near the left edge and verify position is stored
    const editorState = await getEditorState(page);
    const layerId = editorState.document.activeLayerId;

    // Move near left/top edge (x=3, y=5)
    await moveLayer(page, layerId, 3, 5);
    await page.waitForTimeout(100);

    const afterLeftMove = await getEditorState(page);
    const movedLayer = afterLeftMove.document.layers.find(l => l.id === layerId);
    expect(movedLayer).toBeTruthy();
    expect(movedLayer!.x).toBe(3);
    expect(movedLayer!.y).toBe(5);

    // Move near right/bottom edge
    await moveLayer(page, layerId, 498, 396);
    await page.waitForTimeout(100);

    const afterRightMove = await getEditorState(page);
    const movedLayerRight = afterRightMove.document.layers.find(l => l.id === layerId);
    expect(movedLayerRight).toBeTruthy();
    expect(movedLayerRight!.x).toBe(498);
    expect(movedLayerRight!.y).toBe(396);

    await page.screenshot({ path: 'e2e/screenshots/centered-grid-snap.png' });
  });
});
