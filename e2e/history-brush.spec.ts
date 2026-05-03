/**
 * E2E tests for the History Brush tool.
 *
 * Scenario: user draws red on a layer (establishes history), then paints
 * over it with blue, then sets the pre-blue state as the history brush
 * source, paints back over the blue area, and verifies the red pixels
 * are restored.
 */

import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  getPixelAt,
  drawRect,
  setActiveLayer,
  undo,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Projects document coordinates to canvas-container screen coordinates.
 */
async function docToScreen(
  page: Parameters<typeof waitForStore>[0],
  docX: number,
  docY: number,
): Promise<{ x: number; y: number }> {
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

/**
 * Flush pending GPU stroke data into the layer texture so pixel reads
 * see the latest painted content.
 */
async function flushHistory(page: Parameters<typeof waitForStore>[0]): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory('flush');
  });
}

/**
 * Set historyBrushSourceIndex on the ui store directly.
 * This simulates the user clicking the source icon in the History panel.
 */
async function setHistoryBrushSource(page: Parameters<typeof waitForStore>[0], index: number): Promise<void> {
  await page.evaluate((idx) => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setHistoryBrushSourceIndex: (i: number) => void };
    };
    store.getState().setHistoryBrushSourceIndex(idx);
  }, index);
}

/**
 * Paint a single dab of the history brush at the given document position.
 */
async function paintHistoryBrushAt(
  page: Parameters<typeof waitForStore>[0],
  docX: number,
  docY: number,
): Promise<void> {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('History Brush', () => {
  test('restores pixels from a previous history state', async ({ page }) => {
    // Create a 200×200 transparent document
    await createDocument(page, 200, 200, true);

    const { layerId } = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { layerId: store.getState().document.activeLayerId };
    });

    // Step 1: Draw a red rectangle at (40, 40, 80×80)
    await setActiveLayer(page, layerId);
    await drawRect(page, 40, 40, 80, 80, { r: 255, g: 0, b: 0 });

    // Flush GPU stroke so the snapshot captures red pixels
    await flushHistory(page);

    // At this point undoStack has an entry with the red pixels.
    // The last entry index = undoStack.length (i.e. currentIndex).
    const sourceIdx = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undoStack: unknown[] };
      };
      return store.getState().undoStack.length;
    });

    // Step 2: Paint blue over the red area
    await drawRect(page, 40, 40, 80, 80, { r: 0, g: 0, b: 255 });
    await flushHistory(page);

    // Verify blue is visible at center of the blue rect
    const bluePixelBefore = await getPixelAt(page, 80, 80, layerId);
    expect(bluePixelBefore.b).toBeGreaterThan(200);

    // Take a before screenshot
    await page.screenshot({ path: 'e2e/screenshots/history-brush-before.png' });

    // Step 3: Set the red-state entry as the history brush source
    await setHistoryBrushSource(page, sourceIdx);

    // Step 4: Select the history brush tool (shortcut Y)
    await page.keyboard.press('y');

    // Verify the tool was selected
    const activeTool = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { activeTool: string };
      };
      return store.getState().activeTool;
    });
    expect(activeTool).toBe('history-brush');

    // Step 5: Paint with the history brush over the blue area
    // The brush should restore red pixels from the source snapshot
    await paintHistoryBrushAt(page, 80, 80);

    // Flush the stroke so pixel reads capture the painted content
    await flushHistory(page);

    // Take an after screenshot
    await page.screenshot({ path: 'e2e/screenshots/history-brush-after.png' });

    // Step 6: Verify that the center pixel has been partially or fully restored
    // from the red source state
    const restoredPixel = await getPixelAt(page, 80, 80, layerId);

    // The history brush at full opacity paints the red source over the blue dest.
    // We should see meaningful red channel activity compared to before the brush stroke.
    // The exact mix depends on brush size/hardness settings, but at default 100% opacity
    // and 80% hardness, the center dab should be mostly red.
    expect(restoredPixel.r).toBeGreaterThan(restoredPixel.b);
  });

  test('source icon button sets historyBrushSourceIndex in UI store', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    // Make an edit so there is a history entry
    await setActiveLayer(page, layerId);
    await drawRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0 });

    // Verify source index starts as null
    const initialIndex = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { historyBrushSourceIndex: number | null };
      };
      return store.getState().historyBrushSourceIndex;
    });
    expect(initialIndex).toBeNull();

    // Make the History panel visible
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { visiblePanels: Set<string>; togglePanel: (id: string) => void };
      };
      const s = store.getState();
      if (!s.visiblePanels.has('history')) {
        s.togglePanel('history');
      }
    });
    await page.waitForTimeout(150);

    // Click the first "Set as history brush source" button in the history panel
    const sourceBtns = page.locator('[aria-label="Set as history brush source"]');
    await sourceBtns.first().waitFor({ state: 'visible', timeout: 5000 });
    await sourceBtns.first().click();

    // Verify the source index is now set
    const setIndex = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { historyBrushSourceIndex: number | null };
      };
      return store.getState().historyBrushSourceIndex;
    });
    expect(setIndex).not.toBeNull();
    expect(typeof setIndex).toBe('number');

    // Clicking the same button again should toggle it off
    await sourceBtns.first().click();
    const clearedIndex = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { historyBrushSourceIndex: number | null };
      };
      return store.getState().historyBrushSourceIndex;
    });
    expect(clearedIndex).toBeNull();
  });

  test('history brush is a no-op when no source is set', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    // Draw blue
    await setActiveLayer(page, layerId);
    await drawRect(page, 20, 20, 60, 60, { r: 0, g: 0, b: 255 });
    await flushHistory(page);

    // Do NOT set a source
    await page.keyboard.press('y');

    const blueBefore = await getPixelAt(page, 50, 50, layerId);

    // Paint with history brush — should do nothing
    await paintHistoryBrushAt(page, 50, 50);
    await flushHistory(page);

    const blueAfter = await getPixelAt(page, 50, 50, layerId);

    // Blue channel should be unchanged since no source was set
    expect(blueAfter.b).toBeCloseTo(blueBefore.b, -1);
  });

  test('history brush tool is accessible via Y shortcut', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await page.keyboard.press('y');

    const activeTool = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { activeTool: string };
      };
      return store.getState().activeTool;
    });
    expect(activeTool).toBe('history-brush');
  });

  test('history brush undo restores the pre-stroke state', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    // Draw red
    await setActiveLayer(page, layerId);
    await drawRect(page, 50, 50, 80, 80, { r: 255, g: 0, b: 0 });
    await flushHistory(page);

    const redSourceIndex = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undoStack: unknown[] };
      };
      return store.getState().undoStack.length;
    });

    // Overwrite with green
    await drawRect(page, 50, 50, 80, 80, { r: 0, g: 255, b: 0 });
    await flushHistory(page);

    // Verify green
    const greenPixel = await getPixelAt(page, 90, 90, layerId);
    expect(greenPixel.g).toBeGreaterThan(200);

    // Set red state as source
    await setHistoryBrushSource(page, redSourceIndex);

    // Paint with history brush to restore red
    await page.keyboard.press('y');
    await paintHistoryBrushAt(page, 90, 90);
    await flushHistory(page);

    const afterBrush = await getPixelAt(page, 90, 90, layerId);
    expect(afterBrush.r).toBeGreaterThan(afterBrush.g);

    // Undo the history brush stroke
    await undo(page);
    await page.waitForTimeout(200);

    const afterUndo = await getPixelAt(page, 90, 90, layerId);
    // After undo, green should be restored
    expect(afterUndo.g).toBeGreaterThan(afterUndo.r);
  });
});
