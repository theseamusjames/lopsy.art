// #1401 — Image → Rotate 90° turned the layers and swapped the document size
// but left guides and vector paths at their old document coordinates, off the
// rotated artwork and sometimes past the new canvas edge.
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, getEditorState, redo, undo, waitForStore } from './helpers';

interface PathSnap {
  anchors: Array<{ point: { x: number; y: number } }>;
}

interface GuideSnap {
  orientation: string;
  position: number;
}

async function readPaths(page: Page): Promise<PathSnap[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: PathSnap[] };
    };
    return store.getState().paths;
  });
}

async function readGuides(page: Page): Promise<GuideSnap[]> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guides: GuideSnap[] };
    };
    return ui.getState().guides.map((g) => ({ orientation: g.orientation, position: Math.round(g.position) }));
  });
}

function anchorPoints(paths: PathSnap[]): Array<{ x: number; y: number }> {
  return paths[0]!.anchors.map((a) => ({ x: Math.round(a.point.x), y: Math.round(a.point.y) }));
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
}

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(300);
}

async function containerRect(page: Page): Promise<{ left: number; top: number }> {
  return page.evaluate(() => {
    const r = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
}

/** Click the top ruler at doc x (vertical guide) or the left ruler at doc y (horizontal guide). */
async function addGuides(page: Page, vx: number, hy: number): Promise<void> {
  const rect = await containerRect(page);
  await page.mouse.click((await docToScreen(page, vx, 0)).x, rect.top + 6);
  await page.waitForTimeout(150);
  await page.mouse.click(rect.left + 6, (await docToScreen(page, 0, hy)).y);
  await page.waitForTimeout(150);
}

/** Guide positions are snapped to whole document pixels, but ruler clicks may land ±1. */
function expectGuidesNear(actual: GuideSnap[], expected: GuideSnap[]): void {
  expect(actual.map((g) => g.orientation)).toEqual(expected.map((g) => g.orientation));
  actual.forEach((g, i) => expect(Math.abs(g.position - expected[i]!.position)).toBeLessThanOrEqual(2));
}

test.describe('#1401 — Rotate Image turns paths and guides', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers need a desktop viewport');
    await page.goto('/');
    await waitForStore(page);
  });

  test('CW turns guides and a pen path with the canvas; undo/redo follow', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await addGuides(page, 200, 100);
    const guidesBefore = await readGuides(page);
    expectGuidesNear(guidesBefore, [
      { orientation: 'vertical', position: 200 },
      { orientation: 'horizontal', position: 100 },
    ]);

    await page.keyboard.press('p');
    await clickDoc(page, 100, 500);
    await clickDoc(page, 700, 500);
    await page.locator('[aria-label="Commit path"]').click();
    await page.waitForTimeout(200);
    expect(anchorPoints(await readPaths(page))).toEqual([{ x: 100, y: 500 }, { x: 700, y: 500 }]);

    await menu(page, 'Image', /^Rotate 90° CW/);
    const doc = (await getEditorState(page)).document;
    expect([doc.width, doc.height]).toEqual([600, 800]);

    // CW: (x, y) → (oldH − y, x), oldH = 600.
    const [v, h] = guidesBefore;
    const turned = [
      { orientation: 'horizontal', position: v!.position },
      { orientation: 'vertical', position: 600 - h!.position },
    ];
    expect(await readGuides(page)).toEqual(turned);
    expect(anchorPoints(await readPaths(page))).toEqual([{ x: 100, y: 100 }, { x: 100, y: 700 }]);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await undo(page);
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.width).toBe(800);
    expect(await readGuides(page)).toEqual(guidesBefore);
    expect(anchorPoints(await readPaths(page))).toEqual([{ x: 100, y: 500 }, { x: 700, y: 500 }]);

    await redo(page);
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.width).toBe(600);
    expect(await readGuides(page)).toEqual(turned);
    expect(anchorPoints(await readPaths(page))).toEqual([{ x: 100, y: 100 }, { x: 100, y: 700 }]);
  });

  test('CCW on a square canvas turns guides, and undo restores them', async ({ page }) => {
    await createDocument(page, 600, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await addGuides(page, 200, 100);
    const guidesBefore = await readGuides(page);
    expect(guidesBefore).toHaveLength(2);

    await menu(page, 'Image', /^Rotate 90° CCW/);
    // CCW: (x, y) → (y, oldW − x), oldW = 600.
    const [v, h] = guidesBefore;
    expect(await readGuides(page)).toEqual([
      { orientation: 'horizontal', position: 600 - v!.position },
      { orientation: 'vertical', position: h!.position },
    ]);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await undo(page);
    await page.waitForTimeout(200);
    expect(await readGuides(page)).toEqual(guidesBefore);
  });
});
