/**
 * A marquee drag whose edge ends within 8 screen px of a guide lands on the
 * guide. View → Snap to Guides turns it off.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getPixelAt,
  setForegroundColor,
} from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editFill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await page.waitForTimeout(150);
}

/** Cmd/Ctrl-click the top ruler above doc x: drops a vertical guide on the nearest layout fraction. */
async function dropVerticalGuideAtFraction(page: Page, docX: number): Promise<void> {
  const container = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!container) throw new Error('no canvas container');
  const { x } = await docToScreen(page, docX, 0);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.click(x, container.y + 10);
  await page.keyboard.up('ControlOrMeta');
  await page.mouse.move(container.x + container.width / 2, container.y + container.height - 10);
  await page.waitForTimeout(100);
}

async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number } };
    };
    return store.getState().viewport.zoom;
  });
}

test.describe('Marquee snaps to guides', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'rulers and the menu bar need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
    await setForegroundColor(page, 255, 0, 0);
    // Half of 400: a guide at exactly x = 200.
    await dropVerticalGuideAtFraction(page, 200);
  });

  test('a drag released 4 px short of a guide fills right up to it', async ({ page }) => {
    // 4 doc px must be inside the 8 screen px reach at this zoom.
    expect(4 * (await zoom(page))).toBeLessThanOrEqual(8);
    await page.keyboard.press('m');
    await dragMarquee(page, 50, 50, 196, 150);
    await editFill(page);
    await page.screenshot({ path: 'e2e/screenshots/marquee-guide-snap.png' });

    expect((await getPixelAt(page, 199, 100)).a).toBe(255); // last column before the guide
    expect((await getPixelAt(page, 200, 100)).a).toBe(0); // the guide is the edge
    expect((await getPixelAt(page, 50, 50)).a).toBe(255);
  });

  test('the elliptical marquee snaps the same way', async ({ page }) => {
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    // Drag the left edge out from just right of the guide.
    await dragMarquee(page, 203, 50, 343, 250);
    await editFill(page);
    await page.screenshot({ path: 'e2e/screenshots/marquee-guide-snap-ellipse.png' });

    // Ellipse spans x 200..343 → its leftmost point is at x ≈ 200 on y = 150.
    expect((await getPixelAt(page, 201, 150)).a).toBeGreaterThan(200);
    expect((await getPixelAt(page, 199, 150)).a).toBe(0);
  });

  test('View → Snap to Guides off leaves the drag where it was released', async ({ page }) => {
    await page.getByRole('button', { name: 'View' }).click();
    await page.locator('[role="menuitem"]:has-text("Snap to Guides")').click();
    await page.keyboard.press('m');
    await dragMarquee(page, 50, 50, 196, 150);
    await editFill(page);

    expect((await getPixelAt(page, 195, 100)).a).toBe(255);
    expect((await getPixelAt(page, 197, 100)).a).toBe(0);
    expect((await getPixelAt(page, 199, 100)).a).toBe(0);
  });
});
