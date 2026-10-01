import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, waitForStore } from './helpers';

// #1085: an arrow-key nudge with the Move tool, a marquee active and a live
// text layer active floated the text's pixels and reset the layer's x/y to
// (0, 0). The next Text click near the origin then edited that layer and the
// word jumped to the top-left corner.

interface TextInfo { id: string; type: string; x: number; y: number; text?: string }

async function textLayers(page: Page): Promise<TextInfo[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: TextInfo[] } };
    };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ id: l.id, type: l.type, x: l.x, y: l.y, text: l.text }));
  });
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function clickAtDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}

async function marquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function nudgeRight(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await page.locator('body').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(300);
}

test.describe('Move-tool nudge on a text layer with a marquee (#1085)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'arrow-key nudge needs a desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1200, 900, false);
    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 120);
    await clickAtDoc(page, 300, 400);
    await page.keyboard.type('HELLO');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
  });

  test('a marquee over part of the word refuses the nudge and keeps the position', async ({ page }) => {
    const [before] = await textLayers(page);
    expect(before!.x).toBeGreaterThan(100);
    const labels = await historyLabels(page);

    await marquee(page, 280, 380, 480, 600);
    const withMarquee = await historyLabels(page);
    await nudgeRight(page);

    await expect(page.getByText('Rasterize the text layer to move or transform part of it.')).toBeVisible();
    expect(await historyLabels(page)).toEqual(withMarquee);
    expect(withMarquee.slice(0, labels.length)).toEqual(labels);
    const [after] = await textLayers(page);
    expect(after).toEqual(before);

    // The issue's follow-on: a Text click near the origin makes a new layer
    // instead of editing HELLO and dragging it to the top-left corner.
    await page.keyboard.press('Control+d');
    await page.keyboard.press('t');
    await clickAtDoc(page, 60, 60);
    await page.keyboard.type('X');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const layers = await textLayers(page);
    expect(layers.map((l) => l.text).sort()).toEqual(['HELLO', 'X']);
    expect(layers.find((l) => l.text === 'HELLO')).toMatchObject({ x: before!.x, y: before!.y });
  });

  test('a marquee over the whole word moves the live text layer', async ({ page }) => {
    const [before] = await textLayers(page);

    await marquee(page, 200, 250, 1100, 650);
    await nudgeRight(page);

    const [after] = await textLayers(page);
    expect(after).toEqual({ ...before!, x: before!.x + 10 });
    expect((await historyLabels(page)).at(-1)).toBe('Nudge');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect((await textLayers(page))[0]).toEqual(before);
  });
});
