// #1295 — Redo of a committed text layer's colour change left the old glyphs
// on the canvas. The colour change re-renders the texture in place (same
// x/y, same type), and the layer was never marked dirty, so the snapshot
// undo pushes for redo reused the pre-change (black) texture handle. Redo
// then restored black glyphs while the model said green.
//
// Size and Align changes move the texture's top-left, which forced a fresh
// snapshot, so only colour was affected.

import { test, expect, type Page } from '@playwright/test';
import {
  createDocument,
  docToScreen,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';

interface GlyphCounts {
  black: number;
  green: number;
}

/** Count fully covered glyph pixels in the text layer's texture by colour. */
async function countGlyphColors(page: Page, layerId: string): Promise<GlyphCounts> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as {
      __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    }).__readLayerPixels;
    const { pixels } = await read(id);
    let black = 0;
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if ((pixels[i + 3] ?? 0) < 250) continue;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (r < 40 && g < 40 && b < 40) black++;
      else if (g > 160 && r < 60 && b < 60) green++;
    }
    return { black, green };
  }, layerId);
}

function colorButton(page: Page) {
  return page.getByRole('toolbar', { name: 'Text options' }).locator('[aria-label="Text color"]');
}

async function pickTextColor(page: Page, hex: string): Promise<void> {
  await colorButton(page).click();
  const picker = page.getByRole('dialog', { name: 'Text color picker' });
  await expect(picker).toBeVisible();
  const hexInput = picker.locator('[aria-label="Hex color"]');
  await hexInput.fill(hex);
  await hexInput.press('Enter');
  await colorButton(page).click();
  await expect(picker).toBeHidden();
  await page.waitForTimeout(150);
}

async function layerColor(page: Page, layerId: string): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate((id) => {
    const store = (window as unknown as {
      __editorStore: {
        getState: () => { document: { layers: Array<{ id: string; color?: { r: number; g: number; b: number } }> } };
      };
    }).__editorStore.getState();
    const c = store.document.layers.find((l) => l.id === id)!.color!;
    return { r: c.r, g: c.g, b: c.b };
  }, layerId);
}

test.describe('#1295 redo of a text colour change', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text editing needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('redo re-applies the new colour to the glyphs', async ({ page }) => {
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 64);
    const at = await docToScreen(page, 40, 60);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('HELLO');
    await page.waitForTimeout(150);
    await page.locator('[data-tool-id="move"]').click();
    await page.waitForTimeout(300);

    const layerId = await page.evaluate(() => {
      const store = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string }> } } };
      }).__editorStore.getState();
      return store.document.layers.filter((l) => l.type === 'text').at(-1)!.id;
    });
    const black = await countGlyphColors(page, layerId);
    expect(black.black).toBeGreaterThan(500);

    await selectTool(page, 'text');
    await pickTextColor(page, '00c000');
    const green = await countGlyphColors(page, layerId);
    expect(green.black).toBe(0);
    expect(green.green).toBeGreaterThan(black.black * 0.9);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await countGlyphColors(page, layerId);
    expect(undone.green).toBe(0);
    expect(undone.black).toBeGreaterThan(black.black * 0.9);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/text-color-redo-1295.png' });

    expect(await layerColor(page, layerId)).toEqual({ r: 0, g: 192, b: 0 });
    // Before the fix the texture still held the black glyphs here.
    const redone = await countGlyphColors(page, layerId);
    expect(redone.black).toBe(0);
    expect(redone.green).toBeGreaterThan(black.black * 0.9);
  });
});
