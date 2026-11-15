// Regression test for #989 — the Text tool hit-tested committed point text
// against an estimated line box (fontSize × lineHeight per line) that reaches
// ~0.7em below capital glyphs, so clicking empty canvas just below large text
// re-opened that layer instead of starting a new one.
import { test, expect, type Page } from './fixtures';
import { createDocument, setForegroundColor, setToolOption, waitForStore } from './helpers';
import { clickAtDoc, getTextEditing, selectTextTool } from './text-edit-helpers';

interface TextLayerInfo {
  id: string;
  text: string;
  y: number;
}

async function getTextLayers(page: Page): Promise<TextLayerInfo[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; text?: string; y: number }> } };
    };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ id: l.id, text: l.text ?? '', y: l.y }));
  });
}

/** Opaque rows of the layer texture, in document space. */
async function inkRows(page: Page, layer: TextLayerInfo): Promise<{ top: number; bottom: number }> {
  return page.evaluate(async ({ id, y }) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    let top = -1;
    let bottom = -1;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (pixels[(row * width + col) * 4 + 3]! > 10) {
          if (top < 0) top = row;
          bottom = row;
          break;
        }
      }
    }
    return { top: y + top, bottom: y + bottom };
  }, { id: layer.id, y: layer.y });
}

async function commitHello(page: Page): Promise<TextLayerInfo> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 500, false);
  await setForegroundColor(page, 0, 0, 0);
  await selectTextTool(page);
  await setToolOption(page, 'Size', 120);
  await clickAtDoc(page, 40, 40);
  await page.keyboard.type('HELLO');
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(150);
  const layers = await getTextLayers(page);
  expect(layers).toHaveLength(1);
  return layers[0]!;
}

test.describe('#989 text hit-test uses rendered glyph bounds', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'text tool requires a keyboard');
  });

  test('clicking empty canvas below large caps starts a new text layer', async ({ page }) => {
    const hello = await commitHello(page);
    const ink = await inkRows(page, hello);
    // The capitals' ink sits well above the click; the old line box did not.
    expect(ink.bottom).toBeLessThan(185);
    expect(hello.y + 120 * 1.4).toBeGreaterThan(207);

    await clickAtDoc(page, 60, 207);
    await page.keyboard.type('world');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/text-hit-test-below-glyphs.png' });

    const layers = await getTextLayers(page);
    expect(layers.map((l) => l.text).sort()).toEqual(['HELLO', 'world']);
  });

  test('clicking on the glyphs still edits the existing layer', async ({ page }) => {
    const hello = await commitHello(page);
    const ink = await inkRows(page, hello);

    await clickAtDoc(page, 60, Math.round((ink.top + ink.bottom) / 2));
    const editing = await getTextEditing(page);
    expect(editing?.layerId).toBe(hello.id);
    expect(editing?.text).toBe('HELLO');

    await page.keyboard.press('Escape');
    expect(await getTextLayers(page)).toHaveLength(1);
  });
});
