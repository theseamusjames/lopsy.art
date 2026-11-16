import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

/**
 * #1660 — in layer-mask edit mode the Pencil painted only while dragging:
 * a single click and a click then Shift+click line left the mask
 * untouched (each still adding a Mask Paint history row).
 */

/** Count mask texels below 16 (hidden) inside a document-space box. */
async function hiddenInBox(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  return page.evaluate(({ x0, y0, x1, y1 }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          activeLayerId: string | null;
          layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number } | null }>;
        };
      };
    };
    const state = store.getState();
    const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
    if (!layer?.mask) return -1;
    const { data, width } = layer.mask;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (data[y * width + x]! < 16) n++;
      }
    }
    return n;
  }, { x0, y0, x1, y1 });
}

async function clickDoc(page: Page, x: number, y: number, modifiers: ('Shift')[] = []): Promise<void> {
  const p = await docToScreen(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
  await page.waitForTimeout(200);
}

test.describe('Pencil click and Shift+click on a layer mask (#1660)', () => {
  test('a click paints a block and Shift+click paints a line into the mask', async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await page.locator('[aria-label="Add Mask"]').click();
    await page.waitForTimeout(200);
    const maskMode = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { maskMode: string } };
      return ui.getState().maskMode;
    });
    expect(maskMode).toBe('layerMask');

    await page.keyboard.press('n');
    const sizeInput = page.locator('[aria-label="Size value"]').first();
    await sizeInput.fill('20');
    await sizeInput.press('Enter');

    // A single click.
    await clickDoc(page, 150, 150);
    // A click, then Shift+click straight down.
    await clickDoc(page, 400, 100);
    await clickDoc(page, 400, 500, ['Shift']);

    // The JS copy of the mask refreshes lazily from the GPU.
    await expect.poll(() => hiddenInBox(page, 135, 135, 165, 165), { timeout: 30_000 }).toBeGreaterThanOrEqual(300);
    // The dot is a 20 px block, not a line to anywhere.
    expect(await hiddenInBox(page, 135, 135, 165, 165)).toBeLessThanOrEqual(30 * 30);
    // The line's middle, well away from both clicked ends.
    expect(await hiddenInBox(page, 385, 250, 415, 350)).toBeGreaterThanOrEqual(20 * 100 - 40);
  });
});
