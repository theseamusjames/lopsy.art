import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import {
  doubleClickAtDoc,
  dragAtDoc,
  getEditingLayerRect,
  getTextEditing,
  selectTextTool,
  typeTextAt,
} from './text-edit-helpers';

test.describe('Text selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await selectTextTool(page);
  });

  test('Shift+ArrowLeft extends a selection from the cursor', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hello World'); // cursor at 11
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    const sel = (await getTextEditing(page))!;
    expect(sel.selectionAnchor).toBe(11);
    expect(sel.cursorPos).toBe(8); // "rld" selected
  });

  test('typing replaces the active selection', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hello World');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft'); // "rld" selected
    await page.keyboard.type('p');
    const state = (await getTextEditing(page))!;
    expect(state.text).toBe('Hello Wop');
    expect(state.selectionAnchor).toBeNull();
  });

  test('Ctrl/Cmd+A selects all text', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hello World');
    await page.keyboard.press('ControlOrMeta+a');
    const sel = (await getTextEditing(page))!;
    expect(sel.selectionAnchor).toBe(0);
    expect(sel.cursorPos).toBe(11);
  });

  test('double-clicking a word selects it', async ({ page }) => {
    await typeTextAt(page, 150, 220, 'Hello World');
    const rect = await getEditingLayerRect(page);
    // Over the first word ("Hello"): ~15% across, vertical centre.
    await doubleClickAtDoc(page, rect.x + rect.width * 0.15, rect.y + rect.height / 2);
    const sel = (await getTextEditing(page))!;
    expect(sel).not.toBeNull(); // double-click keeps editing
    expect(sel.selectionAnchor).not.toBeNull();
    // A whole word, not a single caret.
    expect(Math.abs(sel.cursorPos - sel.selectionAnchor!)).toBeGreaterThan(1);
  });

  test('click-drag across the text highlights a range', async ({ page }) => {
    await typeTextAt(page, 150, 220, 'Hello World');
    const rect = await getEditingLayerRect(page);
    const midY = rect.y + rect.height / 2;
    // Drag from near the start to near the end of the rendered text.
    await dragAtDoc(page, { x: rect.x + 4, y: midY }, { x: rect.x + rect.width - 4, y: midY });
    const sel = (await getTextEditing(page))!;
    expect(sel).not.toBeNull(); // drag-select never commits
    expect(sel.selectionAnchor).not.toBeNull();
    expect(sel.cursorPos).not.toBe(sel.selectionAnchor);
  });

  test('moving the caret with a plain arrow clears the selection', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hello World');
    await page.keyboard.press('ControlOrMeta+a');
    expect((await getTextEditing(page))!.selectionAnchor).toBe(0);
    await page.keyboard.press('ArrowLeft');
    expect((await getTextEditing(page))!.selectionAnchor).toBeNull();
  });
});
