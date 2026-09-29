// Regression test for #1001 — re-editing a text layer (recolor, retype) threw
// away a name the user gave it in the Layers panel, reverting to the first 16
// characters of the text. Auto-named layers should still follow their text.
import { test, expect, type Page } from './fixtures';
import { createDocument, setForegroundColor, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

interface LayerInfo {
  id: string;
  name: string;
  text: string;
  color: { r: number; g: number; b: number };
}

async function getTextLayers(page: Page): Promise<LayerInfo[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string; type: string; text?: string; color?: { r: number; g: number; b: number } }> } };
    };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ id: l.id, name: l.name, text: l.text ?? '', color: l.color ?? { r: 0, g: 0, b: 0 } }));
  });
}

async function renameLayer(page: Page, layer: LayerInfo, name: string): Promise<void> {
  await page.locator(`[data-layer-id="${layer.id}"]`).getByText(layer.name, { exact: true }).dblclick();
  const input = page.locator('input[aria-label="Layer name"]');
  await input.fill(name);
  await input.press('Enter');
}

async function createHelloWorld(page: Page): Promise<LayerInfo> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, true);
  await setForegroundColor(page, 0, 0, 0);

  await selectTextTool(page);
  await setToolOption(page, 'Size', 60);
  await clickAtDoc(page, 100, 200);
  await page.keyboard.type('Hello world');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);

  const layers = await getTextLayers(page);
  expect(layers).toHaveLength(1);
  expect(layers[0]!.name).toBe('Hello world');
  return layers[0]!;
}

async function recolorText(page: Page, hex: { r: number; g: number; b: number }): Promise<void> {
  await selectTextTool(page);
  await clickAtDoc(page, 160, 225);
  await page.keyboard.press('ControlOrMeta+a');
  await setForegroundColor(page, hex.r, hex.g, hex.b);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
}

test.describe('#1001 text layer names survive re-editing', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'text tool requires a keyboard');
  });

  test('recoloring keeps a custom layer name', async ({ page }) => {
    const layer = await createHelloWorld(page);

    await renameLayer(page, layer, 'Headline');
    expect((await getTextLayers(page))[0]!.name).toBe('Headline');

    await recolorText(page, { r: 0xcc, g: 0x22, b: 0x22 });

    const after = await getTextLayers(page);
    expect(after).toHaveLength(1);
    // The re-edit really committed: the new color is on the layer.
    expect(after[0]!.color).toMatchObject({ r: 0xcc, g: 0x22, b: 0x22 });
    expect(after[0]!.text).toBe('Hello world');
    expect(after[0]!.name).toBe('Headline');
  });

  test('an auto-named layer still follows retyped text', async ({ page }) => {
    await createHelloWorld(page);

    await selectTextTool(page);
    await clickAtDoc(page, 160, 225);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Goodbye');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);

    const after = await getTextLayers(page);
    expect(after).toHaveLength(1);
    expect(after[0]!.text).toBe('Goodbye');
    expect(after[0]!.name).toBe('Goodbye');
  });
});
