/**
 * #1754 — picking a font from the options-bar font menu mid-edit left focus
 *         on <body>, so input-event text (IME commits, dead keys, the emoji
 *         picker; `insertText` here) was dropped until the canvas was clicked.
 * #1756 — changing Align mid-edit moved the anchor by a fraction of the
 *         block's width, leaving the committed layer at a fractional x.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';
import { clickAtDoc, getTextEditing } from './text-edit-helpers';

async function textLayers(page: Page): Promise<Array<{ text: string; x: number; y: number }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ type: string; text?: string; x: number; y: number }> } };
    };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ text: l.text ?? '', x: l.x, y: l.y }));
  });
}

async function commit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Commit text' }).click();
  await expect.poll(() => getTextEditing(page)).toBeNull();
}

async function pickAlign(page: Page, align: 'left' | 'center' | 'right'): Promise<void> {
  await page.locator('select[aria-labelledby="text-align-label"]').selectOption(align);
  await page.waitForTimeout(150);
}

test.describe('Text options mid-edit (#1754, #1756)', () => {
  // The chosen font's binary may be unreachable offline; focus is what is under test.
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the text options bar is a desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1000, 800, false);
    await page.waitForTimeout(200);
    await page.keyboard.press('t');
  });

  test('input-event text still arrives after picking a font from the menu (#1754)', async ({ page }) => {
    await clickAtDoc(page, 100, 150);
    await page.keyboard.type('ab');

    await page.locator('button[aria-haspopup="listbox"]').click();
    await page.locator('input[aria-label="Search fonts"]').fill('Inter Tight');
    const item = page.locator('[role="option"]').filter({ hasText: /^Inter Tight$/ }).first();
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
    await page.waitForTimeout(200);

    const active = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    expect(active).toBe('Text input');

    await page.keyboard.insertText('é°');
    await page.keyboard.type('c');
    expect((await getTextEditing(page))?.text).toBe('abé°c');
    await page.keyboard.press('Tab');
    await expect.poll(async () => (await textLayers(page))[0]?.text).toBe('abé°c');
  });

  test('changing Align while editing keeps the layer on whole pixels (#1756)', async ({ page }) => {
    await clickAtDoc(page, 500, 300);
    await page.keyboard.type('Plain left text');
    await commit(page);

    await clickAtDoc(page, 500, 420);
    await page.keyboard.type('Switched to centre');
    await pickAlign(page, 'center');
    await commit(page);

    await clickAtDoc(page, 500, 540);
    await page.keyboard.type('Switched to right');
    await pickAlign(page, 'right');
    await commit(page);

    const layers = await textLayers(page);
    console.log('text layer positions:', layers);
    expect(layers.map((l) => l.text).sort()).toEqual(['Plain left text', 'Switched to centre', 'Switched to right']);
    for (const l of layers) {
      expect(Number.isInteger(l.x), `${l.text} x = ${l.x}`).toBe(true);
      expect(Number.isInteger(l.y), `${l.text} y = ${l.y}`).toBe(true);
    }
  });
});
