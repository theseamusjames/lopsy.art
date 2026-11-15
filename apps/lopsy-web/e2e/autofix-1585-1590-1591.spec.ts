import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  setForegroundColor,
  setToolOption,
} from './helpers';

/**
 * #1585 — Select → Inverse pushed no history row, so ⌘Z after it undid the
 *         step before (a Feather) together with the inversion.
 * #1590 — the aspect-ratio control gains an Original preset (the document's
 *         ratio) and a swap button beside the lock.
 * #1591 — ⌘Z inside a previewed Mesh Warp session undid an edit, then Apply
 *         blitted the pre-undo layer back and baked the undone edit in.
 */

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function clickDoc(page: Page, x: number, y: number, modifiers: ('Shift')[] = []): Promise<void> {
  const p = await docToScreen(page, x, y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
  await page.waitForTimeout(150);
}

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

interface SelectionProbe {
  bounds: { x: number; y: number; width: number; height: number } | null;
  labels: string[];
  redo: number;
}

async function probeSelection(page: Page): Promise<SelectionProbe> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => {
        selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
        undoStack: { label: string }[];
        redoStack: unknown[];
      } };
    }).__editorStore.getState();
    return {
      bounds: store.selection.active ? store.selection.bounds : null,
      labels: store.undoStack.map((s) => s.label),
      redo: store.redoStack.length,
    };
  });
}

async function aspectRatio(page: Page): Promise<{ w: string; h: string; preset: string }> {
  return {
    w: await page.locator('[aria-label="Aspect ratio width"]').inputValue(),
    h: await page.locator('[aria-label="Aspect ratio height"]').inputValue(),
    preset: await page.locator('[aria-label="Aspect ratio preset"]').inputValue(),
  };
}

test.describe('Autofix #1585, #1590, #1591', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and options bar');
    await page.goto('/');
    await waitForStore(page);
  });

  test('#1585: Select → Inverse is its own undo step', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.keyboard.press('m');
    await dragDoc(page, 200, 150, 600, 400);

    await menu(page, 'Select', /^Feather/);
    const modal = page.locator('[role="dialog"][aria-label="Feather Selection"]');
    await modal.waitFor({ state: 'visible' });
    const input = modal.locator('input[aria-label$=" value"]').first();
    await input.fill('4');
    await input.press('Tab');
    await modal.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);

    const feathered = await probeSelection(page);
    expect(feathered.labels.at(-1)).toBe('Feather Selection');

    await menu(page, 'Select', /^Inverse/);
    const inverted = await probeSelection(page);
    expect(inverted.labels.at(-1)).toBe('Inverse Selection');
    expect(inverted.labels.length).toBe(feathered.labels.length + 1);
    expect(inverted.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await probeSelection(page);
    expect(undone.labels).toEqual(feathered.labels);
    expect(undone.bounds).toEqual(feathered.bounds);
    expect(undone.redo).toBe(1);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    const redone = await probeSelection(page);
    expect(redone.labels).toEqual(inverted.labels);
    expect(redone.bounds).toEqual(inverted.bounds);

    // The keyboard shortcut goes through the same action.
    await page.keyboard.press('Control+Shift+i');
    await page.waitForTimeout(200);
    const shortcut = await probeSelection(page);
    expect(shortcut.labels.length).toBe(inverted.labels.length + 1);
    expect(shortcut.bounds).toEqual(feathered.bounds);
  });

  test('#1590: Original preset matches the document and the swap button flips the ratio', async ({ page }) => {
    await createDocument(page, 1200, 800, false);
    await page.keyboard.press('m');

    const preset = page.locator('[aria-label="Aspect ratio preset"]');
    await expect(preset.locator('option[value="original"]')).toHaveText('Original (3:2)');
    await preset.selectOption('original');
    expect(await aspectRatio(page)).toEqual({ w: '3', h: '2', preset: 'original' });
    await expect(page.locator('[aria-label="Unlock aspect ratio"]')).toBeVisible();

    const swap = page.locator('[aria-label="Swap aspect ratio width and height"]');
    await swap.click();
    expect(await aspectRatio(page)).toEqual({ w: '2', h: '3', preset: '2:3' });

    // A locked swapped ratio constrains the marquee: a wide drag comes out 2:3.
    await dragDoc(page, 100, 100, 700, 400);
    const sel = await probeSelection(page);
    expect(sel.bounds).not.toBeNull();
    expect(sel.bounds!.width / sel.bounds!.height).toBeCloseTo(2 / 3, 1);

    await swap.click();
    expect(await aspectRatio(page)).toEqual({ w: '3', h: '2', preset: 'original' });

    await preset.selectOption('16:9');
    await swap.click();
    expect(await aspectRatio(page)).toEqual({ w: '9', h: '16', preset: '9:16' });
  });

  test('#1591: ⌘Z during a previewed Mesh Warp stays undone after Apply', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    const layerId = (await getEditorState(page)).document.activeLayerId;
    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await setForegroundColor(page, 20, 20, 20);
    await page.keyboard.press('n');
    await setToolOption(page, 'Size', 6);
    await clickDoc(page, 100, 200);
    await clickDoc(page, 700, 200, ['Shift']);
    await clickDoc(page, 100, 400);
    await clickDoc(page, 700, 400, ['Shift']);
    expect((await getPixelAt(page, 400, 400, layerId)).a).toBe(255);
    expect((await getPixelAt(page, 400, 200, layerId)).a).toBe(255);

    await page.keyboard.press('m');
    await dragDoc(page, 100, 100, 700, 500);

    await page.keyboard.press('v');
    await page.locator('button:has-text("Mesh Warp")').click();
    const controls = page.locator('[role="group"][aria-label="Mesh warp controls"]');
    await expect(controls).toBeVisible();
    await controls.getByLabel('Preview').check();
    await page.waitForTimeout(200);

    await dragDoc(page, 300, 233, 340, 160);
    const warpedBefore = await getPixelAt(page, 300, 200, layerId);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    let state = await getEditorState(page);
    expect(state.redoStackLength).toBe(1);
    // The bottom line's end was undone…
    expect((await getPixelAt(page, 400, 400, layerId)).a).toBe(0);
    // …and the preview is still on screen, matching the warped grid.
    await expect(controls.getByLabel('Preview')).toBeChecked();
    expect(await getPixelAt(page, 300, 200, layerId)).toEqual(warpedBefore);

    const undoBeforeApply = state.undoStackLength;
    await controls.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/mesh-warp-undo-preview-1591.png' });

    state = await getEditorState(page);
    expect(state.undoStackLength).toBe(undoBeforeApply + 1);
    expect((await getPixelAt(page, 400, 400, layerId)).a).toBe(0);
    expect(await getPixelAt(page, 300, 200, layerId)).toEqual(warpedBefore);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect((await getPixelAt(page, 400, 400, layerId)).a).toBe(0);
    expect((await getPixelAt(page, 400, 200, layerId)).a).toBe(255);

    // Redo brings the warp back — not the undone line.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    expect((await getPixelAt(page, 400, 400, layerId)).a).toBe(0);
    expect(await getPixelAt(page, 300, 200, layerId)).toEqual(warpedBefore);
  });
});
