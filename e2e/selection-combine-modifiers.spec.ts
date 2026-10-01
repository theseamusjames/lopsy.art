/**
 * Shift adds to, Alt subtracts from, and Shift+Alt intersects with the
 * selection for the Rectangular / Elliptical Marquee and the Lasso — the
 * same modifiers as the Magic Wand. Each combine is one undo step, and
 * Edit → Fill paints the combined selection.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getPixelAt,
  setForegroundColor,
  getEditorState,
  undo,
} from './helpers';

type Pt = { x: number; y: number };

async function drag(page: Page, points: Pt[], modifiers: string[] = []): Promise<void> {
  const screen = [];
  for (const p of points) screen.push(await docToScreen(page, p.x, p.y));
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(screen[0]!.x, screen[0]!.y);
  await page.mouse.down();
  for (const s of screen.slice(1)) await page.mouse.move(s.x, s.y, { steps: 6 });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
  await page.waitForTimeout(100);
}

/** A lasso trace around the polygon, closed back on its first point. */
async function lasso(page: Page, pts: Pt[], modifiers: string[] = []): Promise<void> {
  await drag(page, [...pts, pts[0]!], modifiers);
}

async function editFill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await page.waitForTimeout(150);
}

async function alphaAt(page: Page, x: number, y: number): Promise<number> {
  return (await getPixelAt(page, x, y)).a;
}

test.describe('Selection add / subtract / intersect modifiers', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'modifier drags and the menu bar need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
    await setForegroundColor(page, 255, 0, 0);
  });

  test('Shift-lasso two triangles, then Fill paints both; undo drops only the added one', async ({ page }) => {
    const left: Pt[] = [{ x: 40, y: 220 }, { x: 110, y: 60 }, { x: 180, y: 220 }];
    const right: Pt[] = [{ x: 220, y: 220 }, { x: 290, y: 60 }, { x: 360, y: 220 }];
    await page.keyboard.press('l');
    await lasso(page, left);
    await lasso(page, right, ['Shift']);
    await editFill(page);
    await page.screenshot({ path: 'e2e/screenshots/selection-combine-lasso-add.png' });

    expect(await alphaAt(page, 110, 180)).toBe(255); // inside the first triangle
    expect(await alphaAt(page, 290, 180)).toBe(255); // inside the added triangle
    expect((await getPixelAt(page, 290, 180)).r).toBe(255);
    expect(await alphaAt(page, 200, 180)).toBe(0); // the gap between them
    expect(await alphaAt(page, 110, 40)).toBe(0); // above both apexes

    // Undo the Fill, then the Add: the selection is the first triangle again.
    await undo(page);
    await page.waitForTimeout(100);
    expect(await alphaAt(page, 290, 180)).toBe(0);
    const before = (await getEditorState(page)).undoStackLength;
    await undo(page);
    await page.waitForTimeout(100);
    expect((await getEditorState(page)).undoStackLength).toBe(before - 1);
    await editFill(page);
    expect(await alphaAt(page, 110, 180)).toBe(255);
    expect(await alphaAt(page, 290, 180)).toBe(0);
  });

  test('Alt-drag inside a marquee cuts a hole instead of moving the outline', async ({ page }) => {
    await page.keyboard.press('m');
    await drag(page, [{ x: 50, y: 50 }, { x: 250, y: 200 }]);
    // Starts inside the selection: without Alt this would drag the outline.
    await drag(page, [{ x: 100, y: 100 }, { x: 160, y: 150 }], ['Alt']);
    await editFill(page);
    await page.screenshot({ path: 'e2e/screenshots/selection-combine-marquee-subtract.png' });

    expect(await alphaAt(page, 130, 125)).toBe(0); // the hole
    expect(await alphaAt(page, 70, 70)).toBe(255); // ring, top-left
    expect(await alphaAt(page, 230, 185)).toBe(255); // ring, bottom-right
    expect(await alphaAt(page, 40, 40)).toBe(0); // outside the marquee
  });

  test('Shift-drag from a selection corner handle adds instead of scaling', async ({ page }) => {
    await page.keyboard.press('m');
    await drag(page, [{ x: 50, y: 50 }, { x: 150, y: 150 }]);
    // (150, 150) is the bottom-right scale handle.
    await drag(page, [{ x: 150, y: 150 }, { x: 250, y: 250 }], ['Shift']);
    await editFill(page);
    await page.screenshot({ path: 'e2e/screenshots/selection-combine-marquee-add-handle.png' });

    expect(await alphaAt(page, 100, 100)).toBe(255); // original square
    expect(await alphaAt(page, 200, 200)).toBe(255); // added square
    // A scale would have filled the whole 50..250 box; the union does not.
    expect(await alphaAt(page, 200, 80)).toBe(0);
    expect(await alphaAt(page, 80, 200)).toBe(0);
  });

  test('holding Shift or Alt over a handle swaps the resize cursor for the tool cursor', async ({ page }) => {
    const container = page.locator('[data-testid="canvas-container"]');
    await page.keyboard.press('m');
    await drag(page, [{ x: 50, y: 50 }, { x: 150, y: 150 }]);
    // Rest the pointer on the bottom-right scale handle.
    const handle = await docToScreen(page, 150, 150);
    await page.mouse.move(handle.x - 1, handle.y - 1);
    await page.mouse.move(handle.x, handle.y);
    await expect(container).toHaveClass(/canvasNwseResize/);

    // No pointer movement from here on: the keys alone change the cursor.
    await page.keyboard.down('Shift');
    await expect(container).toHaveClass(/canvasCrosshair/);
    await expect(container).not.toHaveClass(/canvasNwseResize/);
    await page.keyboard.up('Shift');
    await expect(container).toHaveClass(/canvasNwseResize/);

    await page.keyboard.down('Alt');
    await expect(container).toHaveClass(/canvasCrosshair/);
    await page.keyboard.up('Alt');
    await expect(container).toHaveClass(/canvasNwseResize/);
  });

  test('Shift+Alt with the Elliptical Marquee keeps only the overlap', async ({ page }) => {
    await page.keyboard.press('m');
    await drag(page, [{ x: 50, y: 50 }, { x: 200, y: 200 }]);
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await drag(page, [{ x: 150, y: 100 }, { x: 300, y: 250 }], ['Shift', 'Alt']);
    await editFill(page);
    await page.screenshot({ path: 'e2e/screenshots/selection-combine-ellipse-intersect.png' });

    expect(await alphaAt(page, 185, 185)).toBe(255); // in square and ellipse
    expect(await alphaAt(page, 80, 80)).toBe(0); // square only
    expect(await alphaAt(page, 260, 200)).toBe(0); // ellipse only
  });
});
