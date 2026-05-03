import { test, expect, type Page } from './fixtures';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createDocument, waitForStore } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function docToScreen(page: Page, docX: number, docY: number) {
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
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

interface PathInfo {
  id: string;
  anchorCount: number;
  closed: boolean;
}

async function getPathsState(page: Page): Promise<{ paths: PathInfo[]; selectedPathId: string | null }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        paths: Array<{
          id: string;
          anchors: unknown[];
          closed: boolean;
        }>;
        selectedPathId: string | null;
      };
    };
    const state = store.getState();
    return {
      paths: state.paths.map((p) => ({
        id: p.id,
        anchorCount: p.anchors.length,
        closed: p.closed,
      })),
      selectedPathId: state.selectedPathId,
    };
  });
}

/** Create a closed rectangular path by clicking 4 corners, then clicking first again to close. */
async function drawClosedRect(
  page: Page,
  x: number, y: number, w: number, h: number,
) {
  await clickAtDoc(page, x, y);
  await clickAtDoc(page, x + w, y);
  await clickAtDoc(page, x + w, y + h);
  await clickAtDoc(page, x, y + h);
  // Close by clicking near the first anchor
  await clickAtDoc(page, x, y);
  await page.waitForTimeout(200);
}

/** Add a path via the store (bypasses UI — used to create a second path without committing via pen tool clicks). */
async function addPathViaStore(
  page: Page,
  points: Array<{ x: number; y: number }>,
) {
  await page.evaluate((pts) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addPath: (anchors: unknown[], closed: boolean) => void;
      };
    };
    const anchors = pts.map((p) => ({ point: p, handleIn: null, handleOut: null }));
    store.getState().addPath(anchors, true);
  }, points);
  await page.waitForTimeout(100);
}

/** Click a menu item by menu label + item label. */
async function clickMenuItem(page: Page, menuLabel: string, itemLabel: string) {
  // Open the menu
  await page.locator('nav[aria-label="Application menu"]')
    .locator(`button:has-text("${menuLabel}")`)
    .click();
  await page.waitForTimeout(100);
  // Click the item
  await page.locator('[role="menu"]').locator(`button:has-text("${itemLabel}")`).click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'path tool requires desktop viewport');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Boolean Path Operations', () => {
  test('Path menu contains boolean operation items', async ({ page }) => {
    // Open the Path menu and verify all four boolean op items are present
    await page.locator('nav[aria-label="Application menu"]')
      .locator('button:has-text("Path")')
      .click();
    await page.waitForTimeout(100);

    const menu = page.locator('[role="menu"]');
    await expect(menu.locator('button:has-text("Unite Paths")')).toBeVisible();
    await expect(menu.locator('button:has-text("Subtract Paths")')).toBeVisible();
    await expect(menu.locator('button:has-text("Intersect Paths")')).toBeVisible();
    await expect(menu.locator('button:has-text("Exclude Paths")')).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-menu.png') });

    // Close the menu
    await page.keyboard.press('Escape');
  });

  test('options bar shows boolean operation buttons when pen tool is active', async ({ page }) => {
    // Select pen tool
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // The options bar should have boolean op buttons
    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar.locator('[data-boolean-op="union"]')).toBeVisible();
    await expect(toolbar.locator('[data-boolean-op="subtract"]')).toBeVisible();
    await expect(toolbar.locator('[data-boolean-op="intersect"]')).toBeVisible();
    await expect(toolbar.locator('[data-boolean-op="exclude"]')).toBeVisible();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-toolbar.png') });
  });

  test('boolean op buttons are disabled with no paths selected', async ({ page }) => {
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // No paths exist, buttons should be disabled
    const unionBtn = page.locator('[data-boolean-op="union"]');
    await expect(unionBtn).toBeDisabled();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-disabled.png') });
  });

  test('Unite Paths via menu: two paths become one', async ({ page }) => {
    // Create path A via store: rectangle at (50,50) 100x100
    await addPathViaStore(page, [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ]);

    // Create path B via store: overlapping rectangle at (100,100) 100x100
    await addPathViaStore(page, [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ]);

    // Select path A (the first one)
    const stateBefore = await getPathsState(page);
    expect(stateBefore.paths).toHaveLength(2);

    await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectPath: (id: string) => void };
      };
      store.getState().selectPath(id);
    }, stateBefore.paths[0]!.id);
    await page.waitForTimeout(100);

    // Take a screenshot of the two paths before the operation
    await page.keyboard.press('p');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-before.png') });

    // Apply unite via menu
    await clickMenuItem(page, 'Path', 'Unite Paths');

    const stateAfter = await getPathsState(page);

    // The two paths should be replaced by one result path
    expect(stateAfter.paths).toHaveLength(1);
    // Result path should be closed
    expect(stateAfter.paths[0]!.closed).toBe(true);
    // Result should have anchors
    expect(stateAfter.paths[0]!.anchorCount).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-after-union.png') });
  });

  test('Subtract Paths via menu: two paths become one smaller path', async ({ page }) => {
    // Path A: large rectangle (0,0) 200x200
    await addPathViaStore(page, [
      { x: 20, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 220 },
      { x: 20, y: 220 },
    ]);

    // Path B: smaller rectangle overlapping the right side
    await addPathViaStore(page, [
      { x: 120, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 220 },
      { x: 120, y: 220 },
    ]);

    const stateBefore = await getPathsState(page);
    expect(stateBefore.paths).toHaveLength(2);
    const anchorCountBefore = stateBefore.paths[0]!.anchorCount;

    // Select path A
    await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectPath: (id: string) => void };
      };
      store.getState().selectPath(id);
    }, stateBefore.paths[0]!.id);
    await page.waitForTimeout(100);

    // Apply subtract via menu
    await clickMenuItem(page, 'Path', 'Subtract Paths');

    const stateAfter = await getPathsState(page);

    // Two source paths removed, one result added
    expect(stateAfter.paths).toHaveLength(1);
    expect(stateAfter.paths[0]!.closed).toBe(true);

    // The result should be different from the original path A
    // (i.e. the operation actually changed the path)
    const anchorCountAfter = stateAfter.paths[0]!.anchorCount;
    // At minimum the result should have anchors
    expect(anchorCountAfter).toBeGreaterThan(0);
    // The anchor count should differ from path A's original 4 corners
    // because the clipping operation produces more edge points
    expect(anchorCountAfter).not.toBe(anchorCountBefore);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-after-subtract.png') });
  });

  test('Intersect non-overlapping paths: operation does nothing (no area)', async ({ page }) => {
    // Path A: left side of canvas
    await addPathViaStore(page, [
      { x: 10, y: 10 },
      { x: 80, y: 10 },
      { x: 80, y: 80 },
      { x: 10, y: 80 },
    ]);

    // Path B: right side of canvas, no overlap
    await addPathViaStore(page, [
      { x: 200, y: 200 },
      { x: 350, y: 200 },
      { x: 350, y: 350 },
      { x: 200, y: 350 },
    ]);

    const stateBefore = await getPathsState(page);
    expect(stateBefore.paths).toHaveLength(2);

    // Select path A
    await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectPath: (id: string) => void };
      };
      store.getState().selectPath(id);
    }, stateBefore.paths[0]!.id);
    await page.waitForTimeout(100);

    // Apply intersect via menu
    await clickMenuItem(page, 'Path', 'Intersect Paths');

    const stateAfter = await getPathsState(page);

    // No overlap → operation produces no area → paths remain unchanged
    // (the operation is a no-op when there is no intersection)
    expect(stateAfter.paths).toHaveLength(2);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'boolean-path-ops-no-overlap.png') });
  });
});
