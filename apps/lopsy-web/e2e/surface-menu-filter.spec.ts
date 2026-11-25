/**
 * Characterization: the Filter menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (history label, toast, dialog and the
 * pixels it writes) so the move onto the command registry can be checked
 * against them. Behaviour that looks wrong is pinned as-is and says so.
 *
 * Every test starts on a 200x150 document (white background, transparent
 * layer) whose only layer holds a red block at x 20..120, y 20..100 and a
 * dark-blue (0,0,160) block over it at x 80..180, y 50..130, so blurs, edges and colour
 * filters all have something to change inside the layer's bounds.
 */
import { test, expect, type Page } from './fixtures';
import {
  clickDisabledMenuItem,
  clickMenu,
  dragMarquee,
  fillRect,
  historyLabels,
  menuItem,
  closeMenus,
  openDialogName,
  openDocument,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
} from './surface-helpers';
import { docPixel, docPixelHash, maskByteAt, openMenuDialog, setFilterValue } from './surface-helpers-filters';

const RED = { r: 255, g: 0, b: 0 };
// Not full blue, so a sharpen's overshoot has headroom to show.
const BLUE = { r: 0, g: 0, b: 160 };
const BASE_HISTORY = ['New Document', 'Fill', 'Fill'];
const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

/** Menu label → FilterDialog title (its accessible name), for every dialog item. */
const DIALOG_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ['Gaussian Blur...', 'Gaussian Blur'],
  ['Box Blur...', 'Box Blur'],
  ['Surface Blur...', 'Surface Blur'],
  ['Motion Blur...', 'Motion Blur'],
  ['Radial Blur...', 'Radial Blur'],
  ['Unsharp Mask...', 'Unsharp Mask'],
  ['Cel Shading...', 'Cel Shading'],
  ['Pixelate...', 'Pixelate'],
  ['Halftone...', 'Halftone'],
  ['Kaleidoscope...', 'Kaleidoscope'],
  ['Oil Paint...', 'Oil Paint'],
  ['Chromatic Aberration...', 'Chromatic Aberration'],
  ['Pixel Stretch...', 'Pixel Stretch'],
  ['Lens Distortion...', 'Lens Distortion'],
  ['Bloom...', 'Bloom'],
  ['Voronoi...', 'Voronoi'],
  ['Add Noise...', 'Add Noise'],
  ['Texture...', 'Texture'],
  ['Clouds...', 'Clouds'],
  ['Fibers...', 'Fibers'],
  ['Smoke...', 'Smoke'],
  ['Sunburst...', 'Sunburst'],
  ['Brightness/Contrast...', 'Brightness/Contrast'],
  ['Hue/Saturation...', 'Hue/Saturation'],
  ['Color LUT...', 'Color LUT'],
  ['Posterize...', 'Posterize'],
  ['Threshold...', 'Threshold'],
  ['Solarize...', 'Solarize'],
  ['Emboss...', 'Emboss'],
];

/** The full Filter menu, top to bottom (separators omitted). */
const ALL_ITEMS = [
  'Liquify...',
  'Gaussian Blur...', 'Box Blur...', 'Surface Blur...', 'Motion Blur...', 'Radial Blur...',
  'Tilt-Shift Blur...', 'Unsharp Mask...',
  'Find Edges', 'Cel Shading...', 'Pixelate...', 'Halftone...', 'Kaleidoscope...', 'Oil Paint...',
  'Chromatic Aberration...', 'Pixel Stretch...', 'Lens Distortion...',
  'Bloom...', 'Voronoi...',
  'Add Noise...', 'Texture...',
  'Clouds...', 'Fibers...', 'Smoke...', 'Sunburst...',
  'Brightness/Contrast...', 'Hue/Saturation...', 'Color LUT...',
  'Invert', 'Desaturate', 'Posterize...', 'Threshold...', 'Solarize...', 'Emboss...',
];

interface ApplyCase {
  item: string;
  title: string;
  values?: Record<string, number>;
  /** Random seed per run: only "changed" can be asserted, not a stable result. */
  isRandom?: boolean;
}

/** A representative Apply set spanning blur, sharpen, noise, stylize, distort, render, colour. */
const APPLY_CASES: ApplyCase[] = [
  { item: 'Gaussian Blur...', title: 'Gaussian Blur', values: { Radius: 4 } },
  { item: 'Motion Blur...', title: 'Motion Blur', values: { Distance: 12 } },
  { item: 'Unsharp Mask...', title: 'Unsharp Mask' },
  { item: 'Add Noise...', title: 'Add Noise', isRandom: true },
  { item: 'Pixelate...', title: 'Pixelate', values: { 'Block Size': 16 } },
  { item: 'Emboss...', title: 'Emboss' },
  { item: 'Lens Distortion...', title: 'Lens Distortion', values: { Strength: 60 } },
  { item: 'Kaleidoscope...', title: 'Kaleidoscope', values: { Segments: 4 } },
  { item: 'Clouds...', title: 'Clouds', isRandom: true },
  { item: 'Sunburst...', title: 'Sunburst' },
  { item: 'Threshold...', title: 'Threshold' },
];

async function paintedLayer(page: Page): Promise<string> {
  await fillRect(page, 20, 20, 120, 100, RED);
  await page.keyboard.press('Control+d');
  await fillRect(page, 80, 50, 180, 130, BLUE);
  await page.keyboard.press('Control+d');
  await settle(page);
  const s = await surfaceState(page);
  expect(s.selection.active).toBe(false);
  expect(await historyLabels(page)).toEqual(BASE_HISTORY);
  return s.activeLayerId!;
}

async function commitText(page: Page, text: string): Promise<string> {
  await startTextEditing(page, 30, 60, text);
  await page.keyboard.press('Shift+Enter');
  await settle(page, 400);
  const s = await surfaceState(page);
  const layer = s.layers.find((l) => l.id === s.activeLayerId);
  expect(layer?.type).toBe('text');
  return layer!.id;
}

test.describe('Filter menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  test('lists every item in order, none disabled outside mask edit mode', async ({ page }) => {
    const menu = page.locator('[role="menu"][aria-label="Filter"]');
    await menuItem(page, 'Filter', 'Invert');
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(ALL_ITEMS.length);
    const labels = await items.evaluateAll((els) => els.map((el) => el.querySelector('span')?.textContent ?? ''));
    expect(labels).toEqual(ALL_ITEMS);
    const disabled = await items.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-disabled') === 'true').length);
    expect(disabled).toBe(0);
    await closeMenus(page);
  });

  for (const item of ['Invert', 'Desaturate', 'Find Edges'] as const) {
    test(`${item} applies straight from the menu and pushes "${item}"`, async ({ page }) => {
      const layer = await paintedLayer(page);
      const before = await docPixelHash(page, layer);

      await clickMenu(page, 'Filter', item);

      expect(await openDialogName(page)).toBeNull();
      expect(await toasts(page)).toEqual([]);
      expect(await historyLabels(page)).toEqual([...BASE_HISTORY, item]);
      const after = await docPixelHash(page, layer);
      expect(after).not.toBe(before);
      if (item === 'Invert') {
        expect(await docPixel(page, 50, 50, layer)).toEqual({ r: 0, g: 255, b: 255, a: 255 });
        expect(await docPixel(page, 150, 110, layer)).toEqual({ r: 255, g: 255, b: 95, a: 255 });
      } else if (item === 'Desaturate') {
        for (const [x, y] of [[50, 50], [150, 110]] as const) {
          const px = await docPixel(page, x, y, layer);
          expect(px.r).toBe(px.g);
          expect(px.g).toBe(px.b);
          expect(px.a).toBe(255);
        }
      }

      await page.keyboard.press('Control+z');
      await settle(page, 300);
      expect(await docPixelHash(page, layer)).toBe(before);
    });
  }

  for (const [item, title] of DIALOG_ITEMS) {
    test(`${item} opens "${title}" and Cancel leaves pixels and history alone`, async ({ page }) => {
      const layer = await paintedLayer(page);
      const before = await docPixelHash(page, layer);

      const dialog = await openMenuDialog(page, 'Filter', item, title);
      expect(await openDialogName(page)).toBe(title);
      expect(await historyLabels(page)).toEqual(BASE_HISTORY);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await settle(page);

      expect(await openDialogName(page)).toBeNull();
      expect(await historyLabels(page)).toEqual(BASE_HISTORY);
      expect(await toasts(page)).toEqual([]);
      expect(await docPixelHash(page, layer)).toBe(before);
    });
  }

  for (const c of APPLY_CASES) {
    test(`${c.item} Apply pushes "${c.title}" and rewrites the layer`, async ({ page }) => {
      const layer = await paintedLayer(page);
      const before = await docPixelHash(page, layer);

      const dialog = await openMenuDialog(page, 'Filter', c.item, c.title);
      for (const [label, value] of Object.entries(c.values ?? {})) await setFilterValue(dialog, label, value);
      await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await settle(page, 300);

      expect(await historyLabels(page)).toEqual([...BASE_HISTORY, c.title]);
      expect(await toasts(page)).toEqual([]);
      const after = await docPixelHash(page, layer);
      expect(after).not.toBe(before);
      if (c.title === 'Threshold') {
        // Red's and blue's luminance are under the default level: both go black.
        expect(await docPixel(page, 50, 50, layer)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
        expect(await docPixel(page, 150, 110, layer)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
      }

      await page.keyboard.press('Control+z');
      await settle(page, 300);
      expect(await docPixelHash(page, layer)).toBe(before);
      if (!c.isRandom) {
        await page.keyboard.press('Control+Shift+z');
        await settle(page, 300);
        expect(await docPixelHash(page, layer)).toBe(after);
      }
    });
  }

  test('Gaussian Blur: Apply with preview off and Apply after preview on push one "Gaussian Blur" each, same pixels', async ({ page }) => {
    const layer = await paintedLayer(page);
    const before = await docPixelHash(page, layer);

    // Path 1: preview off (the default) → applyGenericFilter.
    let dialog = await openMenuDialog(page, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
    await expect(dialog.getByRole('checkbox', { name: 'Preview' })).not.toBeChecked();
    await setFilterValue(dialog, 'Radius', 6);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Gaussian Blur']);
    const direct = await docPixelHash(page, layer);
    expect(direct).not.toBe(before);

    await page.keyboard.press('Control+z');
    await settle(page, 300);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await docPixelHash(page, layer)).toBe(before);

    // Path 2: preview on → beginFilterPreview, previewGenericFilter, commitFilterPreview.
    dialog = await openMenuDialog(page, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
    await setFilterValue(dialog, 'Radius', 6);
    await dialog.getByRole('checkbox', { name: 'Preview' }).check();
    await settle(page, 500);
    // The preview writes the layer but pushes no history.
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await docPixelHash(page, layer)).toBe(direct);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);

    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Gaussian Blur']);
    expect(await docPixelHash(page, layer)).toBe(direct);
    expect(await toasts(page)).toEqual([]);

    await page.keyboard.press('Control+z');
    await settle(page, 300);
    expect(await docPixelHash(page, layer)).toBe(before);
  });

  test('Gaussian Blur: preview on, then Cancel restores the layer with no history', async ({ page }) => {
    const layer = await paintedLayer(page);
    const before = await docPixelHash(page, layer);

    const dialog = await openMenuDialog(page, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
    await dialog.getByRole('checkbox', { name: 'Preview' }).check();
    await settle(page, 500);
    expect(await docPixelHash(page, layer)).not.toBe(before);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);

    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await docPixelHash(page, layer)).toBe(before);
  });

  test('Liquify... opens the "Liquify" panel and Cancel leaves pixels and history alone', async ({ page }) => {
    const layer = await paintedLayer(page);
    const before = await docPixelHash(page, layer);

    await clickMenu(page, 'Filter', 'Liquify...');
    const panel = page.getByRole('dialog', { name: 'Liquify', exact: true });
    await expect(panel).toBeVisible();
    expect(await openDialogName(page)).toBe('Liquify');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await settle(page);

    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await toasts(page)).toEqual([]);
    expect(await docPixelHash(page, layer)).toBe(before);
  });

  test('Tilt-Shift Blur... opens its panel; Cancel restores, Apply pushes "Tilt-Shift Blur"', async ({ page }) => {
    const layer = await paintedLayer(page);
    const before = await docPixelHash(page, layer);

    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');
    let panel = page.getByRole('dialog', { name: 'Tilt-Shift Blur', exact: true });
    await expect(panel).toBeVisible();
    // The session previews on open, without history.
    expect(await docPixelHash(page, layer)).not.toBe(before);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await settle(page);
    expect(await historyLabels(page)).toEqual(BASE_HISTORY);
    expect(await docPixelHash(page, layer)).toBe(before);

    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');
    panel = page.getByRole('dialog', { name: 'Tilt-Shift Blur', exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await settle(page, 300);
    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Tilt-Shift Blur']);
    expect(await docPixelHash(page, layer)).not.toBe(before);
    expect(await toasts(page)).toEqual([]);
  });

  test('Invert on a text layer is refused with the guardPixelWrite toast and no history', async ({ page }) => {
    await paintedLayer(page);
    const text = await commitText(page, 'Hi');
    const history = await historyLabels(page);
    const before = await docPixelHash(page, text);

    await clickMenu(page, 'Filter', 'Invert');

    expect(await toasts(page)).toEqual([TEXT_REFUSAL]);
    expect(await historyLabels(page)).toEqual(history);
    expect(await docPixelHash(page, text)).toBe(before);
  });

  test('Gaussian Blur... on a text layer opens the dialog; Apply is refused with the toast', async ({ page }) => {
    await paintedLayer(page);
    const text = await commitText(page, 'Hi');
    const history = await historyLabels(page);
    const before = await docPixelHash(page, text);

    const dialog = await openMenuDialog(page, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
    expect(await toasts(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);

    expect(await toasts(page)).toEqual([TEXT_REFUSAL]);
    expect(await historyLabels(page)).toEqual(history);
    expect(await docPixelHash(page, text)).toBe(before);
  });

  test('Invert and Gaussian Blur on a group are refused with the guardPixelWrite toast and no history', async ({ page }) => {
    await paintedLayer(page);
    await page.locator('[aria-label="New Group"]').click();
    await settle(page);
    const s = await surfaceState(page);
    expect(s.layers.find((l) => l.id === s.activeLayerId)?.type).toBe('group');
    const history = await historyLabels(page);

    await clickMenu(page, 'Filter', 'Invert');
    expect(await toasts(page)).toEqual([GROUP_REFUSAL]);
    expect(await historyLabels(page)).toEqual(history);

    const dialog = await openMenuDialog(page, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settle(page, 300);
    expect((await toasts(page)).filter((t) => t === GROUP_REFUSAL).length).toBeGreaterThanOrEqual(1);
    expect(await historyLabels(page)).toEqual(history);
  });

  test('Invert with a selection changes only the selected pixels', async ({ page }) => {
    const layer = await paintedLayer(page);
    await dragMarquee(page, 0, 0, 100, 150);

    await clickMenu(page, 'Filter', 'Invert');

    expect(await historyLabels(page)).toEqual([...BASE_HISTORY, 'Invert']);
    // Inside the selection (x < 100): red → cyan, dark blue → (255,255,95).
    expect(await docPixel(page, 50, 50, layer)).toEqual({ r: 0, g: 255, b: 255, a: 255 });
    expect(await docPixel(page, 90, 110, layer)).toEqual({ r: 255, g: 255, b: 95, a: 255 });
    // Outside it nothing changed.
    expect(await docPixel(page, 110, 30, layer)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(await docPixel(page, 150, 110, layer)).toEqual({ r: 0, g: 0, b: 160, a: 255 });
    expect((await surfaceState(page)).selection.bounds).toEqual({ x: 0, y: 0, width: 100, height: 150 });
  });

  test('In layer-mask edit mode Invert writes the mask, not the pixels; Liquify and Tilt-Shift are disabled', async ({ page }) => {
    const layer = await paintedLayer(page);
    const before = await docPixelHash(page, layer);
    await page.locator('[aria-label="Add Mask"]').click();
    await page.locator('[aria-label="Edit mask for Layer 1"]').click();
    await settle(page);
    expect(await maskByteAt(page, layer, 50, 50)).toBe(255);
    const history = await historyLabels(page);

    await clickDisabledMenuItem(page, 'Filter', 'Liquify...');
    await clickDisabledMenuItem(page, 'Filter', 'Tilt-Shift Blur...');
    expect(await openDialogName(page)).toBeNull();
    expect(await historyLabels(page)).toEqual(history);

    await clickMenu(page, 'Filter', 'Invert');

    expect(await historyLabels(page)).toEqual([...history, 'Invert']);
    expect(await toasts(page)).toEqual([]);
    await expect.poll(() => maskByteAt(page, layer, 50, 50)).toBe(0);
    expect(await docPixelHash(page, layer)).toBe(before);
  });
});
