import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setActiveLayer,
  setToolOption,
  getEditorState,
} from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

/**
 * Regression test for #943: the Text panel showed the Text TOOL's current
 * settings instead of the selected text layer's. Selecting a 40px layer
 * after making an 80px one left "80" in the panel, and typing 80 was a
 * no-op because the control saw no change.
 */

interface TextLayerLite { id: string; type: string; text: string; fontSize: number }

async function textLayers(page: Page): Promise<TextLayerLite[]> {
  const layers = (await getEditorState(page)).document.layers as unknown as TextLayerLite[];
  return layers.filter((l) => l.type === 'text');
}

/** Height in px of the opaque rows of a layer's GPU texture. */
async function opaqueHeight(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    let minRow = height;
    let maxRow = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 20) {
          if (y < minRow) minRow = y;
          if (y > maxRow) maxRow = y;
          break;
        }
      }
    }
    return maxRow < 0 ? 0 : maxRow - minRow + 1;
  }, layerId);
}

async function typeTextAt(page: Page, x: number, y: number, text: string): Promise<void> {
  await clickAtDoc(page, x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab'); // commit
  await page.waitForTimeout(250);
}

test.describe('#943 Text panel reflects the selected text layer', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'Text panel is desktop-only');
  });

  test('selecting a layer shows its size, and editing it resizes that layer', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);

    await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
    const panelSize = page.locator('[data-panel="text"] [aria-label="Size value"]');
    await expect(panelSize).toBeVisible();

    await selectTextTool(page);
    await setToolOption(page, 'Size', 40);
    await typeTextAt(page, 50, 50, 'AAA');

    await addLayer(page);
    await selectTextTool(page);
    await setToolOption(page, 'Size', 80);
    await typeTextAt(page, 50, 300, 'BBB');

    const layers = await textLayers(page);
    const aaa = layers.find((l) => l.text === 'AAA');
    const bbb = layers.find((l) => l.text === 'BBB');
    expect(aaa?.fontSize).toBe(40);
    expect(bbb?.fontSize).toBe(80);
    const aaaHeightBefore = await opaqueHeight(page, aaa!.id);
    expect(aaaHeightBefore).toBeGreaterThan(15);

    await page.keyboard.press('v');
    await setActiveLayer(page, aaa!.id);
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/text-panel-selected-layer-40.png' });

    // Old bug: the panel still showed the tool's 80.
    await expect(panelSize).toHaveValue('40');

    await panelSize.fill('80');
    await panelSize.press('Tab');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/text-panel-selected-layer-80.png' });

    const after = (await textLayers(page)).find((l) => l.id === aaa!.id);
    expect(after?.fontSize).toBe(80);
    // BBB is untouched.
    expect((await textLayers(page)).find((l) => l.id === bbb!.id)?.fontSize).toBe(80);

    // The re-rendered glyphs are roughly twice as tall.
    const aaaHeightAfter = await opaqueHeight(page, aaa!.id);
    expect(aaaHeightAfter).toBeGreaterThan(aaaHeightBefore * 1.6);
  });
});
