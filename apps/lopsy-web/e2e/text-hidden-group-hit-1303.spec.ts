/**
 * #1303 — a Text-tool click over a text layer whose parent group is hidden
 * opened that invisible layer for editing, so the typing went into it.
 * hitTestTextLayer now skips layers hidden (or locked) by any ancestor group,
 * so the click starts a new, visible text layer and the hidden one is left
 * alone.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, selectTool, setToolOption } from './helpers';

interface TextSummary {
  id: string;
  text: string;
}

async function textLayers(page: Page): Promise<TextSummary[]> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string; text?: string }> } } };
    }).__editorStore.getState();
    return store.document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ id: l.id, text: l.text ?? '' }));
  });
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as {
    __editorStore: { getState: () => { document: { activeLayerId: string } } };
  }).__editorStore.getState().document.activeLayerId);
}

async function typeAt(page: Page, x: number, y: number, text: string): Promise<void> {
  const at = await docToScreen(page, x, y);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(150);
  await page.keyboard.type(text);
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

test.describe('Text click over a layer in a hidden group (#1303)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text editing needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);
  });

  test('starts new text instead of editing the hidden layer', async ({ page }) => {
    const backgroundId = await activeLayerId(page);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 72);
    await typeAt(page, 100, 100, 'HELLO');
    const [hello] = await textLayers(page);
    expect(hello?.text).toBe('HELLO');

    await page.click('button:has-text("Layer")');
    await page.getByRole('menuitem', { name: 'Group Layers', exact: true }).click();
    await page.waitForTimeout(200);
    const groupId = await activeLayerId(page);
    expect(groupId).not.toBe(hello!.id);
    await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label="Hide layer"]').click();
    await page.locator(`[data-layer-id="${backgroundId}"]`).click();
    await page.waitForTimeout(200);

    // Over the hidden HELLO glyphs, 30 px in from its top-left.
    await selectTool(page, 'text');
    await typeAt(page, 130, 130, 'WORLD');
    await page.screenshot({ path: 'e2e/screenshots/text-hidden-group-hit.png' });

    const layers = await textLayers(page);
    expect(layers.find((l) => l.id === hello!.id)?.text).toBe('HELLO');
    expect(layers.filter((l) => l.text === 'WORLD')).toHaveLength(1);
  });
});
