/**
 * Characterization: the Image menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (history label, toast, dialog,
 * document size, colour mode and the pixels it writes) so the move onto the
 * command registry can be checked against them. Behaviour that looks wrong is
 * pinned as-is and says so.
 *
 * "Rotate 90°" and "Flip" also exist as Move-tool option buttons that do
 * different things; only the Image-menu items are pinned here.
 *
 * Most tests start on a 200x150 document (white background, transparent
 * layer) with a red block at x 10..60, y 10..40 and a blue block painted over
 * it at x 40..100, y 30..70, both on Layer 1, so the content is asymmetric.
 */
import type { Locator } from '@playwright/test';
import { test, expect, type Page } from './fixtures';
import { docToScreen, selectTool } from './helpers';
import {
  clickMenu,
  closeMenus,
  fillRect,
  historyLabels,
  menuItem,
  openDialogName,
  openDocument,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
} from './surface-helpers';
import { docPixel, docPixelHash, openMenuDialog } from './surface-helpers-filters';

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const RED_PX = { r: 255, g: 0, b: 0, a: 255 };
const BLUE_PX = { r: 0, g: 0, b: 255, a: 255 };
const CLEAR_PX = { r: 0, g: 0, b: 0, a: 0 };
const BASE_HISTORY = ['New Document', 'Fill', 'Fill'];

const MODE_ITEMS = ['RGB Color', 'Grayscale', 'Indexed Color...', 'CMYK Color', 'Lab Color'] as const;

async function paintedLayer(page: Page): Promise<string> {
  await fillRect(page, 10, 10, 60, 40, RED);
  await page.keyboard.press('Control+d');
  await fillRect(page, 40, 30, 100, 70, BLUE);
  await page.keyboard.press('Control+d');
  await settle(page);
  expect(await historyLabels(page)).toEqual(BASE_HISTORY);
  return (await surfaceState(page)).activeLayerId!;
}

async function colorMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { colorMode: string } };
    };
    return store.getState().document.colorMode;
  });
}

/** Open Image > Mode and return its flyout (left open). */
async function openModeFlyout(page: Page): Promise<Locator> {
  const parent = await menuItem(page, 'Image', 'Mode');
  await parent.hover();
  const flyout = page.locator('[role="menu"][aria-label="Mode"]');
  await expect(flyout).toBeVisible();
  return flyout;
}

/**
 * Which Mode items show the checkmark. The menu renders a check glyph in an
 * aria-hidden span; the items carry no aria-checked (pinned as-is).
 */
async function modeChecks(page: Page): Promise<Record<string, boolean>> {
  const flyout = await openModeFlyout(page);
  const out: Record<string, boolean> = {};
  for (const label of MODE_ITEMS) {
    const item = flyout.getByRole('menuitem', { name: label, exact: true });
    expect(await item.getAttribute('aria-checked')).toBeNull();
    out[label] = (await item.locator('span[class*="checkmark"]').textContent()) === '✓';
  }
  await closeMenus(page);
  return out;
}

function onlyChecked(label: (typeof MODE_ITEMS)[number]): Record<string, boolean> {
  return Object.fromEntries(MODE_ITEMS.map((l) => [l, l === label]));
}

async function rootAdjustments(page: Page): Promise<Array<{ type: string }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { rootGroupId: string | null; layers: Array<{ id: string; adjustments?: Array<{ type: string }> }> } };
    };
    const doc = store.getState().document;
    const root = doc.layers.find((l) => l.id === doc.rootGroupId);
    return (root?.adjustments ?? []).map((a) => ({ type: a.type }));
  });
}

async function layerTransform(page: Page, id: string): Promise<{ a: number; d: number } | null> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; transform?: { a: number; d: number } }> } };
    };
    const t = store.getState().document.layers.find((l) => l.id === lid)?.transform;
    return t ? { a: t.a, d: t.d } : null;
  }, id);
}

async function commitText(page: Page, x: number, y: number, text: string): Promise<string> {
  await startTextEditing(page, x, y, text);
  await page.keyboard.press('Shift+Enter');
  await settle(page, 400);
  const s = await surfaceState(page);
  const layer = s.layers.find((l) => l.id === s.activeLayerId);
  expect(layer?.type).toBe('text');
  return layer!.id;
}

function numberInputs(dialog: Locator): Locator {
  return dialog.locator('input[type="number"]');
}

test.describe('Image menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  // ---------------------------------------------------------------- Mode

  test('Mode: the checkmark follows the document mode, and re-choosing the current mode does nothing', async ({ page }) => {
    expect(await colorMode(page)).toBe('rgb');
    expect(await modeChecks(page)).toEqual(onlyChecked('RGB Color'));

    await clickMenu(page, 'Image', 'Mode', 'RGB Color');
    await settle(page, 300);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await colorMode(page)).toBe('rgb');
  });

  const conversions: Array<{ item: 'Grayscale' | 'CMYK Color' | 'Lab Color'; mode: string; label: string }> = [
    { item: 'Grayscale', mode: 'grayscale', label: 'Convert to Grayscale' },
    { item: 'CMYK Color', mode: 'cmyk', label: 'Convert to CMYK' },
    { item: 'Lab Color', mode: 'lab', label: 'Convert to Lab' },
  ];

  for (const c of conversions) {
    test(`Mode > ${c.item} converts and pushes "${c.label}"; Mode > RGB Color converts back`, async ({ page }) => {
      const layer = await paintedLayer(page);

      await clickMenu(page, 'Image', 'Mode', c.item);

      await expect.poll(() => historyLabels(page)).toEqual([...BASE_HISTORY, c.label]);
      await expect.poll(() => colorMode(page)).toBe(c.mode);
      expect(await modeChecks(page)).toEqual(onlyChecked(c.item));
      expect(await toasts(page)).toEqual([]);
      if (c.mode === 'grayscale') {
        const px = await docPixel(page, 20, 20, layer);
        expect(px.r).toBe(px.g);
        expect(px.g).toBe(px.b);
      }

      await clickMenu(page, 'Image', 'Mode', 'RGB Color');
      await expect.poll(() => historyLabels(page)).toEqual([...BASE_HISTORY, c.label, 'Convert to RGB']);
      await expect.poll(() => colorMode(page)).toBe('rgb');
      expect(await modeChecks(page)).toEqual(onlyChecked('RGB Color'));
    });
  }

  test('Mode > Indexed Color... opens "Indexed Color"; Cancel changes nothing', async ({ page }) => {
    await paintedLayer(page);
    await openModeFlyout(page);
    await page.locator('[role="menu"][aria-label="Mode"]').getByRole('menuitem', { name: 'Indexed Color...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Indexed Color', exact: true });
    await expect(dialog).toBeVisible();
    expect(await openDialogName(page)).toBe('Indexed Color');

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await colorMode(page)).toBe('rgb');
  });

  test('Mode > Indexed Color... Convert with 4 colours flattens and pushes "Convert to Indexed"', async ({ page }) => {
    await paintedLayer(page);
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);
    const before = await surfaceState(page);
    const rasterCount = before.layers.filter((l) => l.type !== 'group').length;
    expect(rasterCount).toBeGreaterThanOrEqual(2);

    await openModeFlyout(page);
    await page.locator('[role="menu"][aria-label="Mode"]').getByRole('menuitem', { name: 'Indexed Color...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Indexed Color', exact: true });
    await expect(dialog).toContainText(`This will flatten the ${rasterCount} layers`);
    await dialog.getByLabel('Colors').fill('4');
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => colorMode(page)).toBe('indexed');
    await expect.poll(async () => (await historyLabels(page)).at(-1)).toBe('Convert to Indexed');
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Add Layer', 'Convert to Indexed']);
    const after = await surfaceState(page);
    expect(after.layers.filter((l) => l.type !== 'group').length).toBe(1);
    expect(await modeChecks(page)).toEqual(onlyChecked('Indexed Color...'));
  });

  // ---------------------------------------------------------------- Canvas / Image Size / Border

  test('Canvas Size... opens "Canvas Size"; Cancel changes nothing; Apply resizes about the centre and pushes "Resize Canvas"', async ({ page }) => {
    const layer = await paintedLayer(page);
    const before = await docPixelHash(page, layer);

    let dialog = await openMenuDialog(page, 'Image', 'Canvas Size...', 'Canvas Size');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page);
    let s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([200, 150]);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await docPixelHash(page, layer)).toBe(before);

    dialog = await openMenuDialog(page, 'Image', 'Canvas Size...', 'Canvas Size');
    await expect(dialog.getByRole('button', { name: 'Anchor center middle' })).toHaveAttribute('aria-pressed', 'true');
    const inputs = numberInputs(dialog);
    await inputs.nth(0).fill('300');
    await inputs.nth(1).fill('100');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);

    s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([300, 100]);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Resize Canvas']);
    expect(await toasts(page)).toEqual([]);
    // Centre anchor: content shifts by (+50, -25). Blue (90, 60) lands at (140, 35).
    expect(await docPixel(page, 140, 35, layer)).toEqual(BLUE_PX);
    expect(await docPixel(page, 70, 5, layer)).toEqual(RED_PX);
  });

  test('Image Size... opens "Image Size"; Cancel changes nothing; Apply scales with proportions and pushes "Resize Image"', async ({ page }) => {
    const layer = await paintedLayer(page);

    let dialog = await openMenuDialog(page, 'Image', 'Image Size...', 'Image Size');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page);
    let s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([200, 150]);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);

    dialog = await openMenuDialog(page, 'Image', 'Image Size...', 'Image Size');
    const inputs = numberInputs(dialog);
    await inputs.nth(0).fill('100');
    // Constrain proportions is on by default: the height follows.
    await expect(inputs.nth(1)).toHaveValue('75');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);

    s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([100, 75]);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Resize Image']);
    // Blue (90, 60) halves to (45, 30); red (20, 15) halves to (10, 7).
    const blue = await docPixel(page, 45, 30, layer);
    expect(blue.b).toBeGreaterThan(200);
    expect(blue.r).toBeLessThan(40);
    const red = await docPixel(page, 10, 7, layer);
    expect(red.r).toBeGreaterThan(200);
    expect(red.b).toBeLessThan(40);
  });

  test('Border... opens "Border"; Cancel changes nothing; Apply with 10 px expands the canvas and pushes "Border"', async ({ page }) => {
    await paintedLayer(page);
    const layersBefore = (await surfaceState(page)).layers.length;

    let dialog = await openMenuDialog(page, 'Image', 'Border...', 'Border');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page);
    let s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([200, 150]);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);

    dialog = await openMenuDialog(page, 'Image', 'Border...', 'Border');
    const width = dialog.getByLabel('Border width (px)');
    await width.fill('0');
    await expect(dialog).toContainText('Enter a border width.');
    await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await width.fill('10');
    await expect(dialog).toContainText('New size: 220 × 170 px');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);

    s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([220, 170]);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Border']);
    expect(s.layers.length).toBe(layersBefore + 1);
    expect(await toasts(page)).toEqual([]);
  });

  // ---------------------------------------------------------------- Auto

  const autos: Array<{ item: 'Auto Tone' | 'Auto Contrast' | 'Auto Color'; type: string }> = [
    { item: 'Auto Tone', type: 'levels' },
    { item: 'Auto Contrast', type: 'levels' },
    { item: 'Auto Color', type: 'curves' },
  ];

  for (const a of autos) {
    test(`${a.item} appends a ${a.type} adjustment to the root group and pushes "${a.item}"`, async ({ page }) => {
      const layer = await paintedLayer(page);
      const pixels = await docPixelHash(page, layer);
      // A new document's root group already carries its default adjustment stack.
      const before = await rootAdjustments(page);
      expect(before.map((n) => n.type)).toEqual(['levels', 'curves', 'exposure', 'hue-saturation', 'color-grading']);

      await clickMenu(page, 'Image', a.item);

      await expect.poll(() => historyLabels(page)).toEqual([...BASE_HISTORY, a.item]);
      expect(await rootAdjustments(page)).toEqual([...before, { type: a.type }]);
      expect(await openDialogName(page)).toBeNull();
      expect(await toasts(page)).toEqual([]);
      // A non-destructive node: the layer's own pixels are untouched.
      expect(await docPixelHash(page, layer)).toBe(pixels);
    });
  }

  // ---------------------------------------------------------------- Rotate

  test('Rotate 90° CW swaps the document size, turns the content and pushes "Rotate Image 90° CW"', async ({ page }) => {
    const layer = await paintedLayer(page);

    await clickMenu(page, 'Image', 'Rotate 90° CW');

    const s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([150, 200]);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Rotate Image 90° CW']);
    // (x, y) → (149 − y, x): red (20, 20) → (129, 20); blue (90, 60) → (89, 90).
    expect(await docPixel(page, 129, 20, layer)).toEqual(RED_PX);
    expect(await docPixel(page, 89, 90, layer)).toEqual(BLUE_PX);
    expect(await toasts(page)).toEqual([]);
  });

  test('Rotate 90° CCW swaps the document size, turns the content and pushes "Rotate Image 90° CCW"', async ({ page }) => {
    const layer = await paintedLayer(page);

    await clickMenu(page, 'Image', 'Rotate 90° CCW');

    const s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([150, 200]);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Rotate Image 90° CCW']);
    // (x, y) → (y, 199 − x): red (20, 20) → (20, 179); blue (90, 60) → (60, 109).
    expect(await docPixel(page, 20, 179, layer)).toEqual(RED_PX);
    expect(await docPixel(page, 60, 109, layer)).toEqual(BLUE_PX);
  });

  // ---------------------------------------------------------------- Flip

  test('Flip Horizontal mirrors a raster layer about its content and pushes "Flip Horizontal"', async ({ page }) => {
    const layer = await paintedLayer(page);
    expect(await docPixel(page, 95, 15, layer)).toEqual(CLEAR_PX);
    expect(await docPixel(page, 15, 15, layer)).toEqual(RED_PX);

    await clickMenu(page, 'Image', 'Flip Horizontal');

    await expect.poll(() => historyLabels(page)).toEqual([...BASE_HISTORY, 'Flip Horizontal']);
    // Content spans x 10..100, so x → 110 − x: red 10..60 → 50..100, blue 40..100 → 10..70.
    expect(await docPixel(page, 95, 15, layer)).toEqual(RED_PX);
    expect(await docPixel(page, 15, 15, layer)).toEqual(CLEAR_PX);
    expect(await docPixel(page, 15, 50, layer)).toEqual(BLUE_PX);
    const s = await surfaceState(page);
    expect([s.docWidth, s.docHeight]).toEqual([200, 150]);
    expect(await toasts(page)).toEqual([]);
  });

  test('Flip Vertical mirrors a raster layer about its content and pushes "Flip Vertical"', async ({ page }) => {
    const layer = await paintedLayer(page);
    expect(await docPixel(page, 15, 60, layer)).toEqual(CLEAR_PX);

    await clickMenu(page, 'Image', 'Flip Vertical');

    await expect.poll(() => historyLabels(page)).toEqual([...BASE_HISTORY, 'Flip Vertical']);
    // Content spans y 10..70, so y → 80 − y: red 10..40 → 40..70, blue 30..70 → 10..50.
    expect(await docPixel(page, 15, 60, layer)).toEqual(RED_PX);
    expect(await docPixel(page, 95, 15, layer)).toEqual(BLUE_PX);
    expect(await docPixel(page, 15, 15, layer)).toEqual(CLEAR_PX);
  });

  test('Flip Horizontal on an upright text layer flips its transform (no refusal) and pushes "Flip Horizontal"', async ({ page }) => {
    // Pinned as-is: the inventory lists a text-layer refusal, but an upright
    // text layer flips live; only path text refuses (next test).
    await paintedLayer(page);
    const text = await commitText(page, 120, 100, 'Lp');
    const history = await historyLabels(page);

    await clickMenu(page, 'Image', 'Flip Horizontal');

    await expect.poll(() => historyLabels(page)).toEqual([...history, 'Flip Horizontal']);
    expect(await toasts(page)).toEqual([]);
    const s = await surfaceState(page);
    expect(s.layers.find((l) => l.id === text)?.type).toBe('text');
    const t = await layerTransform(page, text);
    expect(t?.a).toBeCloseTo(-1, 6);
    expect(t?.d).toBeCloseTo(1, 6);
  });

  test('Flip Horizontal on text bound to a path is refused with a toast and no history', async ({ page }) => {
    await selectTool(page, 'path');
    for (const [x, y] of [[20, 100], [180, 100]] as const) {
      const p = await docToScreen(page, x, y);
      await page.mouse.click(p.x, p.y);
      await settle(page, 100);
    }
    await page.locator('[aria-label="Commit path"]').click();
    await settle(page, 200);
    const pathId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: Array<{ id: string }> };
      };
      return store.getState().paths[0]!.id;
    });

    await startTextEditing(page, 40, 40, 'Path');
    await page.keyboard.press('Tab');
    await settle(page, 300);
    const text = (await surfaceState(page)).activeLayerId!;
    await page.locator('[aria-label="Text path"]').selectOption(pathId);
    await expect.poll(() => page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; pathId?: string }> } };
      };
      return store.getState().document.layers.find((l) => l.id === id)?.pathId ?? null;
    }, text), { timeout: 15_000 }).toBe(pathId);
    await settle(page, 400);
    const history = await historyLabels(page);
    const pixels = await docPixelHash(page, text);

    await clickMenu(page, 'Image', 'Flip Horizontal');
    await settle(page, 300);

    expect(await toasts(page)).toEqual(['Rasterize this text layer to flip it.']);
    expect(await historyLabels(page)).toEqual(history);
    expect(await docPixelHash(page, text)).toBe(pixels);
  });

  test('Flip Horizontal on a group holding live text is refused with a toast and no history', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    await settle(page);
    const group = (await surfaceState(page)).activeLayerId!;
    await page.locator('[aria-label="Add Layer"]').click();
    await settle(page);
    const child = (await surfaceState(page)).activeLayerId!;
    await fillRect(page, 10, 10, 60, 40, RED);
    await page.keyboard.press('Control+d');
    await commitText(page, 120, 100, 'Hi');
    await selectTool(page, 'move');
    const s = await surfaceState(page);
    const groupLayer = s.layers.find((l) => l.id === group)!;
    expect(groupLayer.children).toEqual(expect.arrayContaining([child]));
    expect(groupLayer.children!.some((id) => s.layers.find((l) => l.id === id)?.type === 'text')).toBe(true);

    await page.locator(`[data-layer-id="${group}"]`).click();
    await settle(page);
    const history = await historyLabels(page);
    const pixels = await docPixelHash(page, child);

    for (const item of ['Flip Horizontal', 'Flip Vertical'] as const) {
      await clickMenu(page, 'Image', item);
      await settle(page, 300);
    }

    expect(await toasts(page)).toEqual([
      'Rasterize the text layers in this group before flipping it.',
      'Rasterize the text layers in this group before flipping it.',
    ]);
    expect(await historyLabels(page)).toEqual(history);
    expect(await docPixelHash(page, child)).toBe(pixels);
  });
});
