import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';

// #1083: the Pen tool's ✓ / ✗ buttons floated on the canvas just left of the
// first anchor, so an anchor click there hit ✗ and discarded the whole
// in-progress path. They now live in the options bar.

interface DocPoint { x: number; y: number }

// Clicks the whole screen pixel nearest (x, y) and returns the document point
// under it, rounded as the test reads anchors. Firefox truncates pointer
// coordinates to whole CSS pixels while Chromium keeps the fraction, so
// expected anchors must come from the pixel actually clicked.
async function clickAtDoc(page: Page, x: number, y: number): Promise<DocPoint> {
  const p = await docToScreen(page, x, y);
  const origin = await docToScreen(page, 0, 0);
  const unit = await docToScreen(page, 1, 1);
  const sx = Math.round(p.x);
  const sy = Math.round(p.y);
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(80);
  return {
    x: Math.round((sx - origin.x) / (unit.x - origin.x)),
    y: Math.round((sy - origin.y) / (unit.y - origin.y)),
  };
}

async function pathsState(page: Page): Promise<Array<{ anchors: Array<{ x: number; y: number }>; closed: boolean }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ anchors: Array<{ point: { x: number; y: number } }>; closed: boolean }> };
    };
    return store.getState().paths.map((p) => ({
      anchors: p.anchors.map((a) => ({ x: Math.round(a.point.x), y: Math.round(a.point.y) })),
      closed: p.closed,
    }));
  });
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

test.describe('Pen tool commit / cancel buttons do not block anchor clicks (#1083)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'pen tool anchor placement needs a desktop pointer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1200, 900, false);
    await page.keyboard.press('p');
    await page.waitForTimeout(100);
  });

  test('an anchor click just left of and below the first anchor places an anchor', async ({ page }) => {
    const a = await clickAtDoc(page, 600, 300);
    const b = await clickAtDoc(page, 700, 380);
    const c = await clickAtDoc(page, 640, 420);

    // 30 screen px left of and 32 below the first anchor — where the floating
    // ✗ used to sit.
    const first = await docToScreen(page, 600, 300);
    const target = { x: first.x - 30, y: first.y + 32 };
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('button')?.getAttribute('aria-label') ?? el?.tagName ?? null;
    }, target);
    await page.screenshot({ path: 'e2e/screenshots/pen-action-buttons-1083.png' });
    expect(hit).toBe('CANVAS');

    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(80);
    await clickAtDoc(page, 600, 300);
    await page.waitForTimeout(150);

    const paths = await pathsState(page);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.closed).toBe(true);
    expect(paths[0]!.anchors).toHaveLength(4);
    expect(paths[0]!.anchors.slice(0, 3)).toEqual([a, b, c]);
    const fourth = paths[0]!.anchors[3]!;
    expect(fourth.x).toBeLessThan(a.x);
    expect(fourth.y).toBeGreaterThan(a.y);
  });

  test('Commit path and Cancel path sit in the options bar and act on the draft', async ({ page }) => {
    const optionsBar = page.locator('role=toolbar');
    const commit = optionsBar.locator('button[aria-label="Commit path"]');
    const cancel = optionsBar.locator('button[aria-label="Cancel path"]');
    await expect(commit).toBeDisabled();
    await expect(cancel).toBeDisabled();

    await clickAtDoc(page, 300, 300);
    await expect(commit).toBeDisabled();
    await expect(cancel).toBeEnabled();
    await clickAtDoc(page, 500, 300);
    await clickAtDoc(page, 500, 500);
    await expect(commit).toBeEnabled();

    await cancel.click();
    await page.waitForTimeout(100);
    expect(await pathsState(page)).toEqual([]);
    await expect(cancel).toBeDisabled();

    const before = await historyLabels(page);
    const a = await clickAtDoc(page, 300, 300);
    const b = await clickAtDoc(page, 500, 300);
    const c = await clickAtDoc(page, 500, 500);
    await commit.click();
    await page.waitForTimeout(100);
    expect(await pathsState(page)).toEqual([{
      anchors: [a, b, c],
      closed: false,
    }]);
    // Commit adds the path without stroking it.
    expect(await historyLabels(page)).toEqual([...before, 'Add Path']);
    await expect(commit).toBeDisabled();
  });
});
