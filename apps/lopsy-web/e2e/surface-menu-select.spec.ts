/**
 * Characterization: the Select menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (history label, toast, dialog,
 * selection and transform state) so the move onto the command registry can
 * be checked against them. Behaviour that looks wrong is pinned as-is and
 * says so. Disagreement ids (D1, D21, D22) refer to docs/ui-surface-differences.md.
 */
import { test, expect, type Page } from './fixtures';
import { getPixelAt, setForegroundColor } from './helpers';
import {
  clickDisabledMenuItem,
  clickMenu,
  dragMarquee,
  fillRect,
  floatSelection,
  historyLabels,
  isMenuItemDisabled,
  layerPixelHash,
  openDialogName,
  openDocument,
  settle,
  surfaceState,
  toasts,
} from './surface-helpers';

const RED = { r: 255, g: 0, b: 0 };

type ModifyItem = 'Grow…' | 'Shrink…' | 'Feather…';

const DIALOG_NAME: Record<ModifyItem, string> = {
  'Grow…': 'Grow Selection',
  'Shrink…': 'Shrink Selection',
  'Feather…': 'Feather Selection',
};

const FIELD_LABEL: Record<ModifyItem, string> = {
  'Grow…': 'Amount (px) value',
  'Shrink…': 'Amount (px) value',
  'Feather…': 'Radius (px) value',
};

/** Select > Grow…/Shrink…/Feather…, check the dialog, type `amount`, Apply. */
async function modifySelection(page: Page, item: ModifyItem, amount: number): Promise<void> {
  await clickMenu(page, 'Select', item);
  expect(await openDialogName(page)).toBe(DIALOG_NAME[item]);
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME[item] });
  const input = dialog.locator(`input[aria-label="${FIELD_LABEL[item]}"]`);
  await input.fill(String(amount));
  await input.press('Tab');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page, 300);
}

test.describe('Select menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  test('All selects the whole document and shows transform handles, with no history entry', async ({ page }) => {
    await clickMenu(page, 'Select', 'All');

    const s = await surfaceState(page);
    expect(s.selection).toEqual({ active: true, bounds: { x: 0, y: 0, width: 200, height: 150 } });
    expect(s.hasTransform).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
  });

  test('D1: Deselect clears the selection but leaves ui.transform set, with no history entry', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);
    expect((await surfaceState(page)).selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });

    await clickMenu(page, 'Select', 'Deselect');

    const s = await surfaceState(page);
    expect(s.selection).toEqual({ active: false, bounds: null });
    // Pinned as-is: the menu does not clear the transform (Cmd+D does).
    expect(s.hasTransform).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('D1: Deselect after a Move drag leaves the Move float and ui.transform in place', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    expect((await surfaceState(page)).hasFloat).toBe(true);
    const hash = await layerPixelHash(page, layer);

    await clickMenu(page, 'Select', 'Deselect');

    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasFloat).toBe(true);
    expect(s.hasTransform).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await layerPixelHash(page, layer)).toBe(hash);
  });

  test('Inverse inverts the mask, frames the result and pushes "Inverse Selection"', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);

    await clickMenu(page, 'Select', 'Inverse');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Inverse Selection']);
    expect(s.selection).toEqual({ active: true, bounds: { x: 0, y: 0, width: 200, height: 150 } });
    expect(s.hasTransform).toBe(true);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();

    // A fill through the inverted mask paints outside the old box only.
    await setForegroundColor(page, 255, 0, 0);
    await clickMenu(page, 'Edit', 'Fill');
    expect(await getPixelAt(page, 10, 10)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect((await getPixelAt(page, 100, 75)).a).toBe(0);
  });

  test('Inverse with no selection does nothing', async ({ page }) => {
    await clickMenu(page, 'Select', 'Inverse');

    const s = await surfaceState(page);
    expect(s.selection.active).toBe(false);
    expect(s.hasTransform).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('Grow… opens "Grow Selection" and Apply grows the bounds by the typed amount', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);

    await modifySelection(page, 'Grow…', 10);

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Grow Selection']);
    expect(s.selection.bounds).toEqual({ x: 40, y: 30, width: 120, height: 90 });
    expect(s.hasTransform).toBe(true);
    expect(await toasts(page)).toEqual([]);
  });

  test('Shrink… opens "Shrink Selection" and Apply shrinks the bounds by the typed amount', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);

    await modifySelection(page, 'Shrink…', 20);

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Shrink Selection']);
    expect(s.selection.bounds).toEqual({ x: 70, y: 60, width: 60, height: 30 });
    expect(await toasts(page)).toEqual([]);
  });

  test('Shrink… past the selection keeps it and toasts that no pixels would remain', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);

    await modifySelection(page, 'Shrink…', 100);

    const s = await surfaceState(page);
    expect(await toasts(page)).toEqual(['No pixels would remain selected. The selection was not changed.']);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
  });

  test('Feather… opens "Feather Selection" and Apply softens the edge outwards by the radius', async ({ page }) => {
    await dragMarquee(page, 50, 40, 150, 110);

    await modifySelection(page, 'Feather…', 5);

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Feather Selection']);
    expect(s.selection.bounds).toEqual({ x: 45, y: 35, width: 110, height: 80 });
    // A fill through the feathered mask is partial at the old edge, full inside.
    await setForegroundColor(page, 255, 0, 0);
    await clickMenu(page, 'Edit', 'Fill');
    expect((await getPixelAt(page, 100, 75)).a).toBe(255);
    const edge = (await getPixelAt(page, 50, 75)).a;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect((await getPixelAt(page, 30, 75)).a).toBe(0);
  });

  test('Grow… with no selection opens the dialog, and Apply closes it without a change', async ({ page }) => {
    await clickMenu(page, 'Select', 'Grow…');
    expect(await openDialogName(page)).toBe('Grow Selection');
    await page.getByRole('dialog', { name: 'Grow Selection' }).getByRole('button', { name: 'Apply' }).click();
    await settle(page);

    const s = await surfaceState(page);
    expect(await openDialogName(page)).toBeNull();
    expect(s.selection.active).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);
  });

  test('Selection → Path is disabled without a selection, and with one adds a path', async ({ page }) => {
    await clickDisabledMenuItem(page, 'Select', 'Selection → Path');
    expect((await surfaceState(page)).pathCount).toBe(0);
    expect(await historyLabels(page)).toEqual(['New Document']);

    await dragMarquee(page, 50, 40, 150, 110);
    expect(await isMenuItemDisabled(page, 'Select', 'Selection → Path')).toBe(false);
    await clickMenu(page, 'Select', 'Selection → Path');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Selection to Path']);
    expect(s.pathCount).toBe(1);
    expect(s.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(await toasts(page)).toEqual([]);
  });

  // D21 / D22: which items commit a live Move float before changing the selection.
  const floatCases: Array<{ item: 'All' | 'Inverse' | ModifyItem; commits: boolean; label: string | null; bounds: { x: number; y: number; width: number; height: number } }> = [
    // Pinned as-is: Select > All keeps the float live (no commitLiveFloat).
    { item: 'All', commits: false, label: null, bounds: { x: 0, y: 0, width: 200, height: 150 } },
    { item: 'Inverse', commits: true, label: 'Inverse Selection', bounds: { x: 0, y: 0, width: 200, height: 150 } },
    { item: 'Grow…', commits: true, label: 'Grow Selection', bounds: { x: 58, y: 38, width: 64, height: 44 } },
    { item: 'Shrink…', commits: true, label: 'Shrink Selection', bounds: { x: 62, y: 42, width: 56, height: 36 } },
    { item: 'Feather…', commits: true, label: 'Feather Selection', bounds: { x: 58, y: 38, width: 64, height: 44 } },
  ];

  for (const c of floatCases) {
    test(`D21/D22: ${c.item} after a Move drag ${c.commits ? 'commits' : 'keeps'} the live float`, async ({ page }) => {
      await fillRect(page, 20, 20, 80, 60, RED);
      const layer = (await surfaceState(page)).activeLayerId!;
      await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
      const floating = await surfaceState(page);
      expect(floating.hasFloat).toBe(true);
      expect(floating.selection.bounds).toEqual({ x: 60, y: 40, width: 60, height: 40 });

      if (c.item === 'All' || c.item === 'Inverse') await clickMenu(page, 'Select', c.item);
      else await modifySelection(page, c.item, 2);

      const s = await surfaceState(page);
      expect(s.hasFloat).toBe(!c.commits);
      expect(s.selection.bounds).toEqual(c.bounds);
      expect(s.hasTransform).toBe(true);
      expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move', ...(c.label ? [c.label] : [])]);
      // The moved block stays where the drag left it either way.
      expect(await getPixelAt(page, 100, 60, layer)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
      expect((await getPixelAt(page, 30, 30, layer)).a).toBe(0);
    });
  }
});
