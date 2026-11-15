// #1363 — Image → Image Size resampled the layers but left vector paths and
// guides at their old document coordinates, so path-bound text jumped back to
// the unscaled path the next time anything re-laid it.
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, getEditorState, redo, undo, waitForStore } from './helpers';

interface PathSnap {
  anchors: Array<{ point: { x: number; y: number } }>;
}

async function readPaths(page: Page): Promise<PathSnap[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: PathSnap[] };
    };
    return store.getState().paths;
  });
}

async function readGuides(page: Page): Promise<Array<{ orientation: string; position: number }>> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guides: Array<{ orientation: string; position: number }> };
    };
    return ui.getState().guides;
  });
}

async function readTextLayer(page: Page): Promise<{ x: number; y: number; pathId?: string }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ type: string; x: number; y: number; pathId?: string }> } };
    };
    const t = store.getState().document.layers.find((l) => l.type === 'text')!;
    return { x: t.x, y: t.y, pathId: t.pathId };
  });
}

function anchorPoints(paths: PathSnap[]): Array<{ x: number; y: number }> {
  return paths[0]!.anchors.map((a) => ({ x: a.point.x, y: a.point.y }));
}

function expectPointsAt(
  actual: Array<{ x: number; y: number }>,
  expected: Array<{ x: number; y: number }>,
  slop: number,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThanOrEqual(slop);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThanOrEqual(slop);
  });
}

function scaled(points: Array<{ x: number; y: number }>, k: number): Array<{ x: number; y: number }> {
  return points.map((p) => ({ x: p.x * k, y: p.y * k }));
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
}

test.describe('#1363 — Image Size scales paths and guides', () => {
  test('paths and guides follow the resize, undo/redo, and path text stays put', async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers and the text options bar need a desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 800, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // A vertical guide down the middle: click the top ruler band at doc x=400.
    const rulerX = (await docToScreen(page, 400, 0)).x;
    const containerTop = await page.evaluate(
      () => document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect().top,
    );
    await page.mouse.click(rulerX, containerTop + 6);
    await page.waitForTimeout(150);
    const guidesBefore = await readGuides(page);
    expect(guidesBefore).toHaveLength(1);
    expect(guidesBefore[0]!.orientation).toBe('vertical');
    const guideBefore = guidesBefore[0]!.position;
    expect(Math.abs(guideBefore - 400)).toBeLessThanOrEqual(2);

    // A straight pen path from (100, 400) to (700, 400).
    await page.keyboard.press('p');
    await clickDoc(page, 100, 400);
    await clickDoc(page, 700, 400);
    await page.locator('[aria-label="Commit path"]').click();
    await page.waitForTimeout(200);
    // Firefox truncates pointer coordinates to whole CSS pixels, so the clicks
    // can land a doc pixel short; later checks compare against where they landed.
    const anchorsBefore = anchorPoints(await readPaths(page));
    expectPointsAt(anchorsBefore, [{ x: 100, y: 400 }, { x: 700, y: 400 }], 2);
    const pathId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ id: string }> };
      };
      return store.getState().paths[0]!.id;
    });

    // Text bound to the path.
    await page.keyboard.press('t');
    await clickDoc(page, 100, 100);
    await page.keyboard.type('HELLO PATH');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.locator('[aria-label="Text path"]').selectOption(pathId);
    await expect.poll(async () => (await readTextLayer(page)).pathId).toBe(pathId);
    await page.waitForTimeout(400);
    const textOnPath = await readTextLayer(page);
    // Sits on the y=400 line, well below where it was typed.
    expect(textOnPath.y).toBeGreaterThan(300);

    // Image Size 800 → 400 (height follows).
    await page.locator('button:has-text("Image")').first().click();
    await page.locator('[role="menuitem"]:has-text("Image Size")').click();
    const dialog = page.getByRole('dialog', { name: 'Image Size' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="number"]').first().fill('400');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);
    expect((await getEditorState(page)).document.width).toBe(400);

    expectPointsAt(anchorPoints(await readPaths(page)), scaled(anchorsBefore, 0.5), 0.01);
    expect((await readGuides(page))[0]!.position).toBeCloseTo(guideBefore / 2, 5);
    const textAfterResize = await readTextLayer(page);
    expect(Math.abs(textAfterResize.y - textOnPath.y / 2)).toBeLessThanOrEqual(6);

    // Re-binding re-lays the text on the path; it must land where it already
    // is, not back on the unscaled y=400 line (the bottom edge).
    await page.locator('[aria-label="Text path"]').selectOption({ label: 'None' });
    await page.waitForTimeout(300);
    await page.locator('[aria-label="Text path"]').selectOption(pathId);
    await page.waitForTimeout(500);
    const rebound = await readTextLayer(page);
    expect(Math.abs(rebound.y - textAfterResize.y)).toBeLessThanOrEqual(6);
    expect(Math.abs(rebound.x - textAfterResize.x)).toBeLessThanOrEqual(6);

    // Undo back past the re-bind steps to before Image Size: paths and guide
    // return to their original coordinates.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 10 && (await getEditorState(page)).document.width !== 800; i++) {
      await undo(page);
      await page.waitForTimeout(150);
    }
    expect((await getEditorState(page)).document.width).toBe(800);
    expectPointsAt(anchorPoints(await readPaths(page)), anchorsBefore, 0.01);
    expect((await readGuides(page))[0]!.position).toBeCloseTo(guideBefore, 5);

    await redo(page);
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.width).toBe(400);
    expectPointsAt(anchorPoints(await readPaths(page)), scaled(anchorsBefore, 0.5), 0.01);
    expect((await readGuides(page))[0]!.position).toBeCloseTo(guideBefore / 2, 5);
  });
});
