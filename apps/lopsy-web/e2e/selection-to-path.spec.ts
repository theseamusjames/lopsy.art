import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      const rect = container.getBoundingClientRect();
      const sx = (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2;
      const sy = (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2;
      return { x: rect.left + sx, y: rect.top + sy };
    },
    { x: docX, y: docY },
  );
}

/** Draw a rectangular selection by dragging the marquee-rect tool. */
async function drawRectSelection(
  page: Page,
  docX: number,
  docY: number,
  docW: number,
  docH: number,
) {
  await page.keyboard.press('m');
  await page.waitForTimeout(100);

  const start = await docToScreen(page, docX, docY);
  const end = await docToScreen(page, docX + docW, docY + docH);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function getSelectionActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean } };
    };
    return store.getState().selection.active;
  });
}

async function getPathsState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        paths: Array<{
          id: string;
          name: string;
          anchors: Array<{
            point: { x: number; y: number };
            handleIn: { x: number; y: number } | null;
            handleOut: { x: number; y: number } | null;
          }>;
          closed: boolean;
        }>;
        selectedPathId: string | null;
      };
    };
    const state = store.getState();
    return {
      paths: state.paths.map((p) => ({
        id: p.id,
        name: p.name,
        anchorCount: p.anchors.length,
        closed: p.closed,
        anchors: p.anchors.map((a) => ({
          point: a.point,
          hasHandles: a.handleIn !== null || a.handleOut !== null,
        })),
      })),
      selectedPathId: state.selectedPathId,
    };
  });
}

async function openPathsPanel(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        visiblePanels: Set<string>;
        togglePanel: (id: string) => void;
      };
    };
    const state = store.getState();
    if (!state.visiblePanels.has('paths')) {
      state.togglePanel('paths');
    }
  });
  await page.waitForTimeout(100);
}

/** Click "Select" in the menu bar, then click the given item label. */
async function clickSelectMenuItem(page: Page, label: string) {
  await page.locator('nav[aria-label="Application menu"] button', { hasText: 'Select' }).click();
  await page.waitForTimeout(100);
  await page.locator('[role="menu"] [role="menuitem"]', { hasText: label }).click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'selection to path requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await openPathsPanel(page);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Selection → Path', () => {
  test('rectangle selection converts to a path that appears in paths panel', async ({ page }) => {
    // Draw a rectangular selection (60x50 region at doc position 100,100)
    await drawRectSelection(page, 100, 100, 60, 50);

    const selActive = await getSelectionActive(page);
    expect(selActive).toBe(true);

    // Invoke "Selection → Path" from the Select menu
    await clickSelectMenuItem(page, 'Selection → Path');

    // A path should now exist in the paths panel
    const pathsState = await getPathsState(page);
    expect(pathsState.paths).toHaveLength(1);
    expect(pathsState.paths[0]!.closed).toBe(true);
    expect(pathsState.paths[0]!.anchorCount).toBeGreaterThanOrEqual(4);

    // The newly created path should be selected
    expect(pathsState.selectedPathId).toBe(pathsState.paths[0]!.id);

    // Anchor points should lie near the selection boundary
    // The selection was at (100,100) to (160,150)
    for (const anchor of pathsState.paths[0]!.anchors) {
      expect(anchor.point.x).toBeGreaterThanOrEqual(98);
      expect(anchor.point.x).toBeLessThanOrEqual(162);
      expect(anchor.point.y).toBeGreaterThanOrEqual(98);
      expect(anchor.point.y).toBeLessThanOrEqual(152);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'selection-to-path-rectangle.png'),
    });
  });

  test('Selection → Path menu item is disabled with no active selection', async ({ page }) => {
    // No selection made yet — open the Select menu and check the item
    await page.locator('nav[aria-label="Application menu"] button', { hasText: 'Select' }).click();
    await page.waitForTimeout(100);

    const menuItem = page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Selection → Path' });
    await expect(menuItem).toHaveAttribute('aria-disabled', 'true');

    // Close the menu
    await page.keyboard.press('Escape');

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'selection-to-path-disabled-state.png'),
    });
  });

  test('path panel shows the new path item after Selection → Path', async ({ page }) => {
    await drawRectSelection(page, 80, 80, 100, 100);
    await clickSelectMenuItem(page, 'Selection → Path');

    // The paths panel should list the path by name
    const pathItem = page.locator('[aria-label="Paths"] [role="option"]').first();
    await expect(pathItem).toBeVisible();
    // The path name follows the "Path N" convention
    await expect(pathItem).toContainText('Path');

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'selection-to-path-panel-item.png'),
    });
  });
});
