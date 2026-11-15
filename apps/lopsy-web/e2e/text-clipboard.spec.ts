import { test, expect } from './fixtures';
import { createDocument, getEditorState, waitForStore } from './helpers';
import { getTextEditing, selectTextTool, typeTextAt } from './text-edit-helpers';

/**
 * Dispatch a native paste event carrying plain text (headless clipboard is
 * unreliable). Firefox's ClipboardEvent constructor ignores the `clipboardData`
 * option and hands the listener an empty DataTransfer, so we attach our own
 * clipboardData with defineProperty — that delivers the payload in every browser.
 */
async function pasteText(page: import('./fixtures').Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'clipboardData', {
      configurable: true,
      value: {
        getData: (type: string) => (type === 'text/plain' ? t : ''),
        files: [] as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
        types: ['text/plain'],
      },
    });
    window.dispatchEvent(evt);
  }, text);
  await page.waitForTimeout(80);
}

test.describe('Text editing clipboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await selectTextTool(page);
  });

  test('Cut removes the selected text', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hello');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+x');
    await page.waitForTimeout(80);
    const state = (await getTextEditing(page))!;
    expect(state.text).toBe('');
  });

  test('Pasting inserts text at the cursor', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'AB');
    await page.keyboard.press('ArrowLeft'); // cursor between A and B
    await pasteText(page, 'X');
    expect((await getTextEditing(page))!.text).toBe('AXB');
  });

  test('Pasting replaces the active selection', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hello');
    await page.keyboard.press('ControlOrMeta+a');
    await pasteText(page, 'World');
    expect((await getTextEditing(page))!.text).toBe('World');
  });

  test('Pasting while editing does not create an image layer', async ({ page }) => {
    await typeTextAt(page, 200, 220, 'Hi');
    const before = (await getEditorState(page)).document.layers.length;
    await pasteText(page, 'there');
    const after = (await getEditorState(page)).document.layers.length;
    expect(after).toBe(before);
    expect((await getTextEditing(page))!.text).toBe('Hithere');
  });
});
