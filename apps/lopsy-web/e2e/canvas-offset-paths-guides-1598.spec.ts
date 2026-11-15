// #1598 — Image → Border (expand), Image → Canvas Size and Edit → Crop moved
// pixels and text but left vector paths and guides at their old document
// coordinates, off the moved artwork.
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

/** Click the top ruler at doc x (vertical guide) and the left ruler at doc y (horizontal guide). */
async function addGuides(page: Page, vx: number, hy: number): Promise<void> {
  const rect = await containerRect(page);
  await page.mouse.click((await docToScreen(page, vx, 0)).x, rect.top + 6);
  await page.waitForTimeout(150);
  await page.mouse.click(rect.left + 6, (await docToScreen(page, 0, hy)).y);
  await page.waitForTimeout(150);
}

interface Setup {
  guides: GuideSnap[];
  anchors: Array<{ x: number; y: number }>;
}

/** 800×600 doc, guides at x=400 / y=300, and a Pen path (200,300)→(600,300). */
async function setUp(page: Page): Promise<Setup> {
  await createDocument(page, 800, 600, false);
  await page.waitForSelector('[data-testid="canvas-container"]');

  await addGuides(page, 400, 300);
  const guides = await readGuides(page);
  expect(guides.map((g) => g.orientation)).toEqual(['vertical', 'horizontal']);
  expect(Math.abs(guides[0]!.position - 400)).toBeLessThanOrEqual(2);
  expect(Math.abs(guides[1]!.position - 300)).toBeLessThanOrEqual(2);

  await page.keyboard.press('p');
  await clickDoc(page, 200, 300);
  await clickDoc(page, 600, 300);
  await page.locator('[aria-label="Commit path"]').click();
  await page.waitForTimeout(200);
  // Pointer coordinates can land a doc pixel short; later checks compare
  // against where the clicks actually landed.
  const anchors = anchorPoints(await readPaths(page));
  expectPointsAt(anchors, [{ x: 200, y: 300 }, { x: 600, y: 300 }], 2);
  return { guides, anchors };
}

function shiftGuides(guides: GuideSnap[], dx: number, dy: number): GuideSnap[] {
  return guides.map((g) => ({ ...g, position: g.position + (g.orientation === 'vertical' ? dx : dy) }));
}

function shiftPoints(points: Array<{ x: number; y: number }>, dx: number, dy: number): Array<{ x: number; y: number }> {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

async function expectOverlays(page: Page, guides: GuideSnap[], anchors: Array<{ x: number; y: number }>): Promise<void> {
  expect(await readGuides(page)).toEqual(guides);
  expectPointsAt(anchorPoints(await readPaths(page)), anchors, 0.01);
}

test.describe('#1598 — canvas offsets move paths and guides', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers need a desktop viewport');
    await page.goto('/');
    await waitForStore(page);
  });

  test('Border with Expand canvas shifts paths and guides; undo/redo follow', async ({ page }) => {
    const before = await setUp(page);

    await menu(page, 'Image', /^Border/);
    const dialog = page.getByRole('dialog', { name: 'Border' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Border width (px)').fill('100');
    await dialog.getByLabel('Expand canvas').check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/canvas-offset-overlays-border.png' });

    const doc = (await getEditorState(page)).document;
    expect([doc.width, doc.height]).toEqual([1000, 800]);
    const afterGuides = shiftGuides(before.guides, 100, 100);
    const afterAnchors = shiftPoints(before.anchors, 100, 100);
    await expectOverlays(page, afterGuides, afterAnchors);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await undo(page);
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.width).toBe(800);
    await expectOverlays(page, before.guides, before.anchors);

    await redo(page);
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.width).toBe(1000);
    await expectOverlays(page, afterGuides, afterAnchors);
  });

  test('Canvas Size with the centre anchor shifts paths and guides', async ({ page }) => {
    const before = await setUp(page);

    await menu(page, 'Image', /^Canvas Size/);
    const dialog = page.getByRole('dialog', { name: 'Canvas Size' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="number"]').first().fill('1000');
    await dialog.locator('input[type="number"]').nth(1).fill('800');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);

    const doc = (await getEditorState(page)).document;
    expect([doc.width, doc.height]).toEqual([1000, 800]);
    await expectOverlays(page, shiftGuides(before.guides, 100, 100), shiftPoints(before.anchors, 100, 100));

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await undo(page);
    await page.waitForTimeout(200);
    await expectOverlays(page, before.guides, before.anchors);
  });

  test('Edit → Crop to a marquee shifts paths and guides by the crop origin', async ({ page }) => {
    const before = await setUp(page);

    await page.keyboard.press('m');
    const a = await docToScreen(page, 200, 100);
    const b = await docToScreen(page, 700, 500);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The marquee may land a doc pixel off; crop from where it landed.
    const bounds = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: { x: number; y: number; width: number; height: number } | null } };
      };
      return store.getState().selection.bounds;
    });
    expect(bounds).not.toBeNull();
    const originX = Math.round(bounds!.x);
    const originY = Math.round(bounds!.y);
    expect(Math.abs(originX - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(originY - 100)).toBeLessThanOrEqual(2);

    await menu(page, 'Edit', /^Crop$/);
    await page.screenshot({ path: 'e2e/screenshots/canvas-offset-overlays-crop.png' });

    const doc = (await getEditorState(page)).document;
    expect(Math.abs(doc.width - 500)).toBeLessThanOrEqual(2);
    expect(Math.abs(doc.height - 400)).toBeLessThanOrEqual(2);

    await expectOverlays(page, shiftGuides(before.guides, -originX, -originY), shiftPoints(before.anchors, -originX, -originY));

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await undo(page);
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.width).toBe(800);
    await expectOverlays(page, before.guides, before.anchors);
  });
});
