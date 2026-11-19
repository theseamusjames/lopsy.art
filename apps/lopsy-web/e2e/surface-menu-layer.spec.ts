/**
 * Characterization: the Layer menu, item by item, as it behaves today.
 *
 * These specs pin what each item does (history label, toast, dialog,
 * resulting document) so the move onto the command registry can be checked
 * against them. Behaviour that looks wrong is pinned as-is and says so.
 * Disagreement ids (D6, D7, D8, D9) refer to the surface inventory.
 */
import { test, expect, type Page } from './fixtures';
import { getPixelAt } from './helpers';
import {
  clickDisabledMenuItem,
  clickMenu,
  fillRect,
  floatSelection,
  historyLabels,
  isMenuItemDisabled,
  openDialogName,
  openDocument,
  settle,
  surfaceState,
  toasts,
  topHistoryLabel,
  type SurfaceState,
} from './surface-helpers';

const RED = { r: 255, g: 0, b: 0 };

function layerByName(s: SurfaceState, name: string): SurfaceState['layers'][number] {
  const layer = s.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer named ${name}: ${s.layers.map((l) => l.name).join(', ')}`);
  return layer;
}

async function clickLayerRow(page: Page, layerId: string, modifiers?: Array<'ControlOrMeta'>): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"]`).click({ modifiers });
  await settle(page);
}

test.describe('Layer menu (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
    await openDocument(page);
  });

  test('New Layer adds an empty "Layer 2" above the active layer and makes it active', async ({ page }) => {
    const before = await surfaceState(page);
    expect(before.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(before.activeLayerName).toBe('Layer 1');

    await clickMenu(page, 'Layer', 'New Layer');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    expect(after.activeLayerName).toBe('Layer 2');
    expect(after.selectedLayerIds).toEqual([after.activeLayerId]);
    const root = layerByName(after, 'Project');
    expect(root.children).toContain(after.activeLayerId);
    expect((await getPixelAt(page, 100, 75, after.activeLayerId!)).a).toBe(0);
  });

  test('Duplicate Layer copies the active raster layer as "<name> copy" above it', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const source = (await surfaceState(page)).activeLayerId!;

    await clickMenu(page, 'Layer', 'Duplicate Layer');

    const after = await surfaceState(page);
    expect(await topHistoryLabel(page)).toBe('Duplicate Layer');
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Duplicate Layer']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Layer 1 copy', 'Project']);
    expect(after.activeLayerName).toBe('Layer 1 copy');
    const copy = after.activeLayerId!;
    expect(copy).not.toBe(source);
    for (const id of [source, copy]) {
      expect(await getPixelAt(page, 50, 40, id)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
      expect((await getPixelAt(page, 10, 10, id)).a).toBe(0);
      expect((await getPixelAt(page, 85, 40, id)).a).toBe(0);
    }
    // The marquee from the fill is untouched.
    expect(after.selection.bounds).toEqual({ x: 20, y: 20, width: 60, height: 40 });
  });

  test('D7: Duplicate Layer with the root group active duplicates the whole project as a sibling group', async ({ page }) => {
    const { rootGroupId } = await surfaceState(page);
    await clickLayerRow(page, rootGroupId!);
    expect((await surfaceState(page)).activeLayerName).toBe('Project');
    // The panel button refuses the root; the menu item does not (D7).
    await expect(page.locator('[aria-label="Duplicate Layer"]')).toBeDisabled();
    expect(await isMenuItemDisabled(page, 'Layer', 'Duplicate Layer')).toBe(false);

    await clickMenu(page, 'Layer', 'Duplicate Layer');

    // Pinned as-is: a second top-level "Project copy" group appears outside
    // the root, holding copies of every layer.
    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Duplicate Layer']);
    expect(await toasts(page)).toEqual([]);
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Project', 'Background copy', 'Layer 1 copy', 'Project copy']);
    expect(after.activeLayerName).toBe('Project copy');
    expect(after.rootGroupId).toBe(rootGroupId);
    const root = layerByName(after, 'Project');
    const copy = layerByName(after, 'Project copy');
    expect(copy.type).toBe('group');
    expect(root.children).toHaveLength(2);
    expect(root.children).not.toContain(copy.id);
    expect(copy.children).toEqual([layerByName(after, 'Background copy').id, layerByName(after, 'Layer 1 copy').id]);
    // The copied background is white like the original.
    expect(await getPixelAt(page, 100, 75, layerByName(after, 'Background copy').id)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  test('D8: Group Layers with one layer selected wraps that layer in a new "Group"', async ({ page }) => {
    const before = await surfaceState(page);
    const layer1 = before.activeLayerId!;
    expect(before.selectedLayerIds).toEqual([layer1]);
    // The panel only offers Group Layers for 2+ selected layers (D8).
    await expect(page.locator('[aria-label="Group Layers"]')).toHaveCount(0);

    await clickMenu(page, 'Layer', 'Group Layers');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Group Layers']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Group', 'Project']);
    expect(after.activeLayerName).toBe('Group');
    const group = layerByName(after, 'Group');
    expect(group.type).toBe('group');
    expect(group.children).toEqual([layer1]);
    const root = layerByName(after, 'Project');
    expect(root.children).toContain(group.id);
    expect(root.children).not.toContain(layer1);
  });

  test('Group Layers with two layers selected wraps both in one "Group"', async ({ page }) => {
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;
    const layer1 = before.activeLayerId!;
    await clickLayerRow(page, background, ['ControlOrMeta']);
    expect([...(await surfaceState(page)).selectedLayerIds].sort()).toEqual([background, layer1].sort());

    await clickMenu(page, 'Layer', 'Group Layers');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Group Layers']);
    expect(after.activeLayerName).toBe('Group');
    const group = layerByName(after, 'Group');
    expect([...(group.children ?? [])].sort()).toEqual([background, layer1].sort());
    expect(layerByName(after, 'Project').children).toEqual([group.id]);
  });

  test('Adjustment Layer… activates the root group, opens the effects drawer and the info dialog', async ({ page }) => {
    const before = await surfaceState(page);

    await clickMenu(page, 'Layer', 'Adjustment Layer…');

    const after = await surfaceState(page);
    expect(await openDialogName(page)).toBe('Adjustment layers');
    expect(after.modalKind).toBe('adjustmentLayerInfo');
    expect(after.activeLayerId).toBe(before.rootGroupId);
    expect(after.showEffectsDrawer).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await toasts(page)).toEqual([]);

    // The dialog's only action, "Got it", closes it and leaves the drawer on the root group.
    await page.getByRole('dialog', { name: 'Adjustment layers' }).getByRole('button', { name: 'Got it' }).click();
    await settle(page);
    const closed = await surfaceState(page);
    expect(await openDialogName(page)).toBeNull();
    expect(closed.modalKind).toBeNull();
    expect(closed.showEffectsDrawer).toBe(true);
    expect(closed.activeLayerId).toBe(before.rootGroupId);
    await expect(page.locator('[aria-label="Add Adjustment"]')).toBeVisible();
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('D6: Adjustment Layer… switches the active layer without committing a pending Move float', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer1 = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    const floating = await surfaceState(page);
    expect(floating.hasFloat).toBe(true);
    expect(floating.selection.bounds).toEqual({ x: 60, y: 40, width: 60, height: 40 });
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);

    await clickMenu(page, 'Layer', 'Adjustment Layer…');

    const after = await surfaceState(page);
    expect(after.activeLayerId).toBe(after.rootGroupId);
    expect(after.hasFloat).toBe(true);
    expect(after.hasTransform).toBe(true);
    expect(after.selection.bounds).toEqual({ x: 60, y: 40, width: 60, height: 40 });
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await openDialogName(page)).toBe('Adjustment layers');
    // The moved block is on Layer 1 at x 60-120.
    expect(await getPixelAt(page, 100, 60, layer1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect((await getPixelAt(page, 30, 30, layer1)).a).toBe(0);
  });

  test('Merge Down merges the active layer into the raster layer below', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    expect(await isMenuItemDisabled(page, 'Layer', 'Merge Down')).toBe(false);
    const background = layerByName(await surfaceState(page), 'Background').id;

    await clickMenu(page, 'Layer', 'Merge Down');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Merge Down']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
    expect(after.orderNames).toEqual(['Background', 'Project']);
    expect(after.activeLayerId).toBe(background);
    expect(await getPixelAt(page, 50, 40, background)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(await getPixelAt(page, 10, 10, background)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  test('D9: Merge Down is aria-disabled for the bottom layer and the root group, and a click does nothing', async ({ page }) => {
    const start = await surfaceState(page);
    for (const id of [layerByName(start, 'Background').id, start.rootGroupId!]) {
      await clickLayerRow(page, id);
      const before = await surfaceState(page);
      expect(before.activeLayerId).toBe(id);
      await clickDisabledMenuItem(page, 'Layer', 'Merge Down');
      const after = await surfaceState(page);
      expect(after.orderNames).toEqual(before.orderNames);
      expect(after.activeLayerId).toBe(id);
      expect(await historyLabels(page)).toEqual(['New Document']);
      expect(await toasts(page)).toEqual([]);
    }
  });

  test('Flatten Image composites every layer into one "Background"', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);

    await clickMenu(page, 'Layer', 'Flatten Image');
    await expect.poll(() => topHistoryLabel(page)).toBe('Flatten Image');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Flatten Image']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
    expect(after.orderNames).toEqual(['Background', 'Project']);
    expect(after.activeLayerName).toBe('Background');
    const flat = after.activeLayerId!;
    expect(await getPixelAt(page, 50, 40, flat)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(await getPixelAt(page, 10, 10, flat)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
});
