/**
 * Characterization: the Edit menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (history label, toast, dialog,
 * clipboard and layer pixels) so the move onto the command registry can be
 * checked against them. Behaviour that looks wrong is pinned as-is and says
 * so. Disagreement ids (D2, D3, D13, D18) refer to docs/ui-surface-differences.md.
 */
import { test, expect, type Page } from './fixtures';
import { docToScreen, getPixelAt, setForegroundColor } from './helpers';
import {
  clickDisabledMenuItem,
  clickMenu,
  closeMenus,
  dragMarquee,
  fillRect,
  historyLabels,
  isMenuItemDisabled,
  layerPixelHash,
  menuItem,
  openDialogName,
  openDocument,
  redoLabels,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
  topHistoryLabel,
} from './surface-helpers';

const RED = { r: 255, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };
const OPAQUE_RED = { r: 255, g: 0, b: 0, a: 255 };

const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

interface PresetSummary {
  count: number;
  activeId: string | null;
  last: { id: string; name: string; size: number; tipWidth: number; tipHeight: number; isCustom: boolean } | null;
}

async function presets(page: Page): Promise<PresetSummary> {
  return page.evaluate(() => {
    const st = (window as unknown as {
      __toolSettingsStore: { getState: () => {
        presets: Array<{ id: string; name: string; size: number; isCustom?: boolean; tip?: { width: number; height: number } | null }>;
        activePresetId: string | null;
      } };
    }).__toolSettingsStore.getState();
    const last = st.presets.at(-1);
    return {
      count: st.presets.length,
      activeId: st.activePresetId,
      last: last
        ? { id: last.id, name: last.name, size: last.size, tipWidth: last.tip?.width ?? 0, tipHeight: last.tip?.height ?? 0, isCustom: !!last.isCustom }
        : null,
    };
  });
}

async function patterns(page: Page): Promise<Array<{ name: string; width: number; height: number }>> {
  return page.evaluate(() => {
    const st = (window as unknown as {
      __patternStore: { getState: () => { patterns: Array<{ name: string; width: number; height: number }> } };
    }).__patternStore.getState();
    return st.patterns.map((p) => ({ name: p.name, width: p.width, height: p.height }));
  });
}

/** Alpha of every pixel of document row `y` on a layer. */
async function alphaRow(page: Page, layerId: string, y: number): Promise<number[]> {
  return page.evaluate(async ({ id, y }) => {
    const w = window as unknown as Record<string, unknown>;
    const doc = (w.__editorStore as {
      getState: () => { document: { width: number; layers: Array<{ id: string; x: number; y: number }> } };
    }).getState().document;
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> }>;
    const img = await read(id);
    const layer = doc.layers.find((l) => l.id === id);
    const out: number[] = [];
    for (let x = 0; x < doc.width; x++) {
      const lx = x - (layer?.x ?? 0);
      const ly = y - (layer?.y ?? 0);
      out.push(lx < 0 || ly < 0 || lx >= img.width || ly >= img.height ? 0 : img.pixels[(ly * img.width + lx) * 4 + 3] ?? 0);
    }
    return out;
  }, { id: layerId, y });
}

/** Commit a text layer through the UI and return its id. */
async function addTextLayer(page: Page): Promise<string> {
  await startTextEditing(page, 100, 80, 'Hi');
  await page.keyboard.press('Shift+Enter');
  await settle(page);
  const s = await surfaceState(page);
  expect(s.textEditing).toBe(false);
  const text = s.layers.find((l) => l.id === s.activeLayerId);
  expect(text?.type).toBe('text');
  return s.activeLayerId!;
}

test.describe('Edit menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------

  test('Undo reverts the last Fill and Redo re-applies it', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    expect(await getPixelAt(page, 50, 40, layer)).toEqual(OPAQUE_RED);

    await clickMenu(page, 'Edit', 'Undo');
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual(['Fill']);
    expect((await getPixelAt(page, 50, 40, layer)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();

    await clickMenu(page, 'Edit', 'Redo');
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await redoLabels(page)).toEqual([]);
    expect(await getPixelAt(page, 50, 40, layer)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 10, 10, layer)).a).toBe(0);
  });

  test('D18: Undo and Redo are never disabled; Undo on a fresh document pops "New Document"', async ({ page }) => {
    for (const item of ['Undo', 'Redo']) {
      expect(await isMenuItemDisabled(page, 'Edit', item)).toBe(false);
    }

    // Pinned as-is: the document's first entry can be undone.
    await clickMenu(page, 'Edit', 'Undo');
    expect(await historyLabels(page)).toEqual([]);
    expect(await redoLabels(page)).toEqual(['New Document']);
    expect(await isMenuItemDisabled(page, 'Edit', 'Undo')).toBe(false);

    // With an empty undo stack, Undo changes nothing.
    await clickMenu(page, 'Edit', 'Undo');
    expect(await historyLabels(page)).toEqual([]);
    expect(await redoLabels(page)).toEqual(['New Document']);
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);

    await clickMenu(page, 'Edit', 'Redo');
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual([]);

    // With an empty redo stack, Redo changes nothing.
    await clickMenu(page, 'Edit', 'Redo');
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------

  test('Cut clears the selected pixels, fills the clipboard and pushes "Cut"', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await dragMarquee(page, 10, 10, 50, 50);

    await clickMenu(page, 'Edit', 'Cut');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Cut']);
    expect(s.clipboard).toEqual({ width: 40, height: 40, offsetX: 10, offsetY: 10 });
    expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
    expect(await getPixelAt(page, 60, 50, layer)).toEqual(OPAQUE_RED);
    expect(s.selection.bounds).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(await toasts(page)).toEqual([]);
  });

  test('Copy fills the clipboard from the active layer without a history entry or pixel change', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await dragMarquee(page, 10, 10, 50, 50);
    const hash = await layerPixelHash(page, layer);

    await clickMenu(page, 'Edit', 'Copy');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(s.clipboard).toEqual({ width: 40, height: 40, offsetX: 10, offsetY: 10 });
    expect(await layerPixelHash(page, layer)).toBe(hash);
    expect(await toasts(page)).toEqual([]);
  });

  test('Copy Merged copies the composite (white background included); Paste places it', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await dragMarquee(page, 10, 10, 50, 50);

    await clickMenu(page, 'Edit', 'Copy Merged');
    await expect.poll(async () => (await surfaceState(page)).clipboard).toEqual({ width: 40, height: 40, offsetX: 10, offsetY: 10 });
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);

    await clickMenu(page, 'Edit', 'Paste');
    const pasted = (await surfaceState(page)).activeLayerId!;
    // White from the background where Layer 1 is empty, red where it is filled.
    expect(await getPixelAt(page, 15, 15, pasted)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(await getPixelAt(page, 30, 30, pasted)).toEqual(OPAQUE_RED);
  });

  test('D2: Paste with an empty internal clipboard does nothing', async ({ page }) => {
    await page.keyboard.press('b');
    const before = await surfaceState(page);
    expect(before.clipboard).toBeNull();
    expect(before.activeTool).toBe('brush');

    await clickMenu(page, 'Edit', 'Paste');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(after.orderNames).toEqual(before.orderNames);
    expect(after.activeTool).toBe('brush');
    expect(after.selection.active).toBe(false);
    expect(await toasts(page)).toEqual([]);
  });

  test('Paste after Copy adds "Pasted Layer" in place, picks Move and selects its alpha', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await dragMarquee(page, 10, 10, 50, 50);
    await clickMenu(page, 'Edit', 'Copy');

    await clickMenu(page, 'Edit', 'Paste');

    // The alpha selection lands asynchronously.
    await expect.poll(async () => (await surfaceState(page)).selection.bounds).toEqual({ x: 20, y: 20, width: 30, height: 30 });
    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Paste']);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Pasted Layer', 'Project']);
    expect(s.activeLayerName).toBe('Pasted Layer');
    expect(s.activeTool).toBe('move');
    const pasted = s.layers.find((l) => l.name === 'Pasted Layer')!;
    expect({ x: pasted.x, y: pasted.y, width: pasted.width, height: pasted.height }).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(await getPixelAt(page, 30, 30, pasted.id)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 15, 15, pasted.id)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Fill
  // ---------------------------------------------------------------------------

  test('Fill paints the foreground colour inside the selection only', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await getPixelAt(page, 50, 40, s.activeLayerId!)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 85, 40, s.activeLayerId!)).a).toBe(0);
    expect((await getPixelAt(page, 50, 15, s.activeLayerId!)).a).toBe(0);
    expect(s.selection.bounds).toEqual({ x: 20, y: 20, width: 60, height: 40 });
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
  });

  test('Fill with no selection paints the whole layer', async ({ page }) => {
    const layer = (await surfaceState(page)).activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    expect((await surfaceState(page)).selection.active).toBe(false);

    await clickMenu(page, 'Edit', 'Fill');

    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    for (const [x, y] of [[0, 0], [199, 149], [100, 75]] as const) {
      expect(await getPixelAt(page, x, y, layer)).toEqual(OPAQUE_RED);
    }
  });

  test('Fill on a locked layer does nothing and shows no toast', async ({ page }) => {
    const layer = (await surfaceState(page)).activeLayerId!;
    await page.locator(`[data-layer-id="${layer}"]`).getByRole('button', { name: 'Lock layer' }).click();
    await settle(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Lock Layer']);
    const hash = await layerPixelHash(page, layer);

    await clickMenu(page, 'Edit', 'Fill');

    expect(await historyLabels(page)).toEqual(['New Document', 'Lock Layer']);
    expect(await toasts(page)).toEqual([]);
    expect(await layerPixelHash(page, layer)).toBe(hash);
    expect((await getPixelAt(page, 100, 75, layer)).a).toBe(0);
  });

  test('Fill on a text layer refuses with the guardPixelWrite toast', async ({ page }) => {
    const text = await addTextLayer(page);
    const labels = await historyLabels(page);
    const hash = await layerPixelHash(page, text);

    await clickMenu(page, 'Edit', 'Fill');

    expect(await toasts(page)).toEqual([TEXT_REFUSAL]);
    expect(await historyLabels(page)).toEqual(labels);
    expect(await layerPixelHash(page, text)).toBe(hash);
  });

  test('Fill on a group (and on the root group) refuses with the guardPixelWrite toast', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    await settle(page);
    expect((await surfaceState(page)).activeLayerName).toBe('Group');

    await clickMenu(page, 'Edit', 'Fill');
    expect(await toasts(page)).toEqual([GROUP_REFUSAL]);
    expect(await historyLabels(page)).toEqual(['New Document']);

    const { rootGroupId } = await surfaceState(page);
    await page.locator(`[data-layer-id="${rootGroupId}"]`).click();
    await settle(page);
    await clickMenu(page, 'Edit', 'Fill');
    expect(await toasts(page)).toEqual([GROUP_REFUSAL, GROUP_REFUSAL]);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  // ---------------------------------------------------------------------------
  // Patterns
  // ---------------------------------------------------------------------------

  test('Fill with Pattern... with no patterns opens "Pattern Fill" with Apply disabled', async ({ page }) => {
    await clickMenu(page, 'Edit', 'Fill with Pattern...');

    const dialog = page.getByRole('dialog', { name: 'Pattern Fill' });
    expect(await openDialogName(page)).toBe('Pattern Fill');
    await expect(dialog.getByText('No patterns defined.', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await settle(page);
    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('Define Pattern captures the selection as "Pattern 1" with no history entry', async ({ page }) => {
    await fillRect(page, 20, 20, 30, 40, RED);
    // Drop the fill's marquee first: a press on its corner would grab a handle.
    await page.keyboard.press('Control+d');
    await dragMarquee(page, 20, 20, 40, 40);

    await clickMenu(page, 'Edit', 'Define Pattern');

    await expect.poll(() => patterns(page)).toEqual([{ name: 'Pattern 1', width: 20, height: 20 }]);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
  });

  test('Define Pattern on a text layer refuses with the guardPixelWrite toast', async ({ page }) => {
    await addTextLayer(page);

    await clickMenu(page, 'Edit', 'Define Pattern');

    expect(await toasts(page)).toEqual([TEXT_REFUSAL]);
    expect(await patterns(page)).toEqual([]);
  });

  test('Fill with Pattern... Apply tiles the pattern at the typed scale and pushes "Pattern Fill"', async ({ page }) => {
    // A 20x20 pattern whose left half is red and right half clear.
    await fillRect(page, 20, 20, 30, 40, RED);
    // Drop the fill's marquee first: a press on its corner would grab a handle.
    await page.keyboard.press('Control+d');
    await dragMarquee(page, 20, 20, 40, 40);
    await clickMenu(page, 'Edit', 'Define Pattern');
    await expect.poll(async () => (await patterns(page)).length).toBe(1);
    await page.keyboard.press('Control+d');
    await clickMenu(page, 'Layer', 'New Layer');
    const target = (await surfaceState(page)).activeLayerId!;

    await clickMenu(page, 'Edit', 'Fill with Pattern...');
    const dialog = page.getByRole('dialog', { name: 'Pattern Fill' });
    await expect(dialog.getByText('Pattern 1 — 20×20')).toBeVisible();
    const scale = dialog.locator('[aria-label="Scale value"]');
    await scale.fill('50');
    await scale.press('Tab');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await settle(page);

    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Add Layer', 'Pattern Fill']);
    // At 50% the 20 px tile is 10 px: 5 red, 5 clear, across the whole row.
    const row = await alphaRow(page, target, 100);
    const runs: number[] = [];
    let start = 0;
    for (let x = 1; x <= row.length; x++) {
      if (x === row.length || (row[x]! > 127) !== (row[start]! > 127)) {
        runs.push(x - start);
        start = x;
      }
    }
    const interior = runs.slice(1, -1);
    expect(interior.length).toBeGreaterThan(30);
    for (const run of interior) expect(run).toBe(5);
    expect(row.filter((a) => a > 127).length).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // Crop
  // ---------------------------------------------------------------------------

  test('D13: Crop is disabled without a selection; with one it crops the canvas and clears the selection', async ({ page }) => {
    await clickDisabledMenuItem(page, 'Edit', 'Crop');
    let s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([200, 150]);
    expect(await historyLabels(page)).toEqual(['New Document']);

    await fillRect(page, 20, 20, 80, 60, RED);
    await dragMarquee(page, 10, 10, 110, 90);
    await clickMenu(page, 'Edit', 'Crop');

    s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Crop Canvas']);
    expect([s.docWidth, s.docHeight]).toEqual([100, 80]);
    expect(s.selection).toEqual({ active: false, bounds: null });
    // Pinned as-is: the marquee's transform handles stay set after the crop.
    expect(s.hasTransform).toBe(true);
    // The red block moved with the crop: doc (20,20) is now (10,10).
    expect(await getPixelAt(page, 10, 10, s.activeLayerId!)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 5, 5, s.activeLayerId!)).a).toBe(0);
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Brushes
  // ---------------------------------------------------------------------------

  for (const item of ['Define Brush...', 'Define Color Brush...'] as const) {
    test(`${item} is disabled without a selection`, async ({ page }) => {
      const prompts: string[] = [];
      page.on('dialog', (d) => { prompts.push(d.message()); void d.dismiss(); });
      const before = await presets(page);

      await clickDisabledMenuItem(page, 'Edit', item);

      expect(prompts).toEqual([]);
      expect(await presets(page)).toEqual(before);
    });

    test(`${item} prompts for a name and adds an active preset from the selection`, async ({ page }) => {
      const prompts: string[] = [];
      page.on('dialog', (d) => { prompts.push(`${d.type()}: ${d.message()}`); void d.accept('Stamp'); });
      await fillRect(page, 20, 20, 60, 50, BLACK);
      const before = await presets(page);

      await clickMenu(page, 'Edit', item);
      await expect.poll(async () => (await presets(page)).count).toBe(before.count + 1);

      const after = await presets(page);
      expect(prompts).toEqual(['prompt: Brush name:']);
      expect(after.last).toMatchObject({ name: 'Stamp', size: 40, tipWidth: 40, tipHeight: 30, isCustom: true });
      expect(after.activeId).toBe(after.last!.id);
      expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
      expect(await openDialogName(page)).toBeNull();
      expect(await toasts(page)).toEqual([]);
    });

    test(`${item} with the name prompt dismissed adds no preset`, async ({ page }) => {
      const prompts: string[] = [];
      page.on('dialog', (d) => { prompts.push(d.message()); void d.dismiss(); });
      await fillRect(page, 20, 20, 60, 50, BLACK);
      const before = await presets(page);

      await clickMenu(page, 'Edit', item);
      await expect.poll(() => prompts.length).toBe(1);
      await settle(page, 300);

      expect(await presets(page)).toEqual(before);
      expect(await toasts(page)).toEqual([]);
    });
  }

  test('Define Brush... over empty pixels toasts that the brush would be empty and does not prompt', async ({ page }) => {
    const prompts: string[] = [];
    page.on('dialog', (d) => { prompts.push(d.message()); void d.dismiss(); });
    await dragMarquee(page, 20, 20, 60, 50);
    const before = await presets(page);

    await clickMenu(page, 'Edit', 'Define Brush...');

    await expect.poll(() => toasts(page)).toEqual([
      "The selection has no dark pixels, so the brush would be empty. Dark pixels paint; white and transparent ones don't.",
    ]);
    expect(prompts).toEqual([]);
    expect(await presets(page)).toEqual(before);
  });

  test('Define Color Brush... over empty pixels toasts that the brush would be empty and does not prompt', async ({ page }) => {
    const prompts: string[] = [];
    page.on('dialog', (d) => { prompts.push(d.message()); void d.dismiss(); });
    await dragMarquee(page, 20, 20, 60, 50);
    const before = await presets(page);

    await clickMenu(page, 'Edit', 'Define Color Brush...');

    await expect.poll(() => toasts(page)).toEqual(['The selection has no visible pixels, so the brush would be empty.']);
    expect(prompts).toEqual([]);
    expect(await presets(page)).toEqual(before);
  });

  // ---------------------------------------------------------------------------
  // Guides
  // ---------------------------------------------------------------------------

  test('Clear Guides removes every guide with no history entry', async ({ page }) => {
    const container = await page.locator('[data-testid="canvas-container"]').boundingBox();
    if (!container) throw new Error('no canvas container');
    for (const docX of [60, 140]) {
      const { x } = await docToScreen(page, docX, 0);
      await page.mouse.click(x, container.y + 10);
      await settle(page);
    }
    expect((await surfaceState(page)).guideCount).toBe(2);

    await clickMenu(page, 'Edit', 'Clear Guides');

    expect((await surfaceState(page)).guideCount).toBe(0);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // D3: menu items while text is being edited
  // ---------------------------------------------------------------------------

  test('D3: opening and closing a menu does not commit or cancel the text edit', async ({ page }) => {
    await startTextEditing(page, 100, 80, 'Hi');
    expect((await surfaceState(page)).textEditing).toBe(true);

    await menuItem(page, 'Edit', 'Copy');
    expect((await surfaceState(page)).textEditing).toBe(true);
    await closeMenus(page);

    const s = await surfaceState(page);
    expect(s.textEditing).toBe(true);
    expect(s.activeLayerName).toBe('Text 1');
  });

  test('D3: Select > All and Edit > Copy while editing text act on the layer, and the edit stays open', async ({ page }) => {
    await startTextEditing(page, 100, 80, 'Hi');
    const text = (await surfaceState(page)).activeLayerId!;

    await clickMenu(page, 'Select', 'All');
    let s = await surfaceState(page);
    expect(s.textEditing).toBe(true);
    expect(s.selection.bounds).toEqual({ x: 0, y: 0, width: 200, height: 150 });

    await clickMenu(page, 'Edit', 'Copy');
    s = await surfaceState(page);
    expect(s.textEditing).toBe(true);
    expect(s.activeLayerId).toBe(text);
    // The layer's pixels went to the image clipboard, through the whole-document selection.
    expect(s.clipboard).toEqual({ width: 200, height: 150, offsetX: 0, offsetY: 0 });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D3: Edit > Fill while editing text refuses with the text-layer toast and keeps the edit open', async ({ page }) => {
    await startTextEditing(page, 100, 80, 'Hi');

    await clickMenu(page, 'Edit', 'Fill');

    const s = await surfaceState(page);
    expect(await toasts(page)).toEqual([TEXT_REFUSAL]);
    expect(s.textEditing).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D3: Edit > Undo while editing text removes the new text layer instead of a text change', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await page.keyboard.press('Control+d');
    const layer1 = (await surfaceState(page)).activeLayerId!;
    await startTextEditing(page, 100, 80, 'Hi');
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Text 1', 'Project']);

    await clickMenu(page, 'Edit', 'Undo');

    // Pinned as-is: the edit ends and its layer is gone; the Fill survives.
    const s = await surfaceState(page);
    expect(s.textEditing).toBe(false);
    expect(s.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(s.activeLayerId).toBe(layer1);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
    expect(await redoLabels(page)).toEqual(['Add Text Layer']);
    expect(await getPixelAt(page, 50, 40, layer1)).toEqual(OPAQUE_RED);
    expect(await topHistoryLabel(page)).toBe('Fill');
  });
});
