import { test, expect } from './fixtures';
import { waitForStore, createDocument, expectPointerReachable } from './helpers';

// #1470: with the guide-color picker open, File-menu items were drawn under
// the picker and clicks hit the picker instead of the menu.
test.describe('Guide color picker vs menu bar (#1470)', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'menu bar / rulers flow is desktop-only');
  });

  test('opening the File menu dismisses the picker and every item is clickable', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);

    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    if (!box) throw new Error('canvas container not laid out');

    await page.mouse.click(box.x + 10, box.y + 10);
    const picker = page.locator('[class*="guideColorPicker"]');
    await expect(picker).toBeVisible();
    const guideColorBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { guideColor: { r: number; g: number; b: number } };
      };
      return store.getState().guideColor;
    });

    await page.getByRole('navigation', { name: 'Application menu' }).getByText('File', { exact: true }).click();
    const fileMenu = page.getByRole('menu', { name: 'File' });
    await expect(fileMenu).toBeVisible();
    await expect(picker).toBeHidden();

    const items = fileMenu.locator(':scope > [role="menuitem"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
      await expectPointerReachable(items.nth(i));
    }

    const downloadPromise = page.waitForEvent('download');
    await fileMenu.getByRole('menuitem', { name: /Quick Export PNG/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);

    const guideColorAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { guideColor: { r: number; g: number; b: number } };
      };
      return store.getState().guideColor;
    });
    expect(guideColorAfter).toEqual(guideColorBefore);
  });

  test('the picker stacks below the menu-bar dropdowns', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
    if (!box) throw new Error('canvas container not laid out');
    await page.mouse.click(box.x + 10, box.y + 10);
    const picker = page.locator('[class*="guideColorPicker"]');
    await expect(picker).toBeVisible();

    const zIndexes = await page.evaluate(() => {
      const pickerEl = document.querySelector('[class*="guideColorPicker"]');
      const header = document.querySelector('nav[aria-label="Application menu"]')?.closest('header')
        ?? document.querySelector('nav[aria-label="Application menu"]')?.parentElement;
      if (!pickerEl || !header) return null;
      let headerZ = Number.NaN;
      for (let el: Element | null = header; el; el = el.parentElement) {
        const z = Number.parseInt(getComputedStyle(el).zIndex, 10);
        if (!Number.isNaN(z)) { headerZ = z; break; }
      }
      return { picker: Number.parseInt(getComputedStyle(pickerEl).zIndex, 10), header: headerZ };
    });
    expect(zIndexes).not.toBeNull();
    expect(zIndexes!.picker).toBeLessThan(zIndexes!.header);
  });
});
