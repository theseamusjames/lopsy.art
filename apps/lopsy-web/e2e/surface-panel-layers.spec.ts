/**
 * Characterization: the Layers panel toolbar buttons and row controls, as
 * they behave today.
 *
 * These specs pin what each control does (history label, toast, layers,
 * order, active and selected layers, mask edit mode, effects drawer) so the
 * move onto the command registry can be checked against them. Setups mirror
 * the Layer menu spec so the differences show. Behaviour that looks wrong is
 * pinned as-is and says so. Disagreement ids (D4, D6, D7, D8) refer to
 * docs/ui-surface-differences.md.
 */
import { test, expect, type Page } from './fixtures';
import { getPixelAt } from './helpers';
import {
  fillRect,
  floatSelection,
  historyLabels,
  openDialogName,
  openDocument,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
} from './surface-helpers';
import {
  clickLayerRow,
  focusedLabel,
  layerByName,
  layerExtras,
  maskMode,
  pressKey,
  rowButton,
} from './surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const OPAQUE_RED = { r: 255, g: 0, b: 0, a: 255 };

function toolbarButton(page: Page, name: string) {
  return page.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name, exact: true });
}

async function clickToolbar(page: Page, name: string): Promise<void> {
  await toolbarButton(page, name).click();
  await settle(page);
}

/** Commit a text layer through the UI and return its id. */
async function addTextLayer(page: Page): Promise<string> {
  await startTextEditing(page, 100, 80, 'Hi');
  await page.keyboard.press('Shift+Enter');
  await settle(page);
  const s = await surfaceState(page);
  expect(s.textEditing).toBe(false);
  return s.activeLayerId!;
}

test.describe('Layers panel (characterization)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the Layers panel needs the desktop layout');
    await openDocument(page);
  });

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  test('Add Layer adds an empty "Layer 2" above the active layer, makes it active and drops button focus', async ({ page }) => {
    await clickToolbar(page, 'Add Layer');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer']);
    expect(await toasts(page)).toEqual([]);
    expect(await openDialogName(page)).toBeNull();
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    expect(after.activeLayerName).toBe('Layer 2');
    expect(after.selectedLayerIds).toEqual([after.activeLayerId]);
    expect(layerByName(after, 'Project').children).toContain(after.activeLayerId);
    expect((await getPixelAt(page, 100, 75, after.activeLayerId!)).a).toBe(0);
    // Toolbar buttons give focus back after a mouse click.
    expect(await focusedLabel(page)).toBeNull();
  });

  test('New Group adds an empty active "Group" with no history entry', async ({ page }) => {
    const before = await surfaceState(page);

    await clickToolbar(page, 'New Group');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Group', 'Project']);
    const group = layerByName(after, 'Group');
    expect(group.type).toBe('group');
    expect(group.children).toEqual([]);
    expect(after.activeLayerId).toBe(group.id);
    expect(after.selectedLayerIds).toEqual([group.id]);
    expect(layerByName(after, 'Project').children).toEqual([...(layerByName(before, 'Project').children ?? []), group.id]);
    expect(await toasts(page)).toEqual([]);
  });

  test('D8: Group Layers appears only with two or more layers selected, and wraps them in one "Group"', async ({ page }) => {
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;
    const layer1 = before.activeLayerId!;
    await expect(toolbarButton(page, 'Group Layers')).toHaveCount(0);

    // The root group does not count towards the two.
    await clickLayerRow(page, before.rootGroupId!, ['ControlOrMeta']);
    expect((await surfaceState(page)).selectedLayerIds).toHaveLength(2);
    await expect(toolbarButton(page, 'Group Layers')).toHaveCount(0);
    await clickLayerRow(page, before.rootGroupId!, ['ControlOrMeta']);

    await clickLayerRow(page, background, ['ControlOrMeta']);
    await expect(toolbarButton(page, 'Group Layers')).toHaveCount(1);

    await clickToolbar(page, 'Group Layers');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Group Layers']);
    expect(after.activeLayerName).toBe('Group');
    const group = layerByName(after, 'Group');
    expect([...(group.children ?? [])].sort()).toEqual([background, layer1].sort());
    expect(layerByName(after, 'Project').children).toEqual([group.id]);
    await expect(toolbarButton(page, 'Group Layers')).toHaveCount(0);
  });

  test('Duplicate Layer copies the active raster layer as "<name> copy" above it', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const source = (await surfaceState(page)).activeLayerId!;

    await clickToolbar(page, 'Duplicate Layer');

    const after = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Duplicate Layer']);
    expect(await toasts(page)).toEqual([]);
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Layer 1 copy', 'Project']);
    expect(after.activeLayerName).toBe('Layer 1 copy');
    const copy = after.activeLayerId!;
    expect(copy).not.toBe(source);
    for (const id of [source, copy]) {
      expect(await getPixelAt(page, 50, 40, id)).toEqual(OPAQUE_RED);
      expect((await getPixelAt(page, 10, 10, id)).a).toBe(0);
    }
    expect(after.selection.bounds).toEqual({ x: 20, y: 20, width: 60, height: 40 });
  });

  test('D7: Duplicate Layer is disabled with the root group active, and a click does nothing', async ({ page }) => {
    const { rootGroupId } = await surfaceState(page);
    await expect(toolbarButton(page, 'Duplicate Layer')).toBeEnabled();
    await clickLayerRow(page, rootGroupId!);
    expect((await surfaceState(page)).activeLayerName).toBe('Project');

    const button = toolbarButton(page, 'Duplicate Layer');
    await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    if (!box) throw new Error('no Duplicate Layer box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page);

    const after = await surfaceState(page);
    expect(after.orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('Add Mask adds a mask to the active layer, enters mask edit mode and hides the button', async ({ page }) => {
    const layer = (await surfaceState(page)).activeLayerId!;
    expect(await maskMode(page)).toBe('off');

    await clickToolbar(page, 'Add Mask');

    expect(await historyLabels(page)).toEqual(['New Document', 'Add Mask']);
    expect((await layerExtras(page, layer)).hasMask).toBe(true);
    expect(await maskMode(page)).toBe('layerMask');
    await expect(toolbarButton(page, 'Add Mask')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit mask for Layer 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(await toasts(page)).toEqual([]);
  });

  test('Add Mask with a selection active builds the mask from it and drops the selection', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer = (await surfaceState(page)).activeLayerId!;

    await clickToolbar(page, 'Add Mask');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Add Mask']);
    expect((await layerExtras(page, layer)).hasMask).toBe(true);
    expect(s.selection.active).toBe(false);
  });

  test('Rasterize Layer shows only for a text layer and turns it into a raster layer', async ({ page }) => {
    await expect(toolbarButton(page, 'Rasterize Layer')).toHaveCount(0);
    const text = await addTextLayer(page);
    const labels = await historyLabels(page);
    await expect(toolbarButton(page, 'Rasterize Layer')).toHaveCount(1);

    await clickToolbar(page, 'Rasterize Layer');

    const s = await surfaceState(page);
    expect(await historyLabels(page)).toEqual([...labels, 'Rasterize Layer']);
    expect(s.activeLayerId).toBe(text);
    expect(s.layers.find((l) => l.id === text)?.type).toBe('raster');
    await expect(toolbarButton(page, 'Rasterize Layer')).toHaveCount(0);
  });

  test('D4: Delete Layer removes EVERY selected layer, as "Delete Layers"', async ({ page }) => {
    await clickToolbar(page, 'Add Layer');
    const before = await surfaceState(page);
    const layer1 = layerByName(before, 'Layer 1').id;
    await clickLayerRow(page, layer1, ['ControlOrMeta']);
    expect((await surfaceState(page)).selectedLayerIds).toHaveLength(2);

    await clickToolbar(page, 'Delete Layer');

    const s = await surfaceState(page);
    expect(s.orderNames).toEqual(['Background', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer', 'Delete Layers']);
    expect(await toasts(page)).toEqual([]);
  });

  test('D4: Delete Layer is disabled when only the root group is selected', async ({ page }) => {
    const { rootGroupId } = await surfaceState(page);
    await clickLayerRow(page, rootGroupId!);
    await expect(toolbarButton(page, 'Delete Layer')).toBeDisabled();
    await clickLayerRow(page, layerByName(await surfaceState(page), 'Layer 1').id);
    await expect(toolbarButton(page, 'Delete Layer')).toBeEnabled();
  });

  test('D4: Delete Layer in mask edit mode still deletes the layer (the key fills the mask)', async ({ page }) => {
    await clickToolbar(page, 'Add Mask');
    expect(await maskMode(page)).toBe('layerMask');

    await clickToolbar(page, 'Delete Layer');

    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Project']);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Mask', 'Delete Layers']);
  });

  // ---------------------------------------------------------------------------
  // Row selection
  // ---------------------------------------------------------------------------

  test('row click activates and selects that layer only and leaves mask edit mode', async ({ page }) => {
    await clickToolbar(page, 'Add Mask');
    expect(await maskMode(page)).toBe('layerMask');
    const background = layerByName(await surfaceState(page), 'Background').id;

    await clickLayerRow(page, background);

    const s = await surfaceState(page);
    expect(s.activeLayerId).toBe(background);
    expect(s.selectedLayerIds).toEqual([background]);
    expect(await maskMode(page)).toBe('off');
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Mask']);
  });

  test('Cmd-click toggles a layer in the selection without changing the active layer', async ({ page }) => {
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;

    await clickLayerRow(page, background, ['ControlOrMeta']);
    let s = await surfaceState(page);
    expect(s.activeLayerId).toBe(before.activeLayerId);
    expect([...s.selectedLayerIds].sort()).toEqual([background, before.activeLayerId!].sort());

    await clickLayerRow(page, background, ['ControlOrMeta']);
    s = await surfaceState(page);
    expect(s.selectedLayerIds).toEqual([before.activeLayerId]);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('Shift-click selects the range from the active layer', async ({ page }) => {
    await clickToolbar(page, 'Add Layer');
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;
    const layer1 = layerByName(before, 'Layer 1').id;

    await clickLayerRow(page, background, ['Shift']);

    const s = await surfaceState(page);
    expect(s.activeLayerId).toBe(before.activeLayerId);
    expect([...s.selectedLayerIds].sort()).toEqual([background, layer1, before.activeLayerId!].sort());
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Layer']);
  });

  test('D6: a row click commits a pending Move float before switching layers', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    const layer1 = (await surfaceState(page)).activeLayerId!;
    await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
    const floating = await surfaceState(page);
    expect(floating.hasFloat).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);

    await clickLayerRow(page, floating.rootGroupId!);

    const after = await surfaceState(page);
    expect(after.activeLayerId).toBe(after.rootGroupId);
    // Unlike Layer > Adjustment Layer…, the float is committed.
    expect(after.hasFloat).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Move']);
    expect(await getPixelAt(page, 100, 60, layer1)).toEqual(OPAQUE_RED);
    expect((await getPixelAt(page, 30, 30, layer1)).a).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Row buttons
  // ---------------------------------------------------------------------------

  test('Hide layer / Show layer toggle visibility with "Toggle Visibility" entries', async ({ page }) => {
    const layer = (await surfaceState(page)).activeLayerId!;

    await rowButton(page, layer, 'Hide layer').click();
    await settle(page);
    expect(layerByName(await surfaceState(page), 'Layer 1').visible).toBe(false);
    await expect(rowButton(page, layer, 'Show layer')).toHaveCount(1);

    await rowButton(page, layer, 'Show layer').click();
    await settle(page);
    expect(layerByName(await surfaceState(page), 'Layer 1').visible).toBe(true);
    expect(await historyLabels(page)).toEqual(['New Document', 'Toggle Visibility', 'Toggle Visibility']);
    // Row buttons are outside the toolbar and keep focus after a click.
    expect(await focusedLabel(page)).toBe('Hide layer');
  });

  test('the root group row has no visibility or opacity button', async ({ page }) => {
    const { rootGroupId } = await surfaceState(page);
    await expect(rowButton(page, rootGroupId!, 'Hide layer')).toHaveCount(0);
    await expect(page.locator(`[data-layer-id="${rootGroupId}"]`).getByRole('button', { name: /^Opacity / })).toHaveCount(0);
  });

  test('Lock layer / Unlock layer push "Lock Layer" and "Unlock Layer" without changing the active layer', async ({ page }) => {
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;

    await rowButton(page, background, 'Lock layer').click();
    await settle(page);
    expect((await layerExtras(page, background)).locked).toBe(true);
    expect((await surfaceState(page)).activeLayerId).toBe(before.activeLayerId);

    await rowButton(page, background, 'Unlock layer').click();
    await settle(page);
    expect((await layerExtras(page, background)).locked).toBe(false);
    expect(await historyLabels(page)).toEqual(['New Document', 'Lock Layer', 'Unlock Layer']);
  });

  test('D6: the mask thumbnail activates its layer and enters mask edit mode', async ({ page }) => {
    await clickToolbar(page, 'Add Mask');
    const layer1 = (await surfaceState(page)).activeLayerId!;
    const background = layerByName(await surfaceState(page), 'Background').id;
    await clickLayerRow(page, background);
    expect(await maskMode(page)).toBe('off');

    await page.getByRole('button', { name: 'Edit mask for Layer 1' }).click();
    await settle(page);

    expect((await surfaceState(page)).activeLayerId).toBe(layer1);
    expect(await maskMode(page)).toBe('layerMask');
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Mask']);
  });

  test('D6: the effects button activates its layer and opens the drawer; mask edit mode survives only on the same layer', async ({ page }) => {
    await clickToolbar(page, 'Add Mask');
    expect(await maskMode(page)).toBe('layerMask');
    const before = await surfaceState(page);
    const background = layerByName(before, 'Background').id;

    // On the active (masked) layer: the drawer opens and mask edit mode stays on.
    await page.getByRole('button', { name: 'Layer effects for Layer 1' }).click();
    await settle(page);
    let s = await surfaceState(page);
    expect(s.activeLayerId).toBe(before.activeLayerId);
    expect(s.showEffectsDrawer).toBe(true);
    expect(await maskMode(page)).toBe('layerMask');

    // On another, unmasked layer: mask edit mode is off. The effects handler
    // leaves it alone; mask-mode-sync drops it because Background has no mask.
    await page.getByRole('button', { name: 'Layer effects for Background' }).click();
    await settle(page);
    s = await surfaceState(page);
    expect(s.activeLayerId).toBe(background);
    expect(s.showEffectsDrawer).toBe(true);
    expect(await maskMode(page)).toBe('off');

    // A second click on the active layer's button closes the drawer.
    await page.getByRole('button', { name: 'Layer effects for Background' }).click();
    await settle(page);
    s = await surfaceState(page);
    expect(s.showEffectsDrawer).toBe(false);
    expect(s.activeLayerId).toBe(background);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Mask']);
  });

  test('Delete mask removes the mask with "Remove Mask" and leaves mask edit mode', async ({ page }) => {
    await clickToolbar(page, 'Add Mask');
    const layer = (await surfaceState(page)).activeLayerId!;

    await page.getByRole('button', { name: 'Delete mask' }).click();
    await settle(page);

    expect((await layerExtras(page, layer)).hasMask).toBe(false);
    expect(await maskMode(page)).toBe('off');
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Mask', 'Remove Mask']);
    await expect(toolbarButton(page, 'Add Mask')).toHaveCount(1);
  });

  test('Rename: double-click, type and Enter pushes "Rename Layer"; Escape cancels', async ({ page }) => {
    const layer = (await surfaceState(page)).activeLayerId!;
    const name = page.locator(`[data-layer-id="${layer}"]`).getByText('Layer 1', { exact: true });

    await name.dblclick();
    const input = page.locator('input[aria-label="Layer name"]');
    await expect(input).toBeFocused();
    await input.fill('Sky');
    await input.press('Enter');
    await settle(page);
    expect((await surfaceState(page)).activeLayerName).toBe('Sky');
    expect(await historyLabels(page)).toEqual(['New Document', 'Rename Layer']);

    await page.locator(`[data-layer-id="${layer}"]`).getByText('Sky', { exact: true }).dblclick();
    await expect(input).toBeFocused();
    await input.fill('Ground');
    await input.press('Escape');
    await settle(page);
    const s = await surfaceState(page);
    expect(s.activeLayerName).toBe('Sky');
    // Escape in the rename field does not reach the global Escape.
    expect(await historyLabels(page)).toEqual(['New Document', 'Rename Layer']);
  });

  test('Opacity: the slider steps with arrow keys as one "Change Opacity" entry and does not nudge the layer', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');
    await pressKey(page, 'v');
    const layer = (await surfaceState(page)).activeLayerId!;

    await page.getByRole('button', { name: 'Opacity 100% for Layer 1' }).click();
    const slider = page.locator('input[aria-label="Layer 1 opacity"]');
    await expect(slider).toBeVisible();
    await slider.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await settle(page);

    expect((await layerExtras(page, layer)).opacity).toBeCloseTo(0.97, 5);
    await expect(page.getByRole('button', { name: 'Opacity 97% for Layer 1' })).toHaveCount(1);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Change Opacity']);
    // The Move tool's arrow nudge stood down for the focused range input.
    expect(await getPixelAt(page, 20, 30, layer)).toEqual(OPAQUE_RED);
  });

  test('a Cmd-click on the layer thumbnail selects the layer alpha with no history entry', async ({ page }) => {
    await fillRect(page, 20, 20, 80, 60, RED);
    await pressKey(page, 'ControlOrMeta+d');
    const layer = (await surfaceState(page)).activeLayerId!;
    const background = layerByName(await surfaceState(page), 'Background').id;
    await clickLayerRow(page, background);

    await page.locator(`[data-layer-id="${layer}"] [class*="thumbnail"]`).first().click({ modifiers: ['ControlOrMeta'] });

    await expect.poll(async () => (await surfaceState(page)).selection.bounds).toEqual({ x: 20, y: 20, width: 60, height: 40 });
    const s = await surfaceState(page);
    // The thumbnail click does not activate the layer.
    expect(s.activeLayerId).toBe(background);
    expect(s.selectedLayerIds).toEqual([background]);
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill']);
  });
});
