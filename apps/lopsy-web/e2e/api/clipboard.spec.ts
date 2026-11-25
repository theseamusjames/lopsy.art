/**
 * The `clipboard` commands (src/commands/clipboard/clipboard.ts): each
 * against the Edit menu item it stands for, then on its own for every
 * refusal. The clipboard itself is not in the snapshot, so every comparison
 * ends in a paste, whose layer carries the clipboard's pixels and offset.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { createDocument, getPixelAt } from '../helpers';
import { clickMenu, dragMarquee, fillRect, historyLabels, settle, surfaceState, toasts } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const OPAQUE_RED = { r: 255, g: 0, b: 0, a: 255 };

interface Size {
  width: number;
  height: number;
}

async function menu(page: Page, item: string): Promise<void> {
  await clickMenu(page, 'Edit', item);
  await settle(page);
}

/** Edit > Paste selects the pasted pixels a frame later: wait for that, as clipboard.paste does. */
async function menuPaste(page: Page): Promise<void> {
  await menu(page, 'Paste');
  await expect.poll(async () => (await surfaceState(page)).selection.active).toBe(true);
}

async function redBlock(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 80, 60, RED);
}

async function redBlockWithMarquee(page: Page): Promise<void> {
  await redBlock(page);
  await pressKey(page, 'ControlOrMeta+d');
  await dragMarquee(page, 10, 10, 50, 50);
}

async function freshDocument(page: Page): Promise<void> {
  await createDocument(page, 200, 150, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

test.describe('the Edit menu clipboard items and the clipboard commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
  });

  test('clipboard.copy + clipboard.paste match Edit > Copy + Edit > Paste over a marquee', async ({ page }) => {
    const results: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: redBlockWithMarquee,
      viaUi: async (p) => {
        await menu(p, 'Copy');
        await menuPaste(p);
      },
      viaApi: async (p) => {
        results.push(await run<Size>(p, { op: 'clipboard.copy' }));
        results.push(await run<{ id: string }>(p, { op: 'clipboard.paste' }));
      },
      withEditorState: true,
    });
    expect(results[0]).toEqual({ width: 40, height: 40 });
    expect(api.editor.tool).toBe('move');
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Pasted Layer', 'Project']);
    expect(api.layers[2]).toMatchObject({ x: 10, y: 10 });
    expect(api.selection.bounds).toEqual({ x: 20, y: 20, width: 30, height: 30 });
    expect(api.history.undo.at(-1)).toBe('Paste');
  });

  test('clipboard.copy + clipboard.paste match the menu with no selection: the whole layer', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await redBlock(p);
        await pressKey(p, 'ControlOrMeta+d');
      },
      viaUi: async (p) => {
        await menu(p, 'Copy');
        await menuPaste(p);
      },
      viaApi: async (p) => {
        await run(p, [{ op: 'clipboard.copy' }, { op: 'clipboard.paste' }]);
      },
      withEditorState: true,
    });
    expect(api.layers[2]!.name).toBe('Pasted Layer');
    expect(api.selection.active).toBe(true);
  });

  test('clipboard.cut matches Edit > Cut: the pixels go and "Cut" is pushed; the paste brings them back', async ({ page }) => {
    let cutHistory: string[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: redBlockWithMarquee,
      viaUi: async (p) => {
        await menu(p, 'Cut');
        await menuPaste(p);
      },
      viaApi: async (p) => {
        expect(await run<Size>(p, { op: 'clipboard.cut' })).toEqual({ width: 40, height: 40 });
        cutHistory = await historyLabels(p);
        const layer1 = (await surfaceState(p)).layers.find((l) => l.name === 'Layer 1')!.id;
        expect((await getPixelAt(p, 30, 30, layer1)).a).toBe(0);
        expect(await getPixelAt(p, 60, 50, layer1)).toEqual(OPAQUE_RED);
        await run(p, { op: 'clipboard.paste' });
      },
      withEditorState: true,
    });
    expect(cutHistory).toEqual(['New Document', 'Fill', 'Cut']);
    expect(api.history.undo).toEqual(['New Document', 'Fill', 'Cut', 'Paste']);
  });

  test('clipboard.copy-merged matches Edit > Copy Merged over the white Background and a red Layer 1', async ({ page }) => {
    let pastedId = '';
    await compareUiAndApi(page, {
      setup: redBlockWithMarquee,
      viaUi: async (p) => {
        await menu(p, 'Copy Merged');
        await expect.poll(async () => (await surfaceState(p)).clipboard).not.toBeNull();
        await menuPaste(p);
      },
      viaApi: async (p) => {
        expect(await run<Size>(p, { op: 'clipboard.copy-merged' })).toEqual({ width: 40, height: 40 });
        pastedId = (await run<{ id: string }>(p, { op: 'clipboard.paste' })).id;
        expect(await getPixelAt(p, 15, 15, pastedId)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
        expect(await getPixelAt(p, 30, 30, pastedId)).toEqual(OPAQUE_RED);
      },
      withEditorState: true,
    });
    expect(pastedId).not.toBe('');
  });

  test('clipboard.copy and clipboard.cut refuse a group with the text Edit > Copy and Cut toast', async ({ page }) => {
    await freshDocument(page);
    await clickMenu(page, 'Layer', 'Group Layers');
    await settle(page);
    await menu(page, 'Copy');
    await menu(page, 'Cut');
    const uiToasts = await toasts(page);
    const uiHistory = await historyLabels(page);

    await freshDocument(page);
    await run(page, { op: 'layer.group', layers: ['Layer 1'] });
    const copy = await runError(page, { op: 'clipboard.copy' });
    const cut = await runError(page, { op: 'clipboard.cut' });
    expect([copy.message, cut.message]).toEqual(uiToasts);
    expect([copy.code, cut.code]).toEqual(['refused', 'refused']);
    expect(await historyLabels(page)).toEqual(uiHistory);
    expect((await surfaceState(page)).clipboard).toBeNull();
  });

  test('clipboard.paste refuses an empty clipboard, where Edit > Paste does nothing', async ({ page }) => {
    await freshDocument(page);
    await pressKey(page, 'b');
    const before = await surfaceState(page);
    await menu(page, 'Paste');
    const afterUi = await surfaceState(page);
    expect(afterUi.orderNames).toEqual(before.orderNames);
    expect(afterUi.activeTool).toBe('brush');

    expect(await runError(page, { op: 'clipboard.paste' })).toEqual({
      code: 'refused',
      message: 'The clipboard is empty: copy or cut something first.',
    });
    const afterApi = await surfaceState(page);
    expect(afterApi.orderNames).toEqual(before.orderNames);
    expect(afterApi.activeTool).toBe('brush');
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('the clipboard commands need a document', async ({ page }) => {
    for (const op of ['clipboard.copy', 'clipboard.cut', 'clipboard.copy-merged', 'clipboard.paste']) {
      expect((await runError(page, { op })).code).toBe('unavailable');
    }
  });
});
