import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { clickAtDoc, getTextEditing, selectTextTool, typeTextAt } from './text-edit-helpers';

test.describe('Text caret movement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await selectTextTool(page);
  });

  test('ArrowUp / ArrowDown move the caret between lines', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    await page.keyboard.type('World'); // "Hello\nWorld", cursor at 11 (line 2)
    await page.waitForTimeout(120);

    // Move a few chars left so we're mid-line, not at an extreme column.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft'); // cursor 9 (line 2, col 3)
    expect((await getTextEditing(page))!.cursorPos).toBe(9);

    // Up crosses to line 1 (offsets 0..5).
    await page.keyboard.press('ArrowUp');
    const up = (await getTextEditing(page))!;
    expect(up.cursorPos).toBeLessThanOrEqual(5);

    // Down returns to line 2 (offsets 6..11).
    await page.keyboard.press('ArrowDown');
    const down = (await getTextEditing(page))!;
    expect(down.cursorPos).toBeGreaterThanOrEqual(6);
  });

  test('ArrowUp on the first line snaps to the start; ArrowDown on the last line snaps to the end', async ({ page }) => {
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    await page.keyboard.type('World');
    await page.waitForTimeout(120);

    // Cursor is on line 2. Two ArrowUps: first to line 1, second snaps to start.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect((await getTextEditing(page))!.cursorPos).toBe(0);

    // Two ArrowDowns: to line 2, then snap to the very end.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect((await getTextEditing(page))!.cursorPos).toBe(11);
  });

  test('clicking inside the edited text repositions the caret without committing', async ({ page }) => {
    await typeTextAt(page, 150, 220, 'Hello World');

    // Derive click positions from the live layer's rendered rect so the clicks
    // reliably land inside the text box regardless of font metrics.
    const rect = await page.evaluate(async () => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { textEditing: { layerId: string } | null };
      };
      const ed = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
      };
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number }>;
      const id = ui.getState().textEditing!.layerId;
      const layer = ed.getState().document.layers.find((l) => l.id === id)!;
      const { width, height } = await read(id);
      return { x: layer.x, y: layer.y, width, height };
    });

    const midY = rect.y + rect.height / 2;
    // Click near the start, then near the end; caret offset should grow.
    await clickAtDoc(page, rect.x + 4, midY);
    const near = (await getTextEditing(page))!;
    expect(near).not.toBeNull();

    await clickAtDoc(page, rect.x + rect.width - 4, midY);
    const far = (await getTextEditing(page))!;
    expect(far).not.toBeNull(); // still editing — inside-clicks never commit
    expect(far.cursorPos).toBeGreaterThan(near.cursorPos);
  });

  test('clicking outside the edited text commits it', async ({ page }) => {
    await typeTextAt(page, 150, 220, 'Hello');
    expect(await getTextEditing(page)).not.toBeNull();

    await clickAtDoc(page, 600, 400); // far from the text box
    expect(await getTextEditing(page)).toBeNull();
  });
});
