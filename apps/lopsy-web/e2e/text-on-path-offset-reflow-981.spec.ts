import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, setToolOption, undo, waitForStore } from './helpers';

// #981: moving a path-bound text layer and then changing its Size snapped it
// back onto the path, and ⌘Z restored the un-moved, path-anchored position
// while the Nudge rows were still in the history.

interface TextInfo { id: string; type: string; x: number; y: number; fontSize: number; pathId?: string }

async function textLayer(page: Page): Promise<TextInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: TextInfo[] } };
    };
    const l = store.getState().document.layers.find((x) => x.type === 'text')!;
    return { id: l.id, type: l.type, x: l.x, y: l.y, fontSize: l.fontSize, pathId: l.pathId };
  });
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((h) => h.label);
  });
}

async function dragDoc(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

test.describe('#981 — path-bound text keeps its moved offset on reflow', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options bar and layers panel require desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
  });

  test('Size change keeps a nudged offset and undo restores the nudged spot', async ({ page }) => {
    // An arch with the Pen tool: two smooth anchors, then Commit path.
    await page.keyboard.press('p');
    await dragDoc(page, [100, 400], [250, 250]);
    await dragDoc(page, [700, 400], [850, 550]);
    await page.locator('[aria-label="Commit path"]').click();
    await page.waitForTimeout(200);
    const pathId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ id: string }> };
      };
      return store.getState().paths[0]!.id;
    });

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 60);
    const at = await docToScreen(page, 100, 100);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('ARCHED');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const unbound = await textLayer(page);
    await page.locator('[aria-label="Text path"]').selectOption(pathId);
    await expect
      .poll(async () => {
        const l = await textLayer(page);
        return l.pathId === pathId && (l.x !== unbound.x || l.y !== unbound.y);
      }, { timeout: 15000 })
      .toBe(true);
    await settle(page);
    const anchored = await textLayer(page);

    await page.keyboard.press('v');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await settle(page);
    const nudged = await textLayer(page);
    expect(nudged.x).toBe(anchored.x + 20);
    expect(nudged.y).toBe(anchored.y);
    expect((await historyLabels(page)).slice(-2)).toEqual(['Nudge', 'Nudge']);

    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 70);
    await settle(page);
    const resized = await textLayer(page);
    expect(resized.fontSize).toBe(70);
    await page.screenshot({ path: 'e2e/screenshots/text-on-path-offset-reflow-981-resized.png' });

    // Sizing back reproduces the original layout, so the text must land on
    // the nudged spot again rather than back on the path.
    await setToolOption(page, 'Size', 60);
    await settle(page);
    const sizedBack = await textLayer(page);
    expect(sizedBack.fontSize).toBe(60);
    expect(sizedBack.x).toBe(nudged.x);
    expect(sizedBack.y).toBe(nudged.y);

    // Undo both Size changes: back to the nudged position at size 60, with
    // the Nudge rows still on the stack.
    await undo(page);
    await settle(page);
    await undo(page);
    await settle(page);
    const undone = await textLayer(page);
    expect(undone.fontSize).toBe(60);
    expect(undone.x).toBe(nudged.x);
    expect(undone.y).toBe(nudged.y);
    expect((await historyLabels(page)).slice(-2)).toEqual(['Nudge', 'Nudge']);
  });
});
