// #1154 — Text colour control in the Text options bar.
//
// A committed text layer is recoloured as a whole from the "Text color"
// swatch (one undo step); while editing, a selected range is recoloured on
// its own, and a selection spanning two colours shows the mixed "–" state.
//
// Pixels are read from the text layer's own GPU texture, which during an edit
// holds the live preview. Each opaque pixel is classified by colour and its
// x position in the texture, so "only those glyphs changed" is checked as
// "every black pixel sits left of every recoloured pixel".

import { test, expect, type Page } from '@playwright/test';
import {
  createDocument,
  docToScreen,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';

type Hue = 'black' | 'red' | 'blue' | 'green';

interface ColorColumns {
  counts: Record<Hue, number>;
  minX: Record<Hue, number>;
  maxX: Record<Hue, number>;
}

/** Classify the layer's opaque pixels as black / red / blue / green and record their x extents. */
async function readColorColumns(page: Page, layerId: string): Promise<ColorColumns> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as {
      __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    }).__readLayerPixels;
    const { width, pixels } = await read(id);
    const hues = ['black', 'red', 'blue', 'green'] as const;
    const counts = { black: 0, red: 0, blue: 0, green: 0 };
    const minX = { black: Infinity, red: Infinity, blue: Infinity, green: Infinity };
    const maxX = { black: -Infinity, red: -Infinity, blue: -Infinity, green: -Infinity };
    for (let i = 0; i < pixels.length; i += 4) {
      // Fully covered glyph interiors only — anti-aliased edges blend colours.
      if ((pixels[i + 3] ?? 0) < 250) continue;
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      let hue: (typeof hues)[number] | null = null;
      if (r < 40 && g < 40 && b < 40) hue = 'black';
      else if (r > 200 && g < 60 && b < 60) hue = 'red';
      else if (b > 200 && r < 60 && g < 60) hue = 'blue';
      else if (g > 200 && r < 60 && b < 60) hue = 'green';
      if (!hue) continue;
      const x = (i / 4) % width;
      counts[hue]++;
      minX[hue] = Math.min(minX[hue], x);
      maxX[hue] = Math.max(maxX[hue], x);
    }
    return { counts, minX, maxX };
  }, layerId);
}

function textOptions(page: Page) {
  return page.getByRole('toolbar', { name: 'Text options' });
}

function colorButton(page: Page) {
  return textOptions(page).locator('[aria-label="Text color"]');
}

/** Open the options-bar text colour picker, type a hex colour, and close it again. */
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

async function textLayerId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string }> } } };
    }).__editorStore.getState();
    return store.document.layers.filter((l) => l.type === 'text').at(-1)?.id ?? null;
  });
  expect(id).not.toBeNull();
  return id!;
}

async function undoStackLength(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as {
    __editorStore: { getState: () => { undoStack: unknown[] } };
  }).__editorStore.getState().undoStack.length);
}

/** Type black "HHHH" at 64 px and commit it with the Move tool. */
async function createBlackText(page: Page): Promise<string> {
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'text');
  await setToolOption(page, 'Size', 64);
  const at = await docToScreen(page, 40, 60);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(150);
  await page.keyboard.type('HHHH');
  await page.waitForTimeout(150);
  await page.locator('[data-tool-id="move"]').click();
  await page.waitForTimeout(300);
  return textLayerId(page);
}

test.describe('#1154 text colour control', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text editing needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('recolours a committed text layer in one undo step', async ({ page }) => {
    const layerId = await createBlackText(page);
    const before = await readColorColumns(page, layerId);
    expect(before.counts.black).toBeGreaterThan(500);
    expect(before.counts.red).toBe(0);

    // With the committed layer selected, the Text options bar edits it.
    await selectTool(page, 'text');
    await expect(colorButton(page)).not.toHaveAttribute('data-mixed', 'true');
    const undoBefore = await undoStackLength(page);
    await pickTextColor(page, 'ff0000');
    await page.screenshot({ path: 'e2e/screenshots/text-color-1154-whole-layer.png' });

    const after = await readColorColumns(page, layerId);
    // Every glyph turned red: as many solid pixels as before, none black.
    expect(after.counts.red).toBeGreaterThan(before.counts.black * 0.9);
    expect(after.counts.black).toBe(0);
    expect(await undoStackLength(page)).toBe(undoBefore + 1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await readColorColumns(page, layerId);
    expect(undone.counts.red).toBe(0);
    expect(undone.counts.black).toBeGreaterThan(before.counts.black * 0.9);
  });

  test('recolours a selected range, shows the mixed state, and undo restores', async ({ page }) => {
    const layerId = await createBlackText(page);
    const original = await readColorColumns(page, layerId);

    // Re-enter the text and select the last two glyphs with Shift+←.
    await selectTool(page, 'text');
    const inText = await docToScreen(page, 100, 100);
    await page.mouse.click(inText.x, inText.y);
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(colorButton(page)).not.toHaveAttribute('data-mixed', 'true');
    await pickTextColor(page, '0000ff');
    await page.screenshot({ path: 'e2e/screenshots/text-color-1154-range.png' });

    const ranged = await readColorColumns(page, layerId);
    // "HH" stays black on the left, "HH" is blue on the right.
    expect(ranged.counts.black).toBeGreaterThan(original.counts.black * 0.4);
    expect(ranged.counts.blue).toBeGreaterThan(original.counts.black * 0.4);
    expect(ranged.maxX.black).toBeLessThan(ranged.minX.blue);

    // Select the last three glyphs: one black + two blue → mixed "–".
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(colorButton(page)).toHaveAttribute('data-mixed', 'true');
    await expect(colorButton(page)).toHaveText('–');
    await page.screenshot({ path: 'e2e/screenshots/text-color-1154-mixed.png' });

    // One pick recolours the whole mixed selection.
    await pickTextColor(page, '00ff00');
    await expect(colorButton(page)).not.toHaveAttribute('data-mixed', 'true');
    const green = await readColorColumns(page, layerId);
    expect(green.counts.blue).toBe(0);
    expect(green.counts.green).toBeGreaterThan(original.counts.black * 0.6);
    expect(green.counts.black).toBeGreaterThan(original.counts.black * 0.15);
    expect(green.counts.black).toBeLessThan(original.counts.black * 0.4);
    expect(green.maxX.black).toBeLessThan(green.minX.green);

    // Commit keeps the per-range colours on the layer.
    await page.locator('[data-tool-id="move"]').click();
    await page.waitForTimeout(300);
    const committed = await readColorColumns(page, layerId);
    expect(committed.counts.green).toBe(green.counts.green);
    expect(committed.counts.black).toBe(green.counts.black);
    // The whole layer now holds two colours, so the control reads mixed.
    await selectTool(page, 'text');
    await expect(colorButton(page)).toHaveAttribute('data-mixed', 'true');
    await page.screenshot({ path: 'e2e/screenshots/text-color-1154-committed.png' });

    // Undoing the edit brings back the all-black text.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await readColorColumns(page, layerId);
    expect(undone.counts.green).toBe(0);
    expect(undone.counts.blue).toBe(0);
    expect(undone.counts.black).toBeGreaterThan(original.counts.black * 0.9);
    await expect(colorButton(page)).not.toHaveAttribute('data-mixed', 'true');
  });
});
