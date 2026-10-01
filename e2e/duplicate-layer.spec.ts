/**
 * #804 — Duplicate Layer made the copy active but left the original in the
 *        multi-selection, so the next arrow-key nudge moved both layers.
 * #805 — Duplicating a group interleaved the copy's children with the
 *        source's children in the stack instead of producing one
 *        self-contained group copy directly above the original.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
} from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): Promise<void> {
  await page.keyboard.press('m');
  await dragMarquee(page, x0, y0, x1, y1);
  await setForegroundColor(page, ...rgb);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

/** Composited (on-screen) colour at a document point, at the current viewport. */
async function compositeAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as [number, number, number];
  }, { x, y });
}

function expectNear(actual: [number, number, number], expected: [number, number, number], tol = 4): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tol);
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId!;
}

async function selectedLayerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { selectedLayerIds: string[] } };
    };
    return [...store.getState().document.selectedLayerIds];
  });
}

/** Layer ids in the order the Layers panel shows them, top to bottom. */
async function panelRowIds(page: Page): Promise<string[]> {
  return page.locator('[data-layer-id]').evaluateAll(
    (rows) => rows.map((r) => r.getAttribute('data-layer-id') ?? ''),
  );
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const WHITE: [number, number, number] = [255, 255, 255];

test.describe('Duplicate Layer', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layers panel and menus need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('#804 the next nudge moves only the copy, not the original', async ({ page }) => {
    const originalId = await activeLayerId(page);
    await fillRect(page, 100, 100, 200, 200, RED);

    await page.locator(`[data-layer-id="${originalId}"]`).click();
    await page.locator('[aria-label="Duplicate Layer"]').click();
    await settle(page);

    const copyId = await activeLayerId(page);
    expect(copyId).not.toBe(originalId);
    expect(await selectedLayerIds(page)).toEqual([copyId]);

    // The copy sits at +10/+10: red spans 100..210 on both axes.
    await page.keyboard.press('v');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await settle(page);
    await page.screenshot({ path: 'e2e/screenshots/duplicate-layer-nudge-copy-only.png' });

    // The original's left edge stays at x = 100. Had the original been
    // nudged along with the copy, columns 100..104 would show the white
    // background (its left edge would be at 105, the copy's at 115).
    expectNear(await compositeAt(page, 102, 150), RED);
    expectNear(await compositeAt(page, 98, 150), WHITE);
    // The copy moved 5 px right: it now ends at x = 215.
    expectNear(await compositeAt(page, 213, 150), RED);
    expectNear(await compositeAt(page, 217, 150), WHITE);
  });

  test('#805 a duplicated group is one self-contained block above the original', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    const redId = await activeLayerId(page);
    await fillRect(page, 100, 100, 300, 250, RED);
    await page.locator('[aria-label="Add Layer"]').click();
    const blueId = await activeLayerId(page);
    await fillRect(page, 150, 150, 250, 200, BLUE);

    await page.locator(`[data-layer-id="${groupId}"]`).click();
    await settle(page);
    await page.locator('[aria-label="Duplicate Layer"]').click();
    await settle(page);

    const doc = (await getEditorState(page)).document;
    const copyGroupId = doc.activeLayerId!;
    expect(copyGroupId).not.toBe(groupId);
    expect(await selectedLayerIds(page)).toEqual([copyGroupId]);

    const copyGroup = doc.layers.find((l) => l.id === copyGroupId) as { children: string[] };
    expect(copyGroup.children).toHaveLength(2);
    const [redCopyId, blueCopyId] = copyGroup.children as [string, string];

    await page.screenshot({ path: 'e2e/screenshots/duplicate-group-self-contained.png' });

    // The copy (+10/+10) composites entirely above the original group:
    // its red rect (110..310 × 110..260) covers the original blue square
    // (150..250 × 150..200) where the copy's blue (160..260 × 160..210)
    // does not reach. Interleaved, the original blue drew over the copy's red.
    expectNear(await compositeAt(page, 155, 155), RED);
    expectNear(await compositeAt(page, 200, 180), BLUE);
    expectNear(await compositeAt(page, 305, 255), RED);
    expectNear(await compositeAt(page, 105, 105), RED);
    expectNear(await compositeAt(page, 95, 105), WHITE);

    // Panel, top to bottom: the copy group with its own two children, then
    // the original group with its two. Interleaving put each "copy" row
    // directly above its source inside the original group.
    const rows = await panelRowIds(page);
    const start = rows.indexOf(copyGroupId);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(rows.slice(start, start + 6)).toEqual([
      copyGroupId, blueCopyId, redCopyId, groupId, blueId, redId,
    ]);
  });
});
