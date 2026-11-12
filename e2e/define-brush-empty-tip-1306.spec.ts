/**
 * #1306 — Edit → Define Brush… on a selection holding only white pixels
 * silently added a preset whose tip was a 1×1 opaque pixel, so the "brush"
 * painted solid squares. White doesn't paint in the grayscale convention, so
 * the capture is empty: Define Brush now refuses it with a toast and adds no
 * preset. A dark capture still defines a brush.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, setForegroundColor } from './helpers';

async function marquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function editMenu(page: Page, item: string): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(200);
}

/** Fill a rectangle on the active (transparent) layer with the given colour, leaving it selected. */
async function fillRect(page: Page, rgb: [number, number, number]): Promise<void> {
  await marquee(page, 150, 120, 250, 180);
  await setForegroundColor(page, ...rgb);
  await editMenu(page, 'Fill');
}

async function presetNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __toolSettingsStore: { getState: () => { presets: Array<{ name: string }> } };
    }).__toolSettingsStore.getState();
    return store.presets.map((p) => p.name);
  });
}

test.describe('Define Brush with nothing to paint (#1306)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
    await page.locator('[aria-label="Add Layer"]').click();
  });

  test('a white-only selection is refused with a toast and adds no preset', async ({ page }) => {
    await fillRect(page, [255, 255, 255]);
    const before = await presetNames(page);

    const prompts: string[] = [];
    page.on('dialog', (dialog) => {
      prompts.push(dialog.message());
      void dialog.accept('Fleck');
    });
    await editMenu(page, 'Define Brush...');
    await page.screenshot({ path: 'e2e/screenshots/define-brush-empty-tip.png' });

    await expect(page.getByRole('status').filter({ hasText: 'the brush would be empty' })).toBeVisible();
    expect(prompts).toEqual([]);
    expect(await presetNames(page)).toEqual(before);
  });

  test('a dark selection still defines a brush', async ({ page }) => {
    await fillRect(page, [0, 0, 0]);
    const before = await presetNames(page);

    page.on('dialog', (dialog) => void dialog.accept('Block'));
    await editMenu(page, 'Define Brush...');

    expect(await presetNames(page)).toEqual([...before, 'Block']);
  });
});
