/**
 * Characterization: the unmodified keys (tool letters, X, D, Q, [ ], arrows,
 * Delete/Backspace, Enter, Escape, Space, text-editing keys) and the zoom
 * combos, as they behave today.
 *
 * These specs pin what each key does and when the global handler ignores it,
 * so the move onto the command registry can be checked against them. Setups
 * mirror the menu specs so the differences show. Behaviour that looks wrong
 * is pinned as-is and says so. Disagreement ids (D1, D4, D5, D10-D12, D19,
 * D20, D22-D26) refer to docs/ui-surface-differences.md.
 */
import { test, expect, type Page } from './fixtures';
import { docToScreen, getPixelAt, setForegroundColor } from './helpers';
import {
  clickMenu,
  dragMarquee,
  fillRect,
  floatSelection,
  historyLabels,
  layerPixelHash,
  menuItem,
  openDialogName,
  openDialogNames,
  openDocument,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
} from './surface-helpers';
import {
  blurFocus,
  canvasClientSize,
  clickLayerRow,
  colors,
  containerRect,
  gridFlags,
  layerByName,
  layerExtras,
  maskMode,
  panWithSpace,
  pressKey,
  rowButton,
  textEdit,
  toolSizes,
  viewport,
} from './surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const OPAQUE_RED = { r: 255, g: 0, b: 0, a: 255 };

const TOOL_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['v', 'move'], ['b', 'brush'], ['n', 'pencil'], ['e', 'eraser'], ['g', 'fill'],
  ['i', 'eyedropper'], ['s', 'stamp'], ['h', 'healing'], ['o', 'dodge'], ['y', 'sponge'],
  ['r', 'smudge'], ['m', 'marquee-rect'], ['l', 'lasso'], ['w', 'wand'], ['u', 'shape'],
  ['t', 'text'], ['c', 'crop'], ['p', 'path'], ['j', 'spray'],
];

async function activeTool(page: Page): Promise<string> {
  return (await surfaceState(page)).activeTool;
}

async function pathDraftAnchors(page: Page): Promise<number> {
  return page.evaluate(() =>
    ((window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { pathDraft: { anchors: unknown[] } | null };
    }).getState().pathDraft?.anchors.length ?? 0,
  );
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const at = await docToScreen(page, x, y);
  await page.mouse.click(at.x, at.y);
  await settle(page);
}

async function openModalDialog(page: Page): Promise<void> {
  await clickMenu(page, 'Image', 'Canvas Size...');
  expect(await openDialogName(page)).toBe('Canvas Size');
}

async function closeModalDialog(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Canvas Size' }).getByRole('button', { name: 'Cancel' }).click();
  await settle(page);
}

/** Double-click a layer's name to open the rename input, which is a text-entry field. */
async function openRenameInput(page: Page, layerId: string): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"]`).getByText('Layer 1', { exact: true }).dblclick();
  await expect(page.locator('input[aria-label="Layer name"]')).toBeFocused();
}

/** Two Pen-tool clicks: a two-anchor draft path. */
async function penDraft(page: Page): Promise<void> {
  await pressKey(page, 'p');
  await clickDoc(page, 40, 40);
  await clickDoc(page, 160, 110);
  expect(await pathDraftAnchors(page)).toBe(2);
}

test.describe('Unmodified keys and zoom (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the keyboard surfaces need the desktop layout');
    await openDocument(page);
  });

  // ---------------------------------------------------------------------------
  // Tool letters (D23)
  // ---------------------------------------------------------------------------

  test('D23: every tool letter and its toolbox button pick the same tool, with no history', async ({ page }) => {
    for (const [key, tool] of TOOL_KEYS) {
      const other = tool === 'brush' ? 'v' : 'b';
      await pressKey(page, other);
      expect(await activeTool(page)).not.toBe(tool);

      await pressKey(page, key);
      expect(await activeTool(page), `key ${key}`).toBe(tool);

      await pressKey(page, other);
      await page.locator(`[data-tool-id="${tool}"]`).click();
      await settle(page, 50);
      expect(await activeTool(page), `toolbox ${tool}`).toBe(tool);
    }
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
    // The toolbox labels carry the default letter as fixed text.
    await expect(page.locator('[data-tool-id="brush"]')).toHaveAttribute('aria-label', 'Brush (B)');
    await expect(page.locator('[data-tool-id="healing"]')).toHaveAttribute('aria-label', 'Healing Brush (H)');
  });

  test('D23: the toolbox-only tools have no letter', async ({ page }) => {
    for (const tool of ['marquee-ellipse', 'lasso-magnetic', 'quick-select', 'gradient']) {
      await page.locator(`[data-tool-id="${tool}"]`).click();
      await settle(page, 50);
      expect(await activeTool(page)).toBe(tool);
    }
    // 'k', 'a' and 'f' are not bound.
    for (const key of ['k', 'a', 'f']) await pressKey(page, key, 50);
    expect(await activeTool(page)).toBe('gradient');
  });

  test('D23: Shift+letter still picks the tool; Alt+letter and Cmd+letter do not', async ({ page }) => {
    await pressKey(page, 'v');
    await pressKey(page, 'Shift+B');
    expect(await activeTool(page)).toBe('brush');

    await pressKey(page, 'Alt+m');
    expect(await activeTool(page)).toBe('brush');
    await pressKey(page, 'ControlOrMeta+m');
    expect(await activeTool(page)).toBe('brush');
  });

  test('D23: tool letters are ignored with an aria-modal dialog open, a text field focused, or text being edited', async ({ page }) => {
    await pressKey(page, 'v');

    await openModalDialog(page);
    await page.keyboard.press('b');
    await settle(page, 50);
    expect(await activeTool(page)).toBe('move');
    await closeModalDialog(page);

    const layer1 = (await surfaceState(page)).activeLayerId!;
    await openRenameInput(page, layer1);
    await page.keyboard.press('b');
    await settle(page, 50);
    expect(await activeTool(page)).toBe('move');
    await page.keyboard.press('Escape');
    await settle(page);

    await startTextEditing(page, 100, 80, 'Hi');
    await page.keyboard.press('b');
    await settle(page);
    expect(await activeTool(page)).toBe('text');
    expect((await textEdit(page))?.text).toBe('Hib');
  });

  // ---------------------------------------------------------------------------
  // Colours and Quick Mask (D24)
  // ---------------------------------------------------------------------------

  test('D24: X and the Color panel swap button both swap the colours; D resets them', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    const red = { r: 255, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(await colors(page)).toEqual({ fg: red, bg: white });

    await pressKey(page, 'x');
    expect(await colors(page)).toEqual({ fg: white, bg: red });

    await page.getByRole('button', { name: 'Swap Colors (X)' }).click();
    await settle(page, 50);
    expect(await colors(page)).toEqual({ fg: red, bg: white });

    await pressKey(page, 'x');
    await pressKey(page, 'd');
    expect(await colors(page)).toEqual({ fg: black, bg: white });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D24: Q and the toolbox toggle both flip Quick Mask; the toggle label follows', async ({ page }) => {
    const toggle = page.locator('[data-testid="quick-mask-toggle"]');
    await expect(toggle).toHaveAttribute('aria-label', 'Enter Quick Mask (Q)');
    expect(await maskMode(page)).toBe('off');

    await pressKey(page, 'q');
    expect(await maskMode(page)).toBe('quickMask');
    await expect(toggle).toHaveAttribute('aria-label', 'Exit Quick Mask (Q)');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await settle(page);
    expect(await maskMode(page)).toBe('off');
    await expect(toggle).toHaveAttribute('aria-label', 'Enter Quick Mask (Q)');

    await toggle.click();
    await settle(page);
    expect(await maskMode(page)).toBe('quickMask');
    await pressKey(page, 'q');
    expect(await maskMode(page)).toBe('off');
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // [ and ]
  // ---------------------------------------------------------------------------

  test('[ and ] step the size of the active painting tool, or the stroke width of Pen/Shape', async ({ page }) => {
    const start = await toolSizes(page);

    await pressKey(page, 'b');
    await pressKey(page, ']');
    await pressKey(page, ']');
    await pressKey(page, '[');
    expect(await toolSizes(page)).toEqual({ ...start, brush: start.brush + 1 });

    await pressKey(page, 'e');
    await pressKey(page, '[');
    expect((await toolSizes(page)).eraser).toBe(start.eraser - 1);

    await pressKey(page, 'u');
    await pressKey(page, ']');
    expect((await toolSizes(page)).shapeStroke).toBe(start.shapeStroke + 1);

    await pressKey(page, 'p');
    await pressKey(page, ']');
    expect((await toolSizes(page)).pathStroke).toBe(start.pathStroke + 1);

    // A tool without a size: nothing changes.
    const before = await toolSizes(page);
    await pressKey(page, 'v');
    await pressKey(page, ']');
    expect(await toolSizes(page)).toEqual(before);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Zoom (D10, D11, D12)
  // ---------------------------------------------------------------------------

  test('D10: Cmd+0 sets zoom to 0.9 x min(canvas clientWidth/dw, clientHeight/dh) and pans to 0,0', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+1');
    await panWithSpace(page, -50, 30);
    expect((await viewport(page)).panX).not.toBe(0);

    await pressKey(page, 'ControlOrMeta+0');

    const v = await viewport(page);
    const canvas = await canvasClientSize(page);
    expect(v.zoom).toBeCloseTo(Math.min(canvas.width / 200, canvas.height / 150) * 0.9, 6);
    // With an integer-sized container it equals View > Fit to Screen's formula.
    const rect = await containerRect(page);
    expect(v.zoom).toBeCloseTo(Math.min(rect.width / 200, rect.height / 150) * 0.9, 6);
    expect(v.zoom).toBeGreaterThan(1);
    expect(v.panX).toBe(0);
    expect(v.panY).toBe(0);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D11: Cmd+= and Cmd++ zoom in, Cmd+- zooms out through the fixed levels, keeping the pan', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+1');
    await panWithSpace(page, 60, 40);
    const panned = await viewport(page);
    expect(panned.zoom).toBe(1);
    expect(panned.panX).not.toBe(0);

    await pressKey(page, 'ControlOrMeta+=');
    expect((await viewport(page)).zoom).toBe(2);
    // Shift+= is '+'.
    await pressKey(page, 'ControlOrMeta+Shift+=');
    expect((await viewport(page)).zoom).toBe(3);

    for (let i = 0; i < 3; i++) await pressKey(page, 'ControlOrMeta+-');
    expect((await viewport(page)).zoom).toBe(0.6667);
    await pressKey(page, 'ControlOrMeta+-');
    const v = await viewport(page);
    expect(v.zoom).toBe(0.5);
    expect({ x: v.panX, y: v.panY }).toEqual({ x: panned.panX, y: panned.panY });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D11: Cmd+= from the fractional Cmd+0 zoom lands on the next level up', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+0');
    const fitted = (await viewport(page)).zoom;
    expect(Number.isInteger(fitted)).toBe(false);
    await pressKey(page, 'ControlOrMeta+=');
    expect((await viewport(page)).zoom).toBe(Math.floor(fitted) + 1);
  });

  test('D12: Cmd+1 sets zoom 1 and pans to 0,0', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+0');
    await panWithSpace(page, 70, -30);
    const before = await viewport(page);
    expect(before.zoom).not.toBe(1);
    expect(before.panX).not.toBe(0);

    await pressKey(page, 'ControlOrMeta+1');

    const v = await viewport(page);
    expect(v).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('zoom keys are ignored with a text field focused', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+1');
    const layer1 = (await surfaceState(page)).activeLayerId!;
    await openRenameInput(page, layer1);
    await page.keyboard.press('ControlOrMeta+=');
    await page.keyboard.press('ControlOrMeta+0');
    await settle(page);
    expect((await viewport(page)).zoom).toBe(1);
    await page.keyboard.press('Escape');
  });

  // ---------------------------------------------------------------------------
  // Space
  // ---------------------------------------------------------------------------

  test('Space + drag pans the view without changing the tool or history; while editing text Space types', async ({ page }) => {
    await pressKey(page, 'ControlOrMeta+1');
    await pressKey(page, 'b');
    const before = await viewport(page);

    await panWithSpace(page, 60, 40);

    const v = await viewport(page);
    expect(v.zoom).toBe(1);
    expect(v.panX - before.panX).toBeCloseTo(60, 0);
    expect(v.panY - before.panY).toBeCloseTo(40, 0);
    expect(await activeTool(page)).toBe('brush');
    expect(await historyLabels(page)).toEqual(['New Document']);
    // The brush did not paint during the pan.
    expect((await getPixelAt(page, 100, 75)).a).toBe(0);

    await startTextEditing(page, 100, 80, 'Hi');
    await page.keyboard.press('Space');
    await settle(page);
    expect((await textEdit(page))?.text).toBe('Hi ');
  });

  // ---------------------------------------------------------------------------
  // Arrow nudges
  // ---------------------------------------------------------------------------

  test('arrows with the Move tool nudge the active layer by 1, Shift by 10, one history entry per press', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');
    const layer = (await surfaceState(page)).activeLayerId!;
    await pressKey(page, 'v');

    await pressKey(page, 'ArrowRight', 300);
    expect(await getPixelAt(page, 80, 30, layer)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 20, 30, layer)).a).toBe(0);

    await pressKey(page, 'Shift+ArrowDown', 300);
    expect(await getPixelAt(page, 50, 69, layer)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 50, 25, layer)).a).toBe(0);

    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Nudge', 'Nudge']);
    expect(await toasts(page)).toEqual([]);
  });

  test('arrows with a selection tool move the selection outline only', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    const hash = await layerPixelHash(page, layer);
    expect(await activeTool(page)).toBe('marquee-rect');

    await pressKey(page, 'ArrowLeft', 300);
    await pressKey(page, 'Shift+ArrowUp', 300);

    const s = await surfaceState(page);
    expect(s.selection.bounds).toEqual({ x: 19, y: 10, width: 60, height: 40 });
    expect(await layerPixelHash(page, layer)).toBe(hash);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Nudge', 'Nudge']);
  });

  test('arrows nudge by the grid size when the grid and snap are on', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await pressKey(page, "ControlOrMeta+'");
    expect(await gridFlags(page)).toMatchObject({ showGrid: true, snapToGrid: true, gridSize: 16 });

    await pressKey(page, 'ArrowRight', 300);

    expect((await surfaceState(page)).selection.bounds).toEqual({ x: 66, y: 40, width: 100, height: 70 });
  });

  test('arrows with a painting tool do nothing', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await pressKey(page, 'b');
    await pressKey(page, 'ArrowRight', 300);
    expect((await surfaceState(page)).selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Delete / Backspace (D4, D5, D26)
  // ---------------------------------------------------------------------------

  test('D4: Delete with no selection removes only the ACTIVE layer, as "Delete Layer", even with several selected', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);
    const before = await surfaceState(page);
    expect(before.orderNames).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    const layer1 = layerByName(before, 'Layer 1').id;
    await clickLayerRow(page, layer1, ['ControlOrMeta']);
    expect((await surfaceState(page)).selectedLayerIds).toHaveLength(2);

    await pressKey(page, 'Delete');

    const s = await surfaceState(page);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(s.activeLayerName).toBe('Layer 1');
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer', 'Delete Layer']);
    expect(await toasts(page)).toEqual([]);
  });

  test('D4: Backspace and Cmd+Backspace delete the active layer like Delete', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);

    await pressKey(page, 'Backspace');
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);

    await pressKey(page, 'ControlOrMeta+Backspace');
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer', 'Delete Layer', 'Delete Layer']);
  });

  test('D4: Delete with a non-active row button focused runs BOTH handlers and removes two layers (pinned as-is)', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);
    const before = await surfaceState(page);
    expect(before.orderNames).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    expect(before.activeLayerName).toBe('Layer 2');
    expect(before.selectedLayerIds).toEqual([before.activeLayerId]);
    const background = layerByName(before, 'Background').id;
    await rowButton(page, background, 'Lock layer').focus();

    await page.keyboard.press('Delete');
    await settle(page, 300);

    // Pinned as-is (a bug): the global handler deletes the active Layer 2,
    // Layer 1 becomes active and selected, then the Layers panel's own
    // Delete handler deletes the selection: Layer 1 as well.
    const s = await surfaceState(page);
    expect(s.orderNames).toEqual(['Background', 'Project']);
    expect(s.activeLayerId).toBe(background);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer', 'Delete Layer', 'Delete Layers']);
    expect(await toasts(page)).toEqual([]);
  });

  test('D4: Delete with the active row\'s own button focused removes one layer in Chromium (its row unmounts first), two in Firefox', async ({ page, browserName }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);
    const before = await surfaceState(page);
    await rowButton(page, before.activeLayerId!, 'Lock layer').focus();

    await page.keyboard.press('Delete');
    await settle(page, 300);

    const s = await surfaceState(page);
    if (browserName === 'firefox') {
      // Pinned as-is (a bug): Firefox still counts the panel as focused once
      // the row is gone, so the panel's handler runs too and deletes the
      // newly active Layer 1, as with a non-active row's button focused.
      expect(s.orderNames).toEqual(['Background', 'Project']);
      expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer', 'Delete Layer', 'Delete Layers']);
      return;
    }
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer', 'Delete Layer']);
  });

  test('D5: Delete with a selection clears the pixels as "Clear Selection" and keeps the layer and selection', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await dragMarquee(page, 10, 10, 50, 50);

    await pressKey(page, 'Delete');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Clear Selection']);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
    expect(await getPixelAt(page, 60, 50, layer)).toEqual(OPAQUE_RED);
    expect(s.selection.bounds).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    // Unlike Cut, the clipboard is untouched.
    expect(s.clipboard).toBeNull();
    expect(await toasts(page)).toEqual([]);
  });

  test('D5: Delete with a selection clears pixels on a LOCKED layer, with no toast (pinned as-is)', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await rowButton(page, layer, 'Lock layer').click();
    await settle(page);
    await dragMarquee(page, 10, 10, 50, 50);

    await pressKey(page, 'Delete');

    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Lock Layer', 'Clear Selection']);
    expect((await layerExtras(page, layer)).locked).toBe(true);
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
    expect(await getPixelAt(page, 60, 50, layer)).toEqual(OPAQUE_RED);
    expect(await toasts(page)).toEqual([]);
  });

  test('D5: Delete after a Move drag commits the float and clears the moved area', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    expect((await surfaceState(page)).hasFloat).toBe(true);

    await pressKey(page, 'Delete');

    const s = await surfaceState(page);
    expect(s.hasFloat).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move', 'Clear Selection']);
    expect((await getPixelAt(page, 100, 60, layer)).a).toBe(0);
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
  });

  test('D26: Delete in mask edit mode fills the mask as "Mask Clear", even on a locked layer, and keeps the layer', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');
    const layer = (await surfaceState(page)).activeLayerId!;
    await page.locator('[aria-label="Add Mask"]').click();
    await settle(page);
    expect(await maskMode(page)).toBe('layerMask');
    await rowButton(page, layer, 'Lock layer').click();
    await settle(page);

    await pressKey(page, 'Delete');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Add Mask', 'Lock Layer', 'Mask Clear']);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect((await layerExtras(page, layer)).hasMask).toBe(true);
    expect(await maskMode(page)).toBe('layerMask');
    // The layer pixels themselves are untouched.
    expect(await getPixelAt(page, 50, 40, layer)).toEqual(OPAQUE_RED);
  });

  test('Delete is ignored with an aria-modal dialog open, a text field focused, or text being edited', async ({ page }) => {
    await openModalDialog(page);
    await page.keyboard.press('Delete');
    await settle(page);
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    await closeModalDialog(page);

    const layer1 = (await surfaceState(page)).activeLayerId!;
    await openRenameInput(page, layer1);
    await page.keyboard.press('Backspace');
    await settle(page);
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    await page.keyboard.press('Escape');
    await settle(page);

    await startTextEditing(page, 100, 80, 'Hi');
    await page.keyboard.press('Backspace');
    await settle(page);
    expect((await textEdit(page))?.text).toBe('H');
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Text 1', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Enter
  // ---------------------------------------------------------------------------

  test('Enter with a two-anchor Pen draft commits the path and strokes it', async ({ page }) => {
    await penDraft(page);
    const layer = (await surfaceState(page)).activeLayerId!;

    await pressKey(page, 'Enter', 300);

    const s = await surfaceState(page);
    expect(await pathDraftAnchors(page)).toBe(0);
    expect(s.pathCount).toBe(1);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Path', 'Stroke Path']);
    // The diagonal stroke passes through the middle of the segment.
    expect((await getPixelAt(page, 100, 75, layer)).a).toBeGreaterThan(0);
    expect((await getPixelAt(page, 160, 30, layer)).a).toBe(0);
  });

  test('Enter with another tool does nothing', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await pressKey(page, 'Enter');
    const s = await surfaceState(page);
    expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(s.hasTransform).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Escape (D1, D22)
  // ---------------------------------------------------------------------------

  test('D1: Escape clears the selection and ui.transform, with no history entry', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    expect((await surfaceState(page)).hasTransform).toBe(true);

    await pressKey(page, 'Escape');

    const s = await surfaceState(page);
    expect(s.selection).toEqual({ active: false, bounds: null });
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('D1/D22: Escape after a Move drag COMMITS the float in place (there is no keyboard cancel)', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    expect((await surfaceState(page)).hasFloat).toBe(true);

    await pressKey(page, 'Escape');

    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasFloat).toBe(false);
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await getPixelAt(page, 100, 60, layer)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
  });

  test('Escape with a Pen draft drops the draft only, keeping the selection', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await penDraft(page);

    await pressKey(page, 'Escape');

    const s = await surfaceState(page);
    expect(await pathDraftAnchors(page)).toBe(0);
    expect(s.pathCount).toBe(0);
    expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('Escape with a menu open only closes the menu', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await menuItem(page, 'Edit', 'Fill');

    await page.keyboard.press('Escape');
    await settle(page);

    await expect(page.locator('nav[aria-label="Application menu"] [role="menu"]')).toHaveCount(0);
    const s = await surfaceState(page);
    expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(s.hasTransform).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Escape / Enter with a non-modal panel open (D19, D20)
  // ---------------------------------------------------------------------------

  test('D19: Escape with Tilt-Shift open cancels it AND drops the selection', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');
    expect(await openDialogNames(page)).toEqual(['Tilt-Shift Blur']);

    await page.keyboard.press('Escape');
    await settle(page);

    const s = await surfaceState(page);
    expect(await openDialogNames(page)).toEqual([]);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D20: Enter with Tilt-Shift open applies it and keeps the selection', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');

    await page.keyboard.press('Enter');
    await settle(page, 400);

    const s = await surfaceState(page);
    expect(await openDialogNames(page)).toEqual([]);
    expect(await historyLabels(page)).toEqual(['New Document', 'Tilt-Shift Blur']);
    expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(s.hasTransform).toBe(true);
  });

  test('D20: Enter with Tilt-Shift open and a Pen draft strokes the path AND applies Tilt-Shift', async ({ page }) => {
    await penDraft(page);
    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');
    expect(await openDialogNames(page)).toEqual(['Tilt-Shift Blur']);
    expect(await pathDraftAnchors(page)).toBe(2);

    await page.keyboard.press('Enter');
    await settle(page, 400);

    expect(await openDialogNames(page)).toEqual([]);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Path', 'Stroke Path', 'Tilt-Shift Blur']);
    expect((await surfaceState(page)).pathCount).toBe(1);
  });

  test('D19: Escape with the guide colour picker open closes it AND drops the selection', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    const box = await page.locator('[data-testid="canvas-container"]').boundingBox();
    if (!box) throw new Error('no canvas container');
    await page.mouse.click(box.x + 10, box.y + 10);
    await settle(page);
    await expect(page.locator('[class*="guideColorPicker"]')).toHaveCount(1);
    expect((await surfaceState(page)).modalKind).toBe('guideColor');
    expect((await surfaceState(page)).selection.active).toBe(true);

    await page.keyboard.press('Escape');
    await settle(page);

    const s = await surfaceState(page);
    await expect(page.locator('[class*="guideColorPicker"]')).toHaveCount(0);
    expect(s.modalKind).toBeNull();
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);
  });

  test('D19: with the Brushes panel open, Escape drops the selection but leaves the panel; letters and Cmd+Z stay live', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'b');
    await page.locator('[aria-label="Open brush presets"]').click();
    await settle(page);
    await dragMarquee(page, 50, 40, 150, 110);
    expect(await openDialogNames(page)).toEqual(['Brushes']);

    await page.keyboard.press('Escape');
    await settle(page);
    let s = await surfaceState(page);
    expect(await openDialogNames(page)).toEqual(['Brushes']);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);

    await page.keyboard.press('v');
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    s = await surfaceState(page);
    expect(s.activeTool).toBe('move');
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await openDialogNames(page)).toEqual(['Brushes']);
  });

  test('D19: with Liquify open, Escape drops the selection but leaves the panel; letters stay live', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await clickMenu(page, 'Filter', 'Liquify...');
    expect(await openDialogNames(page)).toEqual(['Liquify']);

    await page.keyboard.press('Escape');
    await settle(page);
    const s = await surfaceState(page);
    expect(await openDialogNames(page)).toEqual(['Liquify']);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);

    await page.keyboard.press('b');
    await settle(page);
    expect(await activeTool(page)).toBe('brush');
    expect(await openDialogNames(page)).toEqual(['Liquify']);
  });

  // ---------------------------------------------------------------------------
  // Text commit / cancel (D25)
  // ---------------------------------------------------------------------------

  const commitPaths: Array<{ name: string; commit: (page: Page) => Promise<void> }> = [
    { name: 'Tab', commit: async (page) => { await page.keyboard.press('Tab'); } },
    { name: 'Shift+Enter', commit: async (page) => { await page.keyboard.press('Shift+Enter'); } },
    { name: 'the Commit text button', commit: async (page) => { await page.getByRole('button', { name: 'Commit text' }).click(); } },
    { name: 'a canvas click outside the text', commit: async (page) => { await clickDoc(page, 20, 130); } },
    { name: 'a toolbox tool switch', commit: async (page) => { await page.locator('[data-tool-id="brush"]').click(); } },
    {
      name: 'a layer row click',
      commit: async (page) => {
        const bg = layerByName(await surfaceState(page), 'Background').id;
        await page.locator(`[data-layer-id="${bg}"]`).click();
      },
    },
  ];

  for (const c of commitPaths) {
    test(`D25: ${c.name} commits the text edit`, async ({ page }) => {
      await startTextEditing(page, 100, 80, 'Hi');
      const text = (await surfaceState(page)).activeLayerId!;
      expect(await historyLabels(page)).toEqual(['New Document']);

      await c.commit(page);
      await settle(page, 300);

      const s = await surfaceState(page);
      expect(await textEdit(page)).toBeNull();
      // The committed layer takes its text as its name.
      expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Hi', 'Project']);
      expect(layerByName(s, 'Hi').type).toBe('text');
      expect((await layerExtras(page, text)).text).toBe('Hi');
      expect(await historyLabels(page)).toEqual(['New Document', 'Add Text Layer', 'Text']);
      expect(await toasts(page)).toEqual([]);
    });
  }

  const cancelPaths: Array<{ name: string; cancel: (page: Page) => Promise<void> }> = [
    { name: 'Escape', cancel: async (page) => { await page.keyboard.press('Escape'); } },
    { name: 'the Cancel text button', cancel: async (page) => { await page.getByRole('button', { name: 'Cancel text' }).click(); } },
  ];

  for (const c of cancelPaths) {
    test(`D25: ${c.name} cancels a new text layer and removes it`, async ({ page }) => {
      await dragMarquee(page, 50, 40, 150, 110);
      await startTextEditing(page, 100, 80, 'Hi');

      await c.cancel(page);
      await settle(page, 300);

      const s = await surfaceState(page);
      expect(await textEdit(page)).toBeNull();
      expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
      expect(s.activeLayerName).toBe('Layer 1');
      expect(await historyLabels(page)).toEqual(['New Document']);
      // Escape while editing goes to the text editor only: the selection stays.
      expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
      await blurFocus(page);
    });
  }
});
