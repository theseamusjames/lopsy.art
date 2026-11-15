/**
 * With the Magic Wand active, a click is always a wand click — even right
 * next to a corner of the current selection.
 *
 * A wand selection draws transform handles around its bounds, and the
 * selection tools used to grab a scale handle on pointer-down before the
 * wand ever saw the click. A Shift- or Alt-click on a neighbouring region
 * within the handle's 8-screen-px hit radius therefore did nothing (a
 * zero-length scale) instead of adding or subtracting that region.
 *
 * Layout on one transparent layer (doc px, zoom 1):
 *   red  x 100..199, y 100..199  — first wand click
 *   blue x 202..259, y  60..199  — starts 2 px right of red's top-right
 *                                  corner and reaches above it
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { waitForStore, createDocument, addLayer, drawRect, docToScreen } from './helpers';

interface SelectionInfo {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  zoom: number;
}

async function readSelection(page: Page): Promise<SelectionInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: { active: boolean; bounds: SelectionInfo['bounds'] };
        viewport: { zoom: number };
      };
    };
    const s = store.getState();
    return { active: s.selection.active, bounds: s.selection.bounds, zoom: s.viewport.zoom };
  });
}

async function maskAt(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(({ x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; mask: Uint8ClampedArray | null; maskWidth: number } };
    };
    const sel = store.getState().selection;
    if (!sel.active || !sel.mask) return 0;
    return sel.mask[y * sel.maskWidth + x] ?? 0;
  }, { x, y });
}

async function wandClick(page: Page, x: number, y: number, modifier?: 'Shift' | 'Alt'): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.move(p.x, p.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down();
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(150);
}

test.describe('Magic Wand clicks near a selection corner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await addLayer(page);
    await drawRect(page, 100, 100, 100, 100, { r: 255, g: 0, b: 0 });
    await drawRect(page, 202, 60, 58, 140, { r: 0, g: 0, b: 255 });
    await page.keyboard.press('w');

    await wandClick(page, 150, 150);
    const sel = await readSelection(page);
    expect(sel.zoom, 'the 8 px handle radius below assumes zoom 1').toBe(1);
    expect(sel.bounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(await maskAt(page, 230, 130)).toBe(0);
  });

  test('Shift-click 7 px from the top-right handle adds the blue region', async ({ page }) => {
    // (206, 104) is on blue, ~7.2 px from the scale handle at (200, 100).
    await wandClick(page, 206, 104, 'Shift');

    await page.screenshot({ path: 'e2e/screenshots/wand-shift-click-near-handle.png' });

    expect(await maskAt(page, 150, 150), 'red stays selected').toBe(255);
    expect(await maskAt(page, 230, 130), 'blue was added').toBe(255);
    expect(await maskAt(page, 230, 70), 'the part of blue above red was added too').toBe(255);
    expect((await readSelection(page)).bounds).toEqual({ x: 100, y: 60, width: 160, height: 140 });
  });

  test('Alt-click 7 px from a handle subtracts the blue region', async ({ page }) => {
    await wandClick(page, 230, 130, 'Shift');
    expect((await readSelection(page)).bounds).toEqual({ x: 100, y: 60, width: 160, height: 140 });

    // (254, 64) is on blue, ~7.2 px from the union's top-right handle at (260, 60).
    await wandClick(page, 254, 64, 'Alt');

    await page.screenshot({ path: 'e2e/screenshots/wand-alt-click-near-handle.png' });

    expect(await maskAt(page, 230, 130), 'blue was subtracted').toBe(0);
    expect(await maskAt(page, 150, 150), 'red stays selected').toBe(255);
    expect((await readSelection(page)).bounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });
});
