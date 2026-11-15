/**
 * #1043 — Chromatic Aberration on a transparent layer took alpha from the
 *         centre sample only, so the outer red/blue fringes vanished.
 * #1027 — Bloom on a transparent layer kept the original alpha, so the
 *         halo's colour was written into invisible pixels.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  applyFilter,
  getPixelAt,
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
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
}

test.describe('Filters keep their effect on transparent layers', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and marquee drags need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    // Transparent document: Layer 1 is the only (transparent) layer.
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(300);
  });

  test('#1043 Chromatic Aberration keeps the outer red/blue fringes', async ({ page }) => {
    await setForegroundColor(page, 255, 255, 255);
    await page.keyboard.press('m');
    await dragMarquee(page, 300, 200, 500, 400);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    expect((await getPixelAt(page, 290, 300)).a).toBe(0);

    await applyFilter(page, 'Chromatic Aberration...', { Amount: 20, Direction: 0 });
    await page.waitForTimeout(300);

    const outerLeft = await getPixelAt(page, 290, 300);
    expect(outerLeft.a).toBeGreaterThan(240);
    expect(outerLeft.r).toBeGreaterThan(240);
    expect(outerLeft.g).toBeLessThan(15);
    expect(outerLeft.b).toBeLessThan(15);

    const outerRight = await getPixelAt(page, 510, 300);
    expect(outerRight.a).toBeGreaterThan(240);
    expect(outerRight.b).toBeGreaterThan(240);
    expect(outerRight.r).toBeLessThan(15);
    expect(outerRight.g).toBeLessThan(15);

    const centre = await getPixelAt(page, 400, 300);
    expect([centre.r, centre.g, centre.b, centre.a]).toEqual([255, 255, 255, 255]);

    // Beyond the shift nothing appears.
    expect((await getPixelAt(page, 270, 300)).a).toBe(0);
  });

  test('#1027 Bloom adds a visible halo around a disc on a transparent layer', async ({ page }) => {
    await setForegroundColor(page, 255, 255, 255);
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragMarquee(page, 260, 260, 340, 340);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    expect((await getPixelAt(page, 345, 300)).a).toBe(0);

    await applyFilter(page, 'Bloom...', { Threshold: 50, Radius: 30, Intensity: 150 });
    await page.waitForTimeout(300);

    const near = await getPixelAt(page, 345, 300);
    const far = await getPixelAt(page, 360, 300);
    expect(near.a).toBeGreaterThan(40);
    expect(near.r).toBeGreaterThan(200);
    expect(far.a).toBeGreaterThan(0);
    // The halo falls off with distance.
    expect(far.a).toBeLessThan(near.a);
    // The disc itself stays opaque white.
    const centre = await getPixelAt(page, 300, 300);
    expect([centre.r, centre.g, centre.b, centre.a]).toEqual([255, 255, 255, 255]);
    // Well beyond the radius nothing is added.
    expect((await getPixelAt(page, 420, 300)).a).toBeLessThan(3);
  });
});
