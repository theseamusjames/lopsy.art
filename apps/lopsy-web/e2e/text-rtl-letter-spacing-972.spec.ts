import { test, expect, type Page } from './fixtures';
import { createDocument, getEditorState, waitForStore } from './helpers';
import { clickAtDoc, selectTextTool } from './text-edit-helpers';

// #972: with letter spacing > 0, right-to-left text collapsed into a smear
// and the layer shifted right by letterSpacing × (glyphs − 1).

/** Doc-space x-extent of the opaque pixels of a layer. */
async function opaqueExtentX(page: Page, layerId: string): Promise<{ left: number; right: number }> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (layerId?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number }> } };
    };
    const layerX = store.getState().document.layers.find((l) => l.id === id)!.x;
    const { width, height, pixels } = await read(id);
    let minCol = width;
    let maxCol = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 20) {
          if (x < minCol) minCol = x;
          if (x > maxCol) maxCol = x;
        }
      }
    }
    return { left: layerX + minCol, right: layerX + maxCol };
  }, layerId);
}

async function setLetterSpacing(page: Page, value: number): Promise<void> {
  await page.locator('[aria-label="Panel visibility"] [aria-label="Text"]').click();
  const input = page.locator('[aria-label="Letter spacing value"]').first();
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(250);
}

test.describe('Letter spacing on right-to-left text (#972)', () => {
  test('Hebrew text keeps its left edge and spreads by the letter spacing', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 400);

    await selectTextTool(page);
    await clickAtDoc(page, 100, 200);
    // "שלום" — four RTL glyphs.
    await page.keyboard.insertText('שלום');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(250);

    const layerId = (await getEditorState(page)).document.layers.find((l) => l.type === 'text')!.id;
    const before = await opaqueExtentX(page, layerId);
    expect(before.right).toBeGreaterThan(before.left);

    await setLetterSpacing(page, 20);
    const after = await opaqueExtentX(page, layerId);
    await page.screenshot({ path: 'e2e/screenshots/text-rtl-letter-spacing-972.png' });

    // The line still starts where it did; before the fix it jumped right by
    // 20 × 3 = 60 px.
    expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(2);
    // Three 20 px gaps widen the line by ~60 px; overlapping glyphs made it
    // narrower instead.
    const growth = (after.right - after.left) - (before.right - before.left);
    expect(growth).toBeGreaterThan(50);
    expect(growth).toBeLessThan(70);
  });
});
