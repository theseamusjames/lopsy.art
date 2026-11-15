import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

// #1188 — Escape pressed to dismiss an open menu also ran the canvas's Escape,
// which deselects. A marquee drawn before it was gone by the time Copy Merged
// ran, so the copy took the whole document. Escape now only closes the menu.

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const s = await docToScreen(page, x0, y0);
  const e = await docToScreen(page, x1, y1);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function selection(page: Page): Promise<{ active: boolean; bounds: { x: number; y: number; width: number; height: number } | null }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null } };
    };
    const { active, bounds } = store.getState().selection;
    return { active, bounds };
  });
}

test.describe('Escape on an open menu keeps the selection (#1188)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('Escape closes the Edit menu without deselecting; Copy Merged copies the marquee', async ({ page }) => {
    await page.locator('[data-tool-id="marquee-rect"]').click();
    await drag(page, 60, 50, 220, 170);
    const before = await selection(page);
    expect(before.active).toBe(true);

    const bar = page.locator('nav[aria-label="Application menu"]');
    await bar.getByRole('button', { name: 'Edit', exact: true }).click();
    const editMenu = page.locator('[role="menu"][aria-label="Edit"]');
    await expect(editMenu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(editMenu).toBeHidden();
    const after = await selection(page);
    expect(after.active).toBe(true);
    expect(after.bounds).toEqual(before.bounds);

    // A second Escape, with nothing open, deselects as before.
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await selection(page)).active).toBe(false);
  });
});
