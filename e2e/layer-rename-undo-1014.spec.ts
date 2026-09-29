import { test, expect, type Page } from './fixtures';
import {
  addLayer, createDocument, docToScreen, getPixelAt,
  redo, selectTool, undo, waitForStore,
} from './helpers';

// #1014: rename, lock and colour tag were not history steps, so ⌘Z after
// them undid the step *before* and restored that snapshot's metadata too —
// the rename silently reverted along with the fill.

async function layerState(page: Page, id: string): Promise<{ name: string; locked: boolean }> {
  return page.evaluate((layerId) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string; locked: boolean }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === layerId);
    return { name: layer?.name ?? '', locked: layer?.locked ?? false };
  }, id);
}

async function undoLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function fillMarquee(page: Page): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, 100, 100);
  const b = await docToScreen(page, 200, 180);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function startRename(page: Page, id: string) {
  const row = page.locator(`[data-layer-id="${id}"]`);
  await row.locator('span[class*="name"]').first().dblclick();
  const input = row.getByLabel('Layer name');
  await expect(input).toBeFocused();
  return input;
}

test.describe('Layer metadata edits are undo steps (#1014)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('undo after a rename reverts only the rename, then the fill', async ({ page }) => {
    const id = await addLayer(page);
    const originalName = (await layerState(page, id)).name;
    await fillMarquee(page);
    expect((await getPixelAt(page, 150, 140, id)).a).toBe(255);

    const input = await startRename(page, id);
    await input.fill('Red Box');
    await input.press('Enter');
    await expect(page.locator(`[data-layer-id="${id}"]`)).toContainText('Red Box');
    expect((await undoLabels(page)).at(-1)).toBe('Rename Layer');

    await undo(page);
    await page.waitForTimeout(150);
    expect((await layerState(page, id)).name).toBe(originalName);
    expect((await getPixelAt(page, 150, 140, id)).a).toBe(255);

    await undo(page);
    await page.waitForTimeout(150);
    expect((await getPixelAt(page, 150, 140, id)).a).toBe(0);
    expect((await layerState(page, id)).name).toBe(originalName);

    await redo(page);
    await redo(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/layer-rename-undo-redone.png' });
    expect((await layerState(page, id)).name).toBe('Red Box');
    expect((await getPixelAt(page, 150, 140, id)).a).toBe(255);
  });

  test('cancelled or unchanged renames add no history entry', async ({ page }) => {
    const id = await addLayer(page);
    const depth = (await undoLabels(page)).length;

    const cancelled = await startRename(page, id);
    await cancelled.fill('Nope');
    await cancelled.press('Escape');

    const unchanged = await startRename(page, id);
    await unchanged.press('Enter');

    expect(await undoLabels(page)).toHaveLength(depth);
  });

  test('a lock toggle is its own undo step', async ({ page }) => {
    const id = await addLayer(page);
    await fillMarquee(page);
    const row = page.locator(`[data-layer-id="${id}"]`);

    await row.getByRole('button', { name: 'Lock layer' }).click();
    expect((await layerState(page, id)).locked).toBe(true);

    await undo(page);
    await page.waitForTimeout(150);
    expect((await layerState(page, id)).locked).toBe(false);
    expect((await getPixelAt(page, 150, 140, id)).a).toBe(255);
  });
});
