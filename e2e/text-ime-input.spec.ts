import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';
import { clickAtDoc, getTextEditing } from './text-edit-helpers';

/**
 * #803: text that arrives without a matching printable keydown — IME
 * commits, emoji, Character Viewer symbols, `insertText` — must reach the
 * text buffer. These go through the focused input sink, while ordinary keys
 * keep flowing through the global keydown handler.
 */

async function startEditing(page: Page): Promise<void> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, false);
  await page.waitForTimeout(300);
  await page.keyboard.press('t');
  await clickAtDoc(page, 40, 60);
  expect(await getTextEditing(page)).not.toBeNull();
}

async function committedText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ type: string; text?: string }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.type === 'text');
    return layer?.text ?? null;
  });
}

async function activeTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

async function textLayerOpaquePixels(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    const read = w.__readLayerPixels as (id?: string) => Promise<{ pixels: number[] }>;
    const layer = store.getState().document.layers.find((l) => l.type === 'text');
    if (!layer) return 0;
    const { pixels } = await read(layer.id);
    let n = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 128) n++;
    return n;
  });
}

test.describe('text input sink (#803)', () => {
  test('insertText delivers CJK, symbols and emoji into the buffer', async ({ page }) => {
    await startEditing(page);

    await page.keyboard.insertText('日本');
    expect((await getTextEditing(page))!.text).toBe('日本');

    await page.keyboard.type('A');
    await page.keyboard.insertText('★·¢');
    await page.keyboard.insertText('😀');
    await page.waitForTimeout(100);

    const editing = (await getTextEditing(page))!;
    expect(editing.text).toBe('日本A★·¢😀');
    // The caret sits after the emoji's surrogate pair, not inside it.
    expect(editing.cursorPos).toBe(editing.text.length);

    // Keyboard editing keeps working with the sink focused.
    await page.keyboard.press('Backspace');
    expect((await getTextEditing(page))!.text).toBe('日本A★·¢');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.insertText('!');
    expect((await getTextEditing(page))!.text).toBe('日本A★·!¢');

    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(200);
    expect(await getTextEditing(page)).toBeNull();
    expect(await committedText(page)).toBe('日本A★·!¢');

    // After the commit the sink is gone and single-key tool shortcuts work.
    await page.keyboard.press('v');
    expect(await activeTool(page)).toBe('move');
  });

  test('text inserted through the sink is rendered', async ({ page }) => {
    await startEditing(page);
    await page.keyboard.insertText('HELLO');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/text-ime-insert-text.png' });
    expect((await getTextEditing(page))!.text).toBe('HELLO');
    expect(await textLayerOpaquePixels(page)).toBeGreaterThan(100);
  });

  test('an IME composition previews inline and commits once', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'IME composition is driven via CDP Input.imeSetComposition (Chromium only)');
    await startEditing(page);
    await page.keyboard.type('x');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    await page.waitForTimeout(50);
    // The in-progress composition is shown in the buffer…
    expect((await getTextEditing(page))!.text).toBe('xにほん');

    await cdp.send('Input.insertText', { text: '日本' });
    await page.waitForTimeout(50);
    // …and replaced by the committed text, exactly once.
    const editing = (await getTextEditing(page))!;
    expect(editing.text).toBe('x日本');
    expect(editing.cursorPos).toBe(3);

    await page.keyboard.type('y');
    expect((await getTextEditing(page))!.text).toBe('x日本y');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    expect(await committedText(page)).toBe('x日本y');
  });

  test('a composition that is cancelled leaves the buffer unchanged', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'IME composition is driven via CDP Input.imeSetComposition (Chromium only)');
    await startEditing(page);
    await page.keyboard.type('ab');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    expect((await getTextEditing(page))!.text).toBe('abか');
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await page.waitForTimeout(50);
    expect((await getTextEditing(page))!.text).toBe('ab');

    await page.keyboard.press('Escape');
    expect(await getTextEditing(page)).toBeNull();
  });
});
