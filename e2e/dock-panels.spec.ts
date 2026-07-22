import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

/**
 * Dockable panel system: tab merging, floating, edge docking, resizing,
 * and persistence — all driven through real pointer gestures on the UI.
 */

interface DockLayoutSnapshot {
  docks: Record<string, unknown | null>;
  dockSizes: Record<string, number>;
  floating: { id: string; tabs: string[]; activeTab: string; x: number; y: number }[];
}

function getDockLayout(page: Page): Promise<DockLayoutSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__dockStore as {
      getState: () => { layout: DockLayoutSnapshot };
    };
    return JSON.parse(JSON.stringify(store.getState().layout)) as DockLayoutSnapshot;
  });
}

function getRightDockTabs(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__dockStore as {
      getState: () => { layout: { docks: { right: unknown } } };
    };
    interface Node { kind: string; tabs?: string[]; children?: Node[] }
    const collect = (node: Node | null): string[][] => {
      if (!node) return [];
      if (node.kind === 'tabs') return [node.tabs ?? []];
      return (node.children ?? []).flatMap(collect);
    };
    return collect(store.getState().layout.docks.right as Node | null);
  });
}

async function dragFromTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function tabCenter(page: Page, panelId: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-dock-tab="${panelId}"]`).boundingBox();
  expect(box, `tab ${panelId} should be visible`).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

test.describe('dockable panels', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'docking is a desktop feature');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('default layout: color above layers on the right dock', async ({ page }) => {
    await expect(page.locator('[data-testid="dock-right"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Color"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Layers"]')).toBeVisible();
    expect(await getRightDockTabs(page)).toEqual([['color'], ['layers']]);
    await page.screenshot({ path: 'e2e/screenshots/dock-default-layout.png' });
  });

  test('dragging a tab onto another group merges them as tabs', async ({ page }) => {
    const from = await tabCenter(page, 'color');
    const layersBox = await page.locator('section[aria-label="Layers"]').boundingBox();
    expect(layersBox).not.toBeNull();
    await dragFromTo(page, from, {
      x: layersBox!.x + layersBox!.width / 2,
      y: layersBox!.y + layersBox!.height / 2,
    });

    expect(await getRightDockTabs(page)).toEqual([['layers', 'color']]);
    // The dragged tab lands active; both tab buttons live in one tab bar now.
    const bar = page.locator('[data-testid="dock-tabbar-color"]');
    await expect(bar.locator('[data-dock-tab="layers"]')).toBeVisible();
    await expect(bar.locator('[data-dock-tab="color"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Color"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Layers"]')).toHaveCount(0);
    await page.screenshot({ path: 'e2e/screenshots/dock-tabs-merged.png' });

    // Clicking the other tab switches the visible panel.
    await page.locator('[data-dock-tab="layers"]').click();
    await expect(page.locator('section[aria-label="Layers"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Color"]')).toHaveCount(0);
  });

  test('a group refuses a fourth tab', async ({ page }) => {
    // Open History and Paths, then merge everything into the layers group.
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="History"]').click();
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();

    const layersCenter = async () => {
      const box = await page.locator('[data-dock-group]').filter({
        has: page.locator('[data-dock-tab="layers"]'),
      }).boundingBox();
      expect(box).not.toBeNull();
      return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    };

    await dragFromTo(page, await tabCenter(page, 'color'), await layersCenter());
    await dragFromTo(page, await tabCenter(page, 'history'), await layersCenter());
    expect(await getRightDockTabs(page)).toEqual([['paths'], ['layers', 'color', 'history']]);

    // Paths cannot join: the center zone degrades to a side split.
    await dragFromTo(page, await tabCenter(page, 'paths'), await layersCenter());
    const groups = await getRightDockTabs(page);
    const fullGroup = groups.find((tabs) => tabs.includes('layers'));
    expect(fullGroup).toHaveLength(3);
    expect(fullGroup).not.toContain('paths');
    await page.screenshot({ path: 'e2e/screenshots/dock-max-three-tabs.png' });
  });

  test('dragging a tab into open space floats it, and it can re-dock to the left edge', async ({ page }) => {
    const canvasBox = await page.locator('[data-testid="canvas-container"]').boundingBox();
    expect(canvasBox).not.toBeNull();
    const canvasCenter = {
      x: canvasBox!.x + canvasBox!.width / 2,
      y: canvasBox!.y + canvasBox!.height / 2,
    };

    await dragFromTo(page, await tabCenter(page, 'color'), canvasCenter);

    const floating = page.locator('[data-testid="floating-panel-color"]');
    await expect(floating).toBeVisible();
    await expect(floating.locator('section[aria-label="Color"]')).toBeVisible();
    expect((await getDockLayout(page)).floating).toHaveLength(1);
    expect(await getRightDockTabs(page)).toEqual([['layers']]);
    await page.screenshot({ path: 'e2e/screenshots/dock-floating-panel.png' });

    // Drag the floating window by its tab to the left edge of the dock host.
    const hostBox = await page.locator('[data-testid="dock-host"]').boundingBox();
    expect(hostBox).not.toBeNull();
    await dragFromTo(page, await tabCenter(page, 'color'), {
      x: hostBox!.x + 10,
      y: hostBox!.y + hostBox!.height / 2,
    });

    await expect(page.locator('[data-testid="dock-left"]')).toBeVisible();
    await expect(page.locator('[data-testid="floating-panel-color"]')).toHaveCount(0);
    const layout = await getDockLayout(page);
    expect(layout.floating).toHaveLength(0);
    expect(layout.docks.left).not.toBeNull();
    await expect(page.locator('section[aria-label="Color"]')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/dock-left-edge-docked.png' });
  });

  test('splitting a group by dropping on its edge', async ({ page }) => {
    // Drop Color on the left half of the Layers group → side-by-side split.
    const layersGroup = page.locator('[data-dock-group]').filter({
      has: page.locator('[data-dock-tab="layers"]'),
    });
    const box = await layersGroup.boundingBox();
    expect(box).not.toBeNull();
    await dragFromTo(page, await tabCenter(page, 'color'), {
      x: box!.x + 12,
      y: box!.y + box!.height / 2,
    });

    // Right dock now holds a row split: color | layers.
    const layout = await getDockLayout(page);
    const right = layout.docks.right as { kind: string; direction?: string; children?: { tabs?: string[] }[] };
    expect(right.kind).toBe('split');
    expect(right.direction).toBe('row');
    expect(right.children?.map((c) => c.tabs)).toEqual([['color'], ['layers']]);
    await page.screenshot({ path: 'e2e/screenshots/dock-side-split.png' });
  });

  test('the dock edge splitter resizes the right dock', async ({ page }) => {
    const before = (await getDockLayout(page)).dockSizes.right;
    const splitter = page.locator('[role="separator"][aria-label="Resize right dock"]');
    const box = await splitter.boundingBox();
    expect(box).not.toBeNull();
    const y = box!.y + box!.height / 2;
    await dragFromTo(page, { x: box!.x + 2, y }, { x: box!.x + 2 - 80, y });

    const after = (await getDockLayout(page)).dockSizes.right;
    expect(after).toBe(before! + 80);
    const dockBox = await page.locator('[data-testid="dock-right"]').boundingBox();
    expect(Math.round(dockBox!.width)).toBe(after);
  });

  test('layout persists across reload', async ({ page }) => {
    const canvasBox = await page.locator('[data-testid="canvas-container"]').boundingBox();
    await dragFromTo(page, await tabCenter(page, 'color'), {
      x: canvasBox!.x + canvasBox!.width / 2,
      y: canvasBox!.y + canvasBox!.height / 2,
    });
    await expect(page.locator('[data-testid="floating-panel-color"]')).toBeVisible();
    // Persistence is debounced (400ms).
    await page.waitForTimeout(600);

    await page.reload();
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    await expect(page.locator('[data-testid="floating-panel-color"]')).toBeVisible();
    expect((await getDockLayout(page)).floating).toHaveLength(1);
    expect(await getRightDockTabs(page)).toEqual([['layers']]);
  });

  test('tabs are keyboard-navigable with arrow keys (WAI-ARIA tabs pattern)', async ({ page }) => {
    // Merge color + layers into one 2-tab group so there's something to arrow through.
    const layersBox = await page.locator('section[aria-label="Layers"]').boundingBox();
    await dragFromTo(page, await tabCenter(page, 'color'), {
      x: layersBox!.x + layersBox!.width / 2,
      y: layersBox!.y + layersBox!.height / 2,
    });
    expect(await getRightDockTabs(page)).toEqual([['layers', 'color']]);

    // The active (color) tab is the roving-tabindex stop; focus it and arrow left.
    const colorTab = page.locator('[data-dock-tab="color"]');
    await colorTab.focus();
    await expect(colorTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');

    const layersTab = page.locator('[data-dock-tab="layers"]');
    await expect(layersTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('section[aria-label="Layers"]')).toBeVisible();
    // Focus follows the selection.
    await expect(layersTab).toBeFocused();
  });

  test('escape cancels an in-progress tab drag', async ({ page }) => {
    const from = await tabCenter(page, 'color');
    const canvasBox = await page.locator('[data-testid="canvas-container"]').boundingBox();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2, { steps: 10 });
    await expect(page.locator('[data-testid="dock-drag-ghost"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="dock-drag-ghost"]')).toHaveCount(0);
    await page.mouse.up();

    expect(await getRightDockTabs(page)).toEqual([['color'], ['layers']]);
    expect((await getDockLayout(page)).floating).toHaveLength(0);
  });
});
