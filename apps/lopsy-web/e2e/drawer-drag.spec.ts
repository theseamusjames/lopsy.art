import { test, expect } from './fixtures';
import { waitForStore, createDocument, openEffectsPanel } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Regression coverage for the effects/reference drawer drag (PR #595
 * follow-up). The drawers publish --drag-x/--drag-y custom properties from
 * useDraggablePanel; App.module.css must consume them with a transform or
 * dragging silently does nothing — exactly the regression that shipped when
 * the inline transform was migrated to custom properties without a matching
 * CSS rule.
 */

const DRAG_DX = 120;
const DRAG_DY = 60;

async function dragFrom(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + DRAG_DX, y + DRAG_DY, { steps: 8 });
  await page.mouse.up();
}

test.describe('Drawer dragging', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'drawers require the sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('effects drawer moves when dragged by its header', async ({ page }) => {
    await openEffectsPanel(page);
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();

    const before = await drawer.boundingBox();
    expect(before).not.toBeNull();

    // Drag from the header title — a non-interactive area, so the
    // useDraggablePanel pointer handler accepts the gesture.
    const title = drawer.locator('text=Layer Effects');
    const titleBox = await title.boundingBox();
    expect(titleBox).not.toBeNull();
    await dragFrom(page, titleBox!.x + 5, titleBox!.y + titleBox!.height / 2);

    await page.screenshot({ path: 'e2e/screenshots/effects-drawer-dragged.png' });

    const after = await drawer.boundingBox();
    expect(after).not.toBeNull();
    // The drawer must follow the pointer. Exact-pixel equality is expected
    // (the transform is translate(dx, dy)), but allow 1px for rounding.
    expect(Math.abs(after!.x - before!.x - DRAG_DX)).toBeLessThanOrEqual(1);
    expect(Math.abs(after!.y - before!.y - DRAG_DY)).toBeLessThanOrEqual(1);
  });

  test('reference drawer moves when dragged by its header', async ({ page }) => {
    await page.locator('button[title="Reference"]').click();
    const drawer = page.getByTestId('reference-drawer');
    await expect(drawer).toBeVisible();

    const before = await drawer.boundingBox();
    expect(before).not.toBeNull();

    const title = drawer.locator('text=Reference');
    const titleBox = await title.boundingBox();
    expect(titleBox).not.toBeNull();
    await dragFrom(page, titleBox!.x + 5, titleBox!.y + titleBox!.height / 2);

    await page.screenshot({ path: 'e2e/screenshots/reference-drawer-dragged.png' });

    const after = await drawer.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x - DRAG_DX)).toBeLessThanOrEqual(1);
    expect(Math.abs(after!.y - before!.y - DRAG_DY)).toBeLessThanOrEqual(1);
  });

  test('effects drawer drag offset resets when the drawer is reopened', async ({ page }) => {
    await openEffectsPanel(page);
    const drawer = page.getByTestId('effects-drawer');
    const before = await drawer.boundingBox();
    expect(before).not.toBeNull();

    const title = drawer.locator('text=Layer Effects');
    const titleBox = await title.boundingBox();
    await dragFrom(page, titleBox!.x + 5, titleBox!.y + titleBox!.height / 2);

    await page.locator('[aria-label="Close effects"]').click();
    await expect(drawer).not.toBeVisible();

    await openEffectsPanel(page);
    await expect(drawer).toBeVisible();
    const reopened = await drawer.boundingBox();
    expect(reopened).not.toBeNull();
    expect(Math.abs(reopened!.x - before!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(reopened!.y - before!.y)).toBeLessThanOrEqual(1);
  });
});
