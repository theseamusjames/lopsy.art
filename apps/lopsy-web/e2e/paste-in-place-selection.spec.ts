import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setForegroundColor,
  selectTool,
  addLayer,
} from './helpers';

// A paste of content copied inside Lopsy (⌘C / ⌘X, then ⌘V) used to leave no
// selection of its own — at best the copy's marquee carried over — so the
// transform handles did not sit on the paste and a corner drag moved it
// instead of scaling it. Every paste now selects its pixels and switches to
// Move, like an external paste does.

const RED = { x: 100, y: 100, w: 100, h: 80 };

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function marqueeFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await drag(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
}

interface Box { x0: number; y0: number; x1: number; y1: number; count: number }

/** Document-space bounds of a layer's opaque (alpha > 128) pixels. */
async function opaqueBox(page: Page, layerId: string): Promise<Box> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const r = await w.__readLayerPixels(lid);
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, count: 0 };
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if (r.pixels[(y * r.width + x) * 4 + 3]! <= 128) continue;
        box.count++;
        box.x0 = Math.min(box.x0, x + layer.x);
        box.y0 = Math.min(box.y0, y + layer.y);
        box.x1 = Math.max(box.x1, x + layer.x + 1);
        box.y1 = Math.max(box.y1, y + layer.y + 1);
      }
    }
    return box;
  }, layerId);
}

interface PasteState {
  activeLayerId: string;
  activeName: string;
  layerCount: number;
  tool: string;
  selection: { x: number; y: number; width: number; height: number } | null;
  hasTransform: boolean;
}

async function pasteState(page: Page): Promise<PasteState> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __editorStore: { getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; name: string }> };
        selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
      } };
      __uiStore: { getState: () => { activeTool: string; transform: unknown } };
    };
    const s = w.__editorStore.getState();
    const ui = w.__uiStore.getState();
    return {
      activeLayerId: s.document.activeLayerId,
      activeName: s.document.layers.find((l) => l.id === s.document.activeLayerId)?.name ?? '',
      layerCount: s.document.layers.length,
      tool: ui.activeTool,
      selection: s.selection.active ? s.selection.bounds : null,
      hasTransform: ui.transform !== null,
    };
  });
}

/** A transparent doc with a red block on its own layer and nothing selected. */
async function setUp(page: Page): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
  const sourceId = await addLayer(page);
  await setForegroundColor(page, 255, 0, 0);
  await marqueeFill(page, RED.x, RED.y, RED.x + RED.w, RED.y + RED.h);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
  return sourceId;
}

async function pasteAndWait(page: Page, sourceId: string): Promise<PasteState> {
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await pasteState(page)).activeLayerId, { timeout: 15000 }).not.toBe(sourceId);
  // The paste lands on a later frame under a loaded software GPU; poll.
  await expect.poll(async () => (await pasteState(page)).selection, { timeout: 15000 }).not.toBeNull();
  return pasteState(page);
}

test.describe('paste in place selects the pasted pixels', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'menu bar and keyboard shortcuts are desktop-only');
  });

  test('copy a marquee region, paste, drag a corner handle: the paste scales', async ({ page }) => {
    const sourceId = await setUp(page);

    // Copy a marquee with a transparent margin around the block.
    await selectTool(page, 'marquee-rect');
    await drag(page, 60, 60, 260, 230);
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(150);

    const pasted = await pasteAndWait(page, sourceId);
    expect(pasted.activeName).toMatch(/Paste/i);
    // The selection is the pasted pixels, not the copy's marquee.
    expect(pasted.selection).toEqual({ x: RED.x, y: RED.y, width: RED.w, height: RED.h });
    expect(pasted.hasTransform).toBe(true);
    expect(pasted.tool).toBe('move');

    // Straight away, pull the bottom-right handle 60 px right and 40 px down.
    await drag(page, RED.x + RED.w, RED.y + RED.h, RED.x + RED.w + 60, RED.y + RED.h + 40);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/paste-in-place-selection-scaled.png' });

    // The paste grew from its top-left corner: 100×80 → 160×120.
    const scaled = await opaqueBox(page, pasted.activeLayerId);
    expect(scaled.x0).toBeGreaterThanOrEqual(RED.x - 1);
    expect(scaled.x0).toBeLessThanOrEqual(RED.x + 1);
    expect(scaled.y0).toBeGreaterThanOrEqual(RED.y - 1);
    expect(scaled.y0).toBeLessThanOrEqual(RED.y + 1);
    expect(scaled.x1 - scaled.x0).toBeGreaterThan(150);
    expect(scaled.y1 - scaled.y0).toBeGreaterThan(110);
    expect(scaled.count).toBeGreaterThan(RED.w * RED.h * 1.8);

    // The layer it was copied from is untouched.
    const source = await opaqueBox(page, sourceId);
    expect(source).toEqual({ x0: RED.x, y0: RED.y, x1: RED.x + RED.w, y1: RED.y + RED.h, count: RED.w * RED.h });
  });

  test('copy a whole layer with nothing selected, paste: the paste is selected and scales', async ({ page }) => {
    const sourceId = await setUp(page);

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(150);

    const pasted = await pasteAndWait(page, sourceId);
    expect(pasted.selection).toEqual({ x: RED.x, y: RED.y, width: RED.w, height: RED.h });
    expect(pasted.tool).toBe('move');

    // Pull the top-left handle 50 px up and left; the bottom-right corner stays.
    await drag(page, RED.x, RED.y, RED.x - 50, RED.y - 50);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    const scaled = await opaqueBox(page, pasted.activeLayerId);
    expect(scaled.x0).toBeLessThanOrEqual(RED.x - 45);
    expect(scaled.y0).toBeLessThanOrEqual(RED.y - 45);
    expect(scaled.x1).toBeGreaterThanOrEqual(RED.x + RED.w - 1);
    expect(scaled.x1).toBeLessThanOrEqual(RED.x + RED.w + 1);
    expect(scaled.y1).toBeGreaterThanOrEqual(RED.y + RED.h - 1);
    expect(scaled.y1).toBeLessThanOrEqual(RED.y + RED.h + 1);
  });

  test('a fresh paste, then Delete, removes just the paste', async ({ page }) => {
    const sourceId = await setUp(page);

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(150);
    const pasted = await pasteAndWait(page, sourceId);
    expect(pasted.layerCount).toBeGreaterThan(0);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // Delete cleared the selected pixels; it did not delete the layer.
    const after = await pasteState(page);
    expect(after.layerCount).toBe(pasted.layerCount);
    expect(after.activeLayerId).toBe(pasted.activeLayerId);
    expect((await opaqueBox(page, pasted.activeLayerId)).count).toBe(0);
    const source = await opaqueBox(page, sourceId);
    expect(source.count).toBe(RED.w * RED.h);
  });

  test('Edit > Paste selects the pasted pixels too', async ({ page }) => {
    const sourceId = await setUp(page);

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /^Edit$/ }).click();
    await page.getByRole('menuitem', { name: /^Paste$/ }).click();
    await expect.poll(async () => (await pasteState(page)).selection, { timeout: 15000 }).not.toBeNull();

    const pasted = await pasteState(page);
    expect(pasted.activeLayerId).not.toBe(sourceId);
    expect(pasted.selection).toEqual({ x: RED.x, y: RED.y, width: RED.w, height: RED.h });
    expect(pasted.tool).toBe('move');
  });
});
