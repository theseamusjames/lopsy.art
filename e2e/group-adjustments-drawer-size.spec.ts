import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, getEditorState, expectPointerReachable } from './helpers';

const VIEWPORT = { width: 1600, height: 1000 };

async function openGroupAdjustments(page: Page): Promise<void> {
  await page.locator('[aria-label="New Group"]').click();
  const groupId = (await getEditorState(page)).document.activeLayerId!;
  await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label*="effects"]').click();
  await expect(page.getByTestId('effects-drawer')).toBeVisible();
}

test.describe('Group adjustments drawer size', () => {
  test.use({ viewport: VIEWPORT });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'drawers require the sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('opens at half the window height with the footer at the bottom', async ({ page }) => {
    await openGroupAdjustments(page);
    await page.screenshot({ path: 'e2e/screenshots/group-adjustments-drawer-size.png' });

    const drawer = page.getByTestId('effects-drawer');
    const box = (await drawer.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(VIEWPORT.height / 2);

    // The extra height goes to the list, not to a gap under the footer.
    const buttonBox = (await drawer.locator('[aria-label="Add Adjustment"]').boundingBox())!;
    expect(box.y + box.height - (buttonBox.y + buttonBox.height)).toBeLessThan(24);
  });

  test('shows the whole Add Adjustment menu without clipping', async ({ page }) => {
    await openGroupAdjustments(page);
    await page.locator('[aria-label="Add Adjustment"]').click();
    await page.screenshot({ path: 'e2e/screenshots/group-adjustments-drawer-size-menu.png' });

    await expectPointerReachable(page.getByRole('menuitem', { name: 'Exposure', exact: true }));
  });

  test('yields to the room below when dragged down', async ({ page }) => {
    await openGroupAdjustments(page);
    const drawer = page.getByTestId('effects-drawer');
    const headerBox = (await drawer.locator('div[class*="header"]').first().boundingBox())!;
    const startX = headerBox.x + headerBox.width / 2;
    const startY = headerBox.y + headerBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 200, { steps: 10 });
    await page.mouse.up();
    await page.screenshot({ path: 'e2e/screenshots/group-adjustments-drawer-size-dragged.png' });

    const box = (await drawer.boundingBox())!;
    expect(box.y).toBeGreaterThan(headerBox.y + 150);
    expect(box.height).toBeLessThan(VIEWPORT.height / 2);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test('keeps the header and footer in view when the list overflows', async ({ page }) => {
    await openGroupAdjustments(page);
    const drawer = page.getByTestId('effects-drawer');
    for (const name of ['Exposure', 'Contrast', 'Levels', 'Channel Mixer', 'Color Grading']) {
      await drawer.locator('[aria-label="Add Adjustment"]').click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    }

    const list = drawer.locator('div[class*="scrollArea"]');
    await list.hover();
    await page.mouse.wheel(0, 5000);
    await page.screenshot({ path: 'e2e/screenshots/group-adjustments-drawer-scrolled.png' });

    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await drawer.evaluate((el) => el.scrollTop)).toBe(0);

    const drawerBox = (await drawer.boundingBox())!;
    const headerBox = (await drawer.locator('div[class*="header"]').first().boundingBox())!;
    const footerBox = (await drawer.locator('[aria-label="Add Adjustment"]').boundingBox())!;
    expect(headerBox.y).toBeGreaterThanOrEqual(drawerBox.y);
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(drawerBox.y + drawerBox.height);
    await expectPointerReachable(drawer.getByRole('button', { name: 'Close effects' }));
    await expectPointerReachable(drawer.locator('[aria-label="Add Adjustment"]'));
  });

  test('gives the layer effects drawer the same height as the group drawer (#1639)', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await page.locator(`[data-layer-id="${layerId}"]`).locator('button[aria-label*="effects"]').click();
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/layer-effects-drawer-size-1639.png' });

    const box = (await drawer.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(VIEWPORT.height / 2);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);

    // The panel fills the drawer: Rasterize Layer Style stays pinned to the
    // drawer's foot instead of leaving a gap below the effect list.
    const rasterize = (await drawer.getByRole('button', { name: 'Rasterize Layer Style' }).boundingBox())!;
    expect(box.y + box.height - (rasterize.y + rasterize.height)).toBeLessThan(24);
    expect(await drawer.evaluate((el) => el.scrollTop)).toBe(0);
  });
});
