/**
 * Characterization: the Cmd/Ctrl key combos, as they behave today.
 *
 * These specs pin what each combo does (history label, toast, dialog,
 * clipboard, selection and layer state), and the conditions under which the
 * global handler ignores it, so the move onto the command registry can be
 * checked against them. Setups mirror the Edit, Select and Layer menu specs
 * so the differences show. Behaviour that looks wrong is pinned as-is and
 * says so. Disagreement ids (D1, D2, D3, D9, D18, D21) refer to
 * docs/ui-surface-differences.md.
 *
 * Shifted letters are pressed upper-case (`ControlOrMeta+Shift+Z`), which is
 * what a real keyboard reports as `e.key`.
 */
import { test, expect, type Page } from './fixtures';
import { getPixelAt } from './helpers';
import {
  clickMenu,
  dragMarquee,
  fillRect,
  floatSelection,
  historyLabels,
  layerPixelHash,
  openDialogName,
  openDialogNames,
  openDocument,
  redoLabels,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
  topHistoryLabel,
} from './surface-helpers';
import {
  blurFocus,
  clickLayerRow,
  clipboardWriter,
  gridFlags,
  layerByName,
  pasteEventCount,
  pasteOverText,
  pressKey,
  putExternalImageOnClipboard,
  rootAdjustments,
  rowButton,
  textEdit,
  watchPasteEvents,
} from './surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const OPAQUE_RED = { r: 255, g: 0, b: 0, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

/** Open Image > Canvas Size…, an aria-modal dialog, and check it is up. */
async function openModalDialog(page: Page): Promise<void> {
  await clickMenu(page, 'Image', 'Canvas Size...');
  expect(await openDialogName(page)).toBe('Canvas Size');
}

async function closeModalDialog(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Canvas Size' }).getByRole('button', { name: 'Cancel' }).click();
  await settle(page);
  expect(await openDialogName(page)).toBeNull();
}

/** Focus the colour panel's hex field, a text-entry input. */
async function focusHexInput(page: Page): Promise<void> {
  const hex = page.locator('input[aria-label="Hex color value"]').first();
  await hex.focus();
  await expect(hex).toBeFocused();
}

test.describe('Cmd/Ctrl keys (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the keyboard surfaces need the desktop layout');
    await openDocument(page);
  });

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------

  test('Cmd+Z reverts the last Fill and Cmd+Shift+Z re-applies it', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    expect(await getPixelAt(page, 50, 40, layer)).toEqual(OPAQUE_RED);

    await pressKey(page, 'ControlOrMeta+z');
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual(['Fill']);
    expect((await getPixelAt(page, 50, 40, layer)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();

    await pressKey(page, 'ControlOrMeta+Shift+Z');
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await redoLabels(page)).toEqual([]);
    expect(await getPixelAt(page, 50, 40, layer)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 10, 10, layer)).a).toBe(0);
  });

  test('D18: Cmd+Z on a fresh document pops "New Document"; with empty stacks both keys change nothing', async ({ page }) => {
    // Pinned as-is, as on the menu: the document's first entry can be undone.
    await pressKey(page, 'ControlOrMeta+z');
    expect(await historyLabels(page)).toEqual([]);
    expect(await redoLabels(page)).toEqual(['New Document']);

    await pressKey(page, 'ControlOrMeta+z');
    expect(await historyLabels(page)).toEqual([]);
    expect(await redoLabels(page)).toEqual(['New Document']);
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);

    await pressKey(page, 'ControlOrMeta+Shift+Z');
    expect(await historyLabels(page)).toEqual(['New Document']);
    await pressKey(page, 'ControlOrMeta+Shift+Z');
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual([]);
  });

  test('D18: Cmd+Z is ignored with an aria-modal dialog open and with a text field focused', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');

    await openModalDialog(page);
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    await closeModalDialog(page);

    await focusHexInput(page);
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await redoLabels(page)).toEqual([]);
    await blurFocus(page);

    // A focused non-text control (a row's Lock button) does not swallow it.
    const layer = (await surfaceState(page)).activeLayerId!;
    await rowButton(page, layer, 'Lock layer').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual(['Fill']);
  });

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------

  test('Cmd+X clears the selected pixels, fills the clipboard and pushes "Cut"', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await dragMarquee(page, 10, 10, 50, 50);

    await pressKey(page, 'ControlOrMeta+x');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Cut']);
    expect(s.clipboard).toEqual({ width: 40, height: 40, offsetX: 10, offsetY: 10 });
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
    expect(await getPixelAt(page, 60, 50, layer)).toEqual(OPAQUE_RED);
    expect(s.selection.bounds).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(await toasts(page)).toEqual([]);
  });

  test('Cmd+C fills the clipboard from the active layer without a history entry or pixel change', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await dragMarquee(page, 10, 10, 50, 50);
    const hash = await layerPixelHash(page, layer);

    await pressKey(page, 'ControlOrMeta+c');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(s.clipboard).toEqual({ width: 40, height: 40, offsetX: 10, offsetY: 10 });
    expect(await layerPixelHash(page, layer)).toBe(hash);
    expect(await toasts(page)).toEqual([]);
  });

  test('Cmd+Shift+C copies the composite (white background included); Cmd+V places it', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await dragMarquee(page, 10, 10, 50, 50);

    await pressKey(page, 'ControlOrMeta+Shift+C');
    await expect.poll(async () => (await surfaceState(page)).clipboard).toEqual({ width: 40, height: 40, offsetX: 10, offsetY: 10 });
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);

    await pressKey(page, 'ControlOrMeta+v', 400);
    await expect.poll(() => topHistoryLabel(page)).toBe('Paste');
    const pasted = (await surfaceState(page)).activeLayerId!;
    expect(await getPixelAt(page, 15, 15, pasted)).toEqual(WHITE);
    expect(await getPixelAt(page, 30, 30, pasted)).toEqual(OPAQUE_RED);
  });

  test('Cmd+C and Cmd+X with no selection copy the whole layer', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');
    const layer = (await surfaceState(page)).activeLayerId!;

    await pressKey(page, 'ControlOrMeta+c');
    expect((await surfaceState(page)).clipboard).toEqual({ width: 200, height: 150, offsetX: 0, offsetY: 0 });
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);

    await pressKey(page, 'ControlOrMeta+x');
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Cut']);
    expect((await getPixelAt(page, 50, 40, layer)).a).toBe(0);
  });

  test('D2: Cmd+V with an empty internal clipboard and no clipboard permission does nothing', async ({ page, browser, browserName }) => {
    test.skip(browserName !== 'chromium', "Playwright's Firefox has no clipboard-read permission to grant");
    await pressKey(page, 'b');
    const before = await surfaceState(page);
    expect(before.clipboard).toBeNull();

    // Plain text on the system clipboard, written from another context, takes
    // the paste event past its file and image branches to
    // navigator.clipboard.read(), which this page has no permission for, and
    // from there to the empty internal clipboard.
    const writer = await clipboardWriter(browser, page);
    try {
      await blurFocus(page);
      await pasteOverText(page, 'not an image', { writer, settleMs: 600 });
    } finally {
      await writer.context().close();
    }

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(after.orderNames).toEqual(before.orderNames);
    expect(after.activeTool).toBe('brush');
    expect(after.selection.active).toBe(false);
    expect(await toasts(page)).toEqual([]);
  });

  test('D2: Cmd+V after Cmd+C adds "Pasted Layer" in place, picks Move and selects its alpha; the native paste event fires', async ({ page }) => {
    await watchPasteEvents(page);
    await fillRect(page, 20, 20, 80, 60, RED);
    await dragMarquee(page, 10, 10, 50, 50);
    await pressKey(page, 'ControlOrMeta+c');

    await pressKey(page, 'ControlOrMeta+v');

    await expect.poll(async () => (await surfaceState(page)).selection.bounds).toEqual({ x: 20, y: 20, width: 30, height: 30 });
    const s = await surfaceState(page);
    // Headless Chromium dispatches a real paste event for Cmd+V on the page,
    // so the event path (not the 200 ms fallback timer) does the paste.
    expect(await pasteEventCount(page)).toBe(1);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Paste']);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Pasted Layer', 'Project']);
    expect(s.activeLayerName).toBe('Pasted Layer');
    expect(s.activeTool).toBe('move');
    const pasted = layerByName(s, 'Pasted Layer');
    expect({ x: pasted.x, y: pasted.y, width: pasted.width, height: pasted.height }).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(await getPixelAt(page, 30, 30, pasted.id)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 15, 15, pasted.id)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
  });

  test('D2: Cmd+V with an external image on the system clipboard opens it as a layer at 0,0 (the menu Paste cannot)', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', "Playwright's Firefox has no clipboard-read permission to grant");
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await putExternalImageOnClipboard(page, 30, 20, '#00ff00');
    expect((await surfaceState(page)).clipboard).toBeNull();

    await pressKey(page, 'ControlOrMeta+v');

    await expect.poll(async () => (await surfaceState(page)).selection.bounds).toEqual({ x: 0, y: 0, width: 30, height: 20 });
    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Paste']);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Pasted Layer', 'Project']);
    expect(s.activeTool).toBe('move');
    // The internal clipboard stays empty.
    expect(s.clipboard).toBeNull();
    const pasted = layerByName(s, 'Pasted Layer').id;
    expect(await getPixelAt(page, 10, 10, pasted)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect((await getPixelAt(page, 40, 30, pasted)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
  });

  test('D2: Cmd+Shift+V has no handler of its own; only the browser decides whether it pastes', async ({ page, browserName }) => {
    await watchPasteEvents(page);
    await fillRect(page, 20, 20, 80, 60, RED);
    await dragMarquee(page, 10, 10, 50, 50);
    await pressKey(page, 'ControlOrMeta+c');

    await pressKey(page, 'ControlOrMeta+Shift+V', 600);

    const s = await surfaceState(page);
    if (browserName !== 'chromium' || process.platform === 'darwin') {
      // macOS binds no paste to Cmd+Shift+V, and Firefox fires none for it
      // outside an editable element: no paste event, nothing pasted.
      expect(await pasteEventCount(page)).toBe(0);
      expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
      expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
      return;
    }
    // Chromium on Linux and Windows binds Ctrl+Shift+V to paste-as-plain-text:
    // it fires the same paste event as Ctrl+V, and the paste handler takes it as one.
    expect(await pasteEventCount(page)).toBe(1);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Paste']);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Pasted Layer', 'Project']);
  });

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  test('Cmd+A selects the whole document and shows transform handles, with no history entry', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+a');

    const s = await surfaceState(page);
    expect(s.selection).toEqual({ active: true, bounds: { x: 0, y: 0, width: 200, height: 150 } });
    expect(s.hasTransform).toBe(true);
    expect(s.selectedLayerIds).toEqual([s.activeLayerId]);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
  });

  test('Cmd+A is ignored with an aria-modal dialog open and with a text field focused', async ({ page }) => {
    await openModalDialog(page);
    await page.keyboard.press('ControlOrMeta+a');
    await settle(page);
    expect((await surfaceState(page)).selection.active).toBe(false);
    await closeModalDialog(page);

    await focusHexInput(page);
    await page.keyboard.press('ControlOrMeta+a');
    await settle(page);
    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);
  });

  test('D21: Cmd+A with a Layers-panel button focused also selects every layer', async ({ page }) => {
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;
    await rowButton(page, before.activeLayerId!, 'Lock layer').focus();

    await page.keyboard.press('ControlOrMeta+a');
    await settle(page);

    const s = await surfaceState(page);
    expect(s.selection.bounds).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    expect([...s.selectedLayerIds].sort()).toEqual([background, before.activeLayerId!].sort());
    expect(s.selectedLayerIds).not.toContain(s.rootGroupId);
    expect(s.activeLayerId).toBe(before.activeLayerId);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D21: Cmd+A with nothing focused leaves the layer selection alone', async ({ page }) => {
    const before = await surfaceState(page);
    await pressKey(page, 'ControlOrMeta+a');
    const s = await surfaceState(page);
    expect(s.selection.active).toBe(true);
    expect(s.selectedLayerIds).toEqual(before.selectedLayerIds);
  });

  test('D1: Cmd+D clears the selection and ui.transform, with no history entry', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    const marquee = await surfaceState(page);
    expect(marquee.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(marquee.hasTransform).toBe(true);

    await pressKey(page, 'ControlOrMeta+d');

    const s = await surfaceState(page);
    expect(s.selection).toEqual({ active: false, bounds: null });
    // Unlike Select > Deselect, the key also clears the transform.
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('D1: Cmd+D after a Move drag commits the float in place and clears ui.transform', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    expect((await surfaceState(page)).hasFloat).toBe(true);

    await pressKey(page, 'ControlOrMeta+d');

    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasFloat).toBe(false);
    expect(s.hasTransform).toBe(false);
    // No history entry for the commit: the Move entry already holds it.
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await getPixelAt(page, 100, 60, layer)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
  });

  test('Cmd+Shift+I inverts the mask, frames the result and pushes "Inverse Selection"', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);

    await pressKey(page, 'ControlOrMeta+Shift+I');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Inverse Selection']);
    expect(s.selection).toEqual({ active: true, bounds: { x: 0, y: 0, width: 200, height: 150 } });
    expect(s.hasTransform).toBe(true);

    await clickMenu(page, 'Edit', 'Fill');
    expect(await getPixelAt(page, 10, 10)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect((await getPixelAt(page, 100, 75)).a).toBe(0);
  });

  test('Cmd+Shift+I with no selection does nothing', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+Shift+I');
    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------

  test('Cmd+E merges the active layer into the raster layer below', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const background = layerByName(await surfaceState(page), 'Background').id;

    await pressKey(page, 'ControlOrMeta+e');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Merge Down']);
    expect(await toasts(page)).toEqual([]);
    expect(after.orderNames).toEqual(['Background', 'Project']);
    expect(after.activeLayerId).toBe(background);
    expect(await getPixelAt(page, 50, 40, background)).toEqual(OPAQUE_RED);
    expect(await getPixelAt(page, 10, 10, background)).toEqual(WHITE);
  });

  test('D9: Cmd+E with the bottom layer or the root group active does nothing observable', async ({ page }) => {
    const start = await surfaceState(page);
    for (const id of [layerByName(start, 'Background').id, start.rootGroupId!]) {
      await clickLayerRow(page, id);
      const before = await surfaceState(page);
      expect(before.activeLayerId).toBe(id);
      await pressKey(page, 'ControlOrMeta+e');
      const after = await surfaceState(page);
      expect(after.orderNames).toEqual(before.orderNames);
      expect(after.activeLayerId).toBe(id);
      expect(await historyLabels(page)).toEqual(['New Document']);
      expect(await toasts(page)).toEqual([]);
    }
  });

  // ---------------------------------------------------------------------------
  // View toggles
  // ---------------------------------------------------------------------------

  test("Cmd+' toggles the grid (turning snap on with it) and Cmd+; toggles guides, with no history", async ({ page }) => {
    const before = await gridFlags(page);
    expect(before).toMatchObject({ showGrid: false, snapToGrid: false, showGuides: true });

    await pressKey(page, "ControlOrMeta+'");
    expect(await gridFlags(page)).toMatchObject({ showGrid: true, snapToGrid: true, showGuides: true });
    await pressKey(page, "ControlOrMeta+'");
    // Hiding the grid leaves snap on, as View > Show Grid does.
    expect(await gridFlags(page)).toMatchObject({ showGrid: false, snapToGrid: true, showGuides: true });

    await pressKey(page, 'ControlOrMeta+;');
    expect(await gridFlags(page)).toMatchObject({ showGrid: false, showGuides: false });
    await pressKey(page, 'ControlOrMeta+;');
    expect((await gridFlags(page)).showGuides).toBe(true);

    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Image adjustments
  // ---------------------------------------------------------------------------

  const autoCases = [
    { key: 'ControlOrMeta+Shift+L', label: 'Auto Tone', node: 'levels' },
    // Real macOS Option turns the letter into another character, so this
    // combo may never fire on a Mac keyboard; Playwright reports 'L'.
    { key: 'ControlOrMeta+Alt+Shift+L', label: 'Auto Contrast', node: 'levels' },
    { key: 'ControlOrMeta+Shift+B', label: 'Auto Color', node: 'curves' },
  ] as const;

  for (const c of autoCases) {
    test(`${c.key} applies ${c.label} as an adjustment on the root group`, async ({ page }) => {
      await fillRect(page, 20, 20, 80, 60, RED);
      await pressKey(page, 'ControlOrMeta+d');
      const before = await surfaceState(page);
      const nodes = await rootAdjustments(page);

      await pressKey(page, c.key);

      await expect.poll(() => topHistoryLabel(page)).toBe(c.label);
      expect(await historyLabels(page)).toEqual(['New Document', 'Fill', c.label]);
      // One node appended to the root group's stack.
      expect(await rootAdjustments(page)).toEqual([...nodes, c.node]);
      const after = await surfaceState(page);
      expect(after.orderNames).toEqual(before.orderNames);
      expect(await toasts(page)).toEqual([]);
      expect(await openDialogName(page)).toBeNull();
    });
  }

  test('Cmd+Shift+X opens the Liquify panel, with no history entry', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+Shift+X');

    expect(await openDialogNames(page)).toEqual(['Liquify']);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);

    await page.getByRole('dialog', { name: 'Liquify' }).getByRole('button', { name: 'Cancel' }).click();
    await settle(page);
    expect(await openDialogNames(page)).toEqual([]);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Modal guard
  // ---------------------------------------------------------------------------

  test('every Cmd combo is ignored while an aria-modal dialog is open', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const before = await surfaceState(page);
    await openModalDialog(page);

    for (const key of [
      'ControlOrMeta+d', 'ControlOrMeta+x', 'ControlOrMeta+c', 'ControlOrMeta+e',
      'ControlOrMeta+Shift+I', "ControlOrMeta+'", 'ControlOrMeta+=', 'ControlOrMeta+Shift+L',
    ]) {
      await page.keyboard.press(key);
      await settle(page, 80);
    }

    const s = await surfaceState(page);
    expect(await openDialogName(page)).toBe('Canvas Size');
    expect(s.selection.bounds).toEqual(before.selection.bounds);
    expect(s.hasTransform).toBe(true);
    expect(s.clipboard).toBeNull();
    expect(s.orderNames).toEqual(before.orderNames);
    expect((await gridFlags(page)).showGrid).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    await closeModalDialog(page);
  });

  test('D2: Cmd+V is ignored while an aria-modal dialog is open (no paste, no fallback timer)', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+c');
    expect((await surfaceState(page)).clipboard).not.toBeNull();
    await openModalDialog(page);

    await page.keyboard.press('ControlOrMeta+v');
    await settle(page, 500);

    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    await closeModalDialog(page);
  });

  // ---------------------------------------------------------------------------
  // D3: keys while text is being edited
  // ---------------------------------------------------------------------------

  test('D3: Cmd+A selects all of the text, not the document', async ({ page }) => {
    await startTextEditing(page, 100, 80, 'Hi');

    await page.keyboard.press('ControlOrMeta+a');
    await settle(page);

    const t = await textEdit(page);
    expect(t).toMatchObject({ text: 'Hi', cursorPos: 2, selectionAnchor: 0 });
    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D3: Cmd+C and Cmd+Shift+C leave the image clipboard alone; Cmd+X cuts the selected text', async ({ page }) => {
    await startTextEditing(page, 100, 80, 'Hi');
    await page.keyboard.press('ControlOrMeta+a');

    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+Shift+C');
    await settle(page);
    let s = await surfaceState(page);
    expect(s.clipboard).toBeNull();
    expect(s.textEditing).toBe(true);
    expect((await textEdit(page))?.text).toBe('Hi');

    await page.keyboard.press('ControlOrMeta+x');
    await settle(page);
    expect(await textEdit(page)).toMatchObject({ text: '', cursorPos: 0, selectionAnchor: null });
    s = await surfaceState(page);
    expect(s.clipboard).toBeNull();
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Text 1', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D3: Cmd+Z, Cmd+Shift+Z, Cmd+D and Cmd+E do nothing while editing text', async ({ page }) => {
    // The same setup as the Edit > Undo D3 test: there, Undo removes the text layer.
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');
    const layer1 = (await surfaceState(page)).activeLayerId!;
    await startTextEditing(page, 100, 80, 'Hi');
    const before = await surfaceState(page);
    expect(before.orderNames).toEqual(['Background', 'Layer 1', 'Text 1', 'Project']);

    for (const key of ['ControlOrMeta+z', 'ControlOrMeta+Shift+Z', 'ControlOrMeta+d', 'ControlOrMeta+e']) {
      await page.keyboard.press(key);
      await settle(page, 80);
    }

    const s = await surfaceState(page);
    expect(s.textEditing).toBe(true);
    expect(await textEdit(page)).toMatchObject({ text: 'Hi', cursorPos: 2 });
    expect(s.orderNames).toEqual(before.orderNames);
    expect(s.activeLayerId).toBe(before.activeLayerId);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await redoLabels(page)).toEqual([]);
    expect(await getPixelAt(page, 50, 40, layer1)).toEqual(OPAQUE_RED);
  });

  test('D2/D3: Cmd+V while editing text inserts the system clipboard text', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', "Playwright's Firefox has no clipboard-read permission to grant");
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await startTextEditing(page, 100, 80, 'Hi');

    await pasteOverText(page, ' there', { settleMs: 300 });

    expect((await textEdit(page))?.text).toBe('Hi there');
    const s = await surfaceState(page);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Text 1', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Shortcut labels with no key handler
  // ---------------------------------------------------------------------------

  // ⌘N and ⌘O are browser chrome and ⌘R reloads the page, so they are not pressed.
  const labelOnly = [
    { key: 'ControlOrMeta+s', label: '⌘S Save Project' },
    { key: 'ControlOrMeta+Shift+E', label: '⇧⌘E Quick Export PNG' },
    { key: 'ControlOrMeta+Alt+Shift+E', label: '⌥⇧⌘E Export…' },
    { key: 'Shift+F5', label: '⇧F5 Fill' },
    { key: 'ControlOrMeta+Shift+N', label: '⇧⌘N New Layer' },
    { key: 'ControlOrMeta+j', label: '⌘J Duplicate Layer' },
    { key: 'ControlOrMeta+g', label: '⌘G Group Layers' },
  ];

  for (const c of labelOnly) {
    test(`label-only shortcut ${c.label} changes nothing`, async ({ page }) => {
      const downloads: string[] = [];
      page.on('download', (d) => downloads.push(d.suggestedFilename()));
      await fillRect(page, 20, 20, 80, 60, RED);
      await page.evaluate(() => { (window as unknown as Record<string, unknown>).__surfaceNoReload = true; });
      const before = await surfaceState(page);
      const hash = await layerPixelHash(page, before.activeLayerId!);

      await pressKey(page, c.key, 500);

      const s = await surfaceState(page);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__surfaceNoReload)).toBe(true);
      expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
      expect(s.orderNames).toEqual(before.orderNames);
      expect(s.activeLayerId).toBe(before.activeLayerId);
      expect(s.selection.bounds).toEqual(before.selection.bounds);
      expect(await layerPixelHash(page, before.activeLayerId!)).toBe(hash);
      expect(await openDialogNames(page)).toEqual([]);
      expect(await toasts(page)).toEqual([]);
      expect(downloads).toEqual([]);
    });
  }
});
