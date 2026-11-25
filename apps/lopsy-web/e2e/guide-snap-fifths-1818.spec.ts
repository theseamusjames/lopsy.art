// #1818 — Cmd/Ctrl-clicking a ruler snaps the new guide to a layout
// fraction of the canvas. Thirds were already stops; fifths are now too.
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';

interface GuideSnap {
  orientation: string;
  position: number;
}

async function readGuides(page: Page): Promise<GuideSnap[]> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { guides: GuideSnap[] };
    };
    return ui.getState().guides.map((g) => ({ orientation: g.orientation, position: g.position }));
  });
}

async function containerTopLeft(page: Page): Promise<{ left: number; top: number }> {
  const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!box) throw new Error('canvas container not found');
  return { left: box.x, top: box.y };
}

/** Modifier-click the top ruler above doc-x, which adds a vertical guide. */
async function snapClickTopRuler(page: Page, docX: number): Promise<void> {
  const { top } = await containerTopLeft(page);
  const { x } = await docToScreen(page, docX, 0);
  await page.keyboard.down('Control');
  await page.mouse.click(x, top + 6);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
}

/** Modifier-click the left ruler beside doc-y, which adds a horizontal guide. */
async function snapClickLeftRuler(page: Page, docY: number): Promise<void> {
  const { left } = await containerTopLeft(page);
  const { y } = await docToScreen(page, 0, docY);
  await page.keyboard.down('Control');
  await page.mouse.click(left + 6, y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
}

test.describe('#1818 — guide snaps include thirds and fifths', () => {
  test('Ctrl-clicking the rulers snaps guides to fifths and thirds', async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers are hidden on touch UIs');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1000, 600);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Each click lands a few pixels off the stop, nearer to it than to any
    // other stop, so only a snap can put the guide exactly on it.
    // 1/5 of 1000 = 200 (nearest other stop: 3/16 = 187.5).
    await snapClickTopRuler(page, 204);
    // 2/5 = 400 (3/8 = 375, 7/16 = 437.5).
    await snapClickTopRuler(page, 396);
    // 4/5 = 800 (13/16 = 812.5).
    await snapClickTopRuler(page, 797);
    // 1/3 of 1000 = 333.
    await snapClickTopRuler(page, 338);
    // 3/5 of 600 = 360 (5/8 = 375).
    await snapClickLeftRuler(page, 357);
    // 1/3 of 600 = 200 (5/16 = 187.5).
    await snapClickLeftRuler(page, 203);

    const guides = await readGuides(page);
    const vertical = guides.filter((g) => g.orientation === 'vertical').map((g) => g.position);
    const horizontal = guides.filter((g) => g.orientation === 'horizontal').map((g) => g.position);
    expect(vertical).toEqual([200, 400, 800, 333]);
    expect(horizontal).toEqual([360, 200]);
  });

  test('a plain ruler click does not snap', async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers are hidden on touch UIs');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1000, 600);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const { top } = await containerTopLeft(page);
    const { x } = await docToScreen(page, 210, 0);
    await page.mouse.click(x, top + 6);
    await page.waitForTimeout(100);

    const vertical = (await readGuides(page)).filter((g) => g.orientation === 'vertical');
    expect(vertical).toHaveLength(1);
    expect(Math.abs(vertical[0]!.position - 200)).toBeGreaterThan(4);
  });
});
