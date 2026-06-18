// Regression test for issue #262 — pressing Tab to commit a text layer left
// the editor stuck in textEditing mode, so the next single-key tool shortcut
// (e.g. `t`, `b`, `v`) was inserted as a literal character into the text
// buffer instead of switching tools. The "HELLO" + Tab + `t` repro from the
// issue ended up reading as "HELLOt" with the commit/cancel chips still
// visible.
//
// Fix: useKeyboardShortcuts.ts now treats Tab during textEditing the same way
// it treats Shift+Enter — preventDefault + commitTextEditing — so the next
// keystroke goes back through the global shortcut handler.
import { test, expect } from '@playwright/test';
import {
  createDocument,
  setForegroundColor,
  selectTool,
  docToScreen,
  waitForStore,
} from './helpers';

test('issue #262 — Tab commits text and the next shortcut switches tools', async ({ page, isMobile }) => {
  test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, true);

  // Add a fresh layer for the text and pick a visible color.
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);
  await setForegroundColor(page, 255, 255, 255);

  await selectTool(page, 'text');
  const click = await docToScreen(page, 400, 300);
  await page.mouse.click(click.x, click.y);
  await page.waitForTimeout(200);

  // Type the literal "HELLO" — note that processTextKey treats single-key
  // keystrokes as printable, so this exercises the same path as a real user.
  await page.keyboard.type('HELLO');
  await page.waitForTimeout(150);

  // Snapshot the in-progress editing buffer so we know the type-typed
  // characters reached the editor before we press Tab.
  const editingTextBeforeTab = await page.evaluate(() => {
    const ui = (window as unknown as { __uiStore: { getState: () => { textEditing: { text: string } | null } } }).__uiStore;
    return ui.getState().textEditing?.text ?? null;
  });
  expect(editingTextBeforeTab).toBe('HELLO');

  // Tab — this should commit the text (clearing textEditing) and NOT leak
  // into the buffer.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);

  // After Tab, the editor should be out of edit mode and the committed
  // layer's text should be exactly "HELLO" with no trailing characters.
  const afterTab = await page.evaluate(() => {
    const ui = (window as unknown as { __uiStore: { getState: () => { textEditing: { text: string } | null } } }).__uiStore;
    const editor = (window as unknown as { __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string; text?: string }> } } } }).__editorStore;
    const lastTextLayer = [...editor.getState().document.layers]
      .reverse()
      .find((l) => typeof l.text === 'string');
    return {
      textEditing: ui.getState().textEditing,
      committedText: lastTextLayer?.text ?? null,
    };
  });
  expect(afterTab.textEditing).toBeNull();
  expect(afterTab.committedText).toBe('HELLO');

  // Press `t` — the single-key tool shortcut for the Text tool. With the
  // editor out of edit mode, this should switch tools, NOT append "t" to
  // the just-committed layer.
  await page.keyboard.press('t');
  await page.waitForTimeout(80);

  const afterToolKey = await page.evaluate(() => {
    const ui = (window as unknown as { __uiStore: { getState: () => { activeTool: string; textEditing: unknown } } }).__uiStore;
    const editor = (window as unknown as { __editorStore: { getState: () => { document: { layers: Array<{ type: string; text?: string }> } } } }).__editorStore;
    const lastTextLayer = [...editor.getState().document.layers]
      .reverse()
      .find((l) => typeof l.text === 'string');
    return {
      activeTool: ui.getState().activeTool,
      committedText: lastTextLayer?.text ?? null,
      textEditing: ui.getState().textEditing,
    };
  });
  expect(afterToolKey.activeTool).toBe('text');
  expect(afterToolKey.committedText).toBe('HELLO');
  expect(afterToolKey.textEditing).toBeNull();

  // Visual confirmation: the commit/cancel chips must NOT be visible after
  // Tab. The TextActionButtons component renders only when textEditing is
  // truthy, so an absent chip is the user-visible signal that Tab worked.
  await expect(page.locator('button[aria-label="Commit text"]')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Cancel text"]')).toHaveCount(0);

  await page.screenshot({ path: 'e2e/screenshots/bug-262-tab-commits-text.png' });
});
