// #1235 — The click that enters editing on a committed text layer put the
// caret at the end of the text; only a second click placed it. That click
// now places the caret where it lands, as clicks made while editing do.

import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { clickAtDoc, getTextEditing, selectTextTool, typeTextAt } from './text-edit-helpers';

async function layerRect(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(async (layerId) => {
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number }>;
    const layer = ed.getState().document.layers.find((l) => l.id === layerId)!;
    const { width, height } = await read(layerId);
    return { x: layer.x, y: layer.y, width, height };
  }, id);
}

async function layerText(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate((layerId) => {
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; text?: string }> } };
    };
    return ed.getState().document.layers.find((l) => l.id === layerId)?.text;
  }, id);
}

/** Type `text` at (x, y), commit it with Tab and return the layer id. */
async function commitText(page: Page, x: number, y: number, text: string): Promise<string> {
  await typeTextAt(page, x, y, text);
  const id = (await getTextEditing(page))!.layerId;
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  expect(await getTextEditing(page)).toBeNull();
  return id;
}

test.describe('#1235 caret placement on the click that enters editing', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text editing needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await selectTextTool(page);
  });

  test('a single click near the start of a committed layer puts the caret there', async ({ page }) => {
    const id = await commitText(page, 150, 220, 'Hello world');
    const rect = await layerRect(page, id);

    await clickAtDoc(page, rect.x + 4, rect.y + rect.height / 2);
    const editing = await getTextEditing(page);
    expect(editing?.layerId).toBe(id);
    expect(editing!.cursorPos).toBeLessThanOrEqual(1);
    expect(editing!.selectionAnchor).toBeNull();

    await page.keyboard.type('X');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const text = await layerText(page, id);
    expect(text).not.toBe('Hello worldX');
    expect(text!.indexOf('X')).toBeLessThanOrEqual(1);
  });

  test('the entry click picks the clicked line of multi-line text', async ({ page }) => {
    await typeTextAt(page, 150, 200, 'second');
    await page.keyboard.press('Enter');
    await page.keyboard.type('third line');
    const id = (await getTextEditing(page))!.layerId;
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const rect = await layerRect(page, id);
    // A quarter of the way down sits on the first of the two lines.
    await clickAtDoc(page, rect.x + rect.width / 2, rect.y + rect.height / 4);
    const editing = (await getTextEditing(page))!;
    expect(editing.layerId).toBe(id);
    expect(editing.cursorPos).toBeLessThanOrEqual('second'.length);
  });
});
