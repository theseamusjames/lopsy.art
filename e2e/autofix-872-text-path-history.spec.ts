import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, undo } from './helpers';

// #872 — binding a committed text layer to a path via the Text options
// bar's Path <select> mutates layer.pathId/x/y with no history entry.
// The next Cmd+Z therefore skips the binding entirely and undoes the
// PREVIOUS history entry (the text commit) instead — the layer's text
// is emptied and an empty "Text N" row is left behind.
//
// This is the same family as #846 (fixed in PR #867 for the Size slider's
// value box), but goes through a different control (the Path dropdown)
// that #867 didn't touch.

interface TestLayer {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  pathId?: string;
}

async function getLayers(page: Page): Promise<TestLayer[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: TestLayer[] } };
    };
    return store.getState().document.layers.map((l) => ({
      id: l.id, name: l.name, type: l.type, x: l.x, y: l.y,
      text: l.text, pathId: l.pathId,
    }));
  });
}

async function getPaths(page: Page): Promise<Array<{ id: string; name: string }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ id: string; name: string }> };
    };
    return store.getState().paths.map((p) => ({ id: p.id, name: p.name }));
  });
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function commitText(page: Page) {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
}

test.describe('#872 — binding a committed text layer to a path must push history', () => {
  test('Path dropdown bind, then Cmd+Z restores pre-bind position and keeps the text', async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options bar Path dropdown requires desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);

    // Pen tool: draw a smooth 3-anchor path, then commit it via the check button.
    await page.keyboard.press('p');
    await clickAtDoc(page, 100, 250);
    await clickAtDoc(page, 300, 150);
    await clickAtDoc(page, 500, 250);
    await page.locator('button[aria-label="Commit path"]').click();
    await page.waitForTimeout(200);

    const paths = await getPaths(page);
    expect(paths, 'the pen tool should have committed one path').toHaveLength(1);

    // Text tool: click, type, commit with Tab.
    await page.keyboard.press('t');
    await clickAtDoc(page, 40, 40);
    await page.keyboard.type('HELLO PATH TEXT');
    await commitText(page);

    const afterCommit = await getLayers(page);
    const textLayer = afterCommit.find((l) => l.type === 'text');
    expect(textLayer, 'HELLO PATH TEXT should have committed').toBeTruthy();
    expect(textLayer!.text).toBe('HELLO PATH TEXT');
    expect(textLayer!.pathId).toBeUndefined();
    const preBindX = textLayer!.x;
    const preBindY = textLayer!.y;

    // Bind the committed layer to the path via the options bar dropdown —
    // this is the control #867 didn't cover.
    const pathSelect = page.locator('[aria-label="Text path"]');
    await expect(pathSelect).toBeVisible();
    await pathSelect.selectOption(paths[0]!.id);
    await page.waitForTimeout(200);

    const afterBind = await getLayers(page);
    const bound = afterBind.find((l) => l.id === textLayer!.id)!;
    expect(bound.pathId).toBe(paths[0]!.id);
    expect(bound.text).toBe('HELLO PATH TEXT');

    await undo(page);
    await page.waitForTimeout(200);

    const afterUndo = await getLayers(page);
    const undone = afterUndo.find((l) => l.id === textLayer!.id);

    // Before the fix, binding pushed no history entry, so this undo popped
    // the ORIGINAL "Text" commit instead — the layer would still exist but
    // with empty text. The fix must undo just the bind: text intact, path
    // cleared, and position restored to its pre-bind location.
    expect(undone, 'the text layer must still exist after undo').toBeTruthy();
    expect(undone!.text).toBe('HELLO PATH TEXT');
    expect(undone!.pathId).toBeUndefined();
    expect(undone!.x).toBeCloseTo(preBindX, 0);
    expect(undone!.y).toBeCloseTo(preBindY, 0);
  });
});
