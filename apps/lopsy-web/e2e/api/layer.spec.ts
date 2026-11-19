/**
 * The `layer` commands (src/commands/layer/layer.ts): each against the
 * Layers panel control or Layer menu item it stands for, then on its own for
 * the cases the UI never reaches and for every refusal.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { setBlendMode } from '../helpers';
import { clickMenu, fillRect, historyLabels, settle, topHistoryLabel } from '../surface-helpers';
import { clickLayerRow, pressKey, rowButton } from '../surface-helpers-keys';
import { docPixel } from '../surface-helpers-filters';

interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  parent: string | null;
  isActive: boolean;
  isSelected: boolean;
}

interface DocumentInfo {
  layers: LayerInfo[];
  history: { undo: string[]; redo: string[] };
}

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const OPAQUE_RED = { r: 255, g: 0, b: 0, a: 255 };
const OPAQUE_BLUE = { r: 0, g: 0, b: 255, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

async function info(page: Page): Promise<DocumentInfo> {
  return run<DocumentInfo>(page, { op: 'doc.info' });
}

async function idOf(page: Page, name: string): Promise<string> {
  const layer = (await info(page)).layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer named ${name}`);
  return layer.id;
}

async function names(page: Page): Promise<string[]> {
  return (await info(page)).layers.map((l) => l.name);
}

function toolbarButton(page: Page, name: string) {
  return page.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name, exact: true });
}

async function clickToolbar(page: Page, name: string): Promise<void> {
  await toolbarButton(page, name).click();
  await settle(page);
}

/** A red block on Layer 1 at (20,20)-(80,60), with the marquee dropped. */
async function paintLayer1(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 80, 60, RED);
  await pressKey(page, 'ControlOrMeta+d');
}

/** paintLayer1, then Add Layer and a blue block on "Layer 2" at (60,40)-(140,100), active. */
async function paintTwoLayers(page: Page): Promise<void> {
  await paintLayer1(page);
  await clickToolbar(page, 'Add Layer');
  await fillRect(page, 60, 40, 140, 100, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
}

async function cmdClickRow(page: Page, name: string): Promise<void> {
  await clickLayerRow(page, await idOf(page, name), ['ControlOrMeta']);
}

/** Press the row grip of `dragged` and release it at `fraction` of the height of the `target` row. */
async function dragRow(page: Page, dragged: string, target: string, fraction: number): Promise<void> {
  const grip = page.locator(`[data-layer-id="${dragged}"] [aria-label^="Drag to reorder"]`);
  const gripBox = await grip.boundingBox();
  const targetBox = await page.locator(`[data-layer-id="${target}"]`).boundingBox();
  if (!gripBox || !targetBox) throw new Error('layer rows are not on screen');
  const x = gripBox.x + gripBox.width / 2;
  await page.mouse.move(x, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, targetBox.y + targetBox.height * fraction, { steps: 8 });
  await settle(page, 100);
  await page.mouse.up();
  await settle(page, 200);
}

test.describe('the Layers panel toolbar and the layer commands', () => {
  test('layer.add matches Add Layer, and returns the id doc.info reports', async ({ page }) => {
    let created = '';
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: (p) => clickToolbar(p, 'Add Layer'),
      viaApi: async (p) => {
        created = (await run<{ id: string }>(p, { op: 'layer.add' })).id;
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    expect(api.history.undo.at(-1)).toBe('Add Layer');
    expect(await idOf(page, 'Layer 2')).toBe(created);
  });

  test('layer.add with a name matches Add Layer followed by a rename in the panel', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: async (p) => {
        await clickToolbar(p, 'Add Layer');
        await p.locator(`[data-layer-id="${await idOf(p, 'Layer 2')}"]`).getByText('Layer 2', { exact: true }).dblclick();
        const input = p.locator('input[aria-label="Layer name"]');
        await input.fill('Sky');
        await input.press('Enter');
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.add', name: 'Sky' });
      },
    });
    expect(api.history.undo.slice(-2)).toEqual(['Add Layer', 'Rename Layer']);
  });

  test('layer.add-group matches New Group: an empty active group with no history step', async ({ page }) => {
    let created = '';
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: (p) => clickToolbar(p, 'New Group'),
      viaApi: async (p) => {
        created = (await run<{ id: string }>(p, { op: 'layer.add-group' })).id;
      },
    });
    expect(api.layers.map((l) => [l.name, l.type])).toContainEqual(['Group', 'group']);
    expect(api.history.undo).toEqual(['New Document', 'Fill']);
    expect(await idOf(page, 'Group')).toBe(created);
  });

  test('layer.remove matches the Delete key on the active layer ("Delete Layer")', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: (p) => pressKey(p, 'Delete'),
      viaApi: async (p) => {
        await run(p, { op: 'layer.remove' });
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Project']);
    expect(api.history.undo.at(-1)).toBe('Delete Layer');
  });

  test('layer.remove-selected matches Delete Layer with two layers selected ("Delete Layers")', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintTwoLayers(p);
        await cmdClickRow(p, 'Layer 1');
      },
      viaUi: (p) => clickToolbar(p, 'Delete Layer'),
      viaApi: async (p) => {
        await run(p, { op: 'layer.remove-selected' });
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Project']);
    expect(api.history.undo.at(-1)).toBe('Delete Layers');
  });

  test('layer.duplicate matches Duplicate Layer, and returns the copy\'s id', async ({ page }) => {
    let created = '';
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: (p) => clickToolbar(p, 'Duplicate Layer'),
      viaApi: async (p) => {
        created = (await run<{ id: string }>(p, { op: 'layer.duplicate' })).id;
      },
    });
    const source = api.layers.find((l) => l.name === 'Layer 1')!;
    const copy = api.layers.find((l) => l.name === 'Layer 1 copy')!;
    expect(copy.pixels).toBe(source.pixels);
    expect(api.history.undo.at(-1)).toBe('Duplicate Layer');
    expect(await idOf(page, 'Layer 1 copy')).toBe(created);
  });
});

test.describe('layer rows and layer.select / layer.set', () => {
  const clicks = [
    { mode: 'replace', modifiers: undefined },
    { mode: 'toggle', modifiers: ['ControlOrMeta'] as Array<'ControlOrMeta'> },
    { mode: 'range', modifiers: ['Shift'] as Array<'Shift'> },
  ] as const;
  for (const { mode, modifiers } of clicks) {
    test(`layer.select ${mode} matches a ${modifiers ? `${modifiers[0]}-` : 'plain '}click on the Background row`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: paintTwoLayers,
        viaUi: async (p) => clickLayerRow(p, await idOf(p, 'Background'), modifiers ? [...modifiers] : undefined),
        viaApi: async (p) => {
          await run(p, { op: 'layer.select', layer: 'Background', mode });
        },
      });
      const expected = { replace: [0], toggle: [0, 2], range: [0, 1, 2] }[mode];
      expect(api.selectedLayers).toEqual(expected);
      expect(api.activeLayer).toBe(mode === 'replace' ? 0 : 2);
    });
  }

  test('layer.set name matches a rename in the panel', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: async (p) => {
        await p.locator(`[data-layer-id="${await idOf(p, 'Layer 1')}"]`).getByText('Layer 1', { exact: true }).dblclick();
        const input = p.locator('input[aria-label="Layer name"]');
        await input.fill('  Sky  ');
        await input.press('Enter');
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.set', name: '  Sky  ' });
      },
    });
    expect(api.layers[1]!.name).toBe('Sky');
    expect(api.history.undo.at(-1)).toBe('Rename Layer');
  });

  test('layer.set visible and locked match the Hide layer and Lock layer buttons', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: async (p) => {
        const background = await idOf(p, 'Background');
        await rowButton(p, background, 'Hide layer').click();
        await rowButton(p, background, 'Lock layer').click();
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.set', layer: 'Background', visible: false, locked: true });
      },
    });
    expect(api.layers[0]).toMatchObject({ visible: false, locked: true });
    expect(api.history.undo.slice(-2)).toEqual(['Toggle Visibility', 'Lock Layer']);
  });

  test('layer.set opacity matches three ArrowLeft steps on the panel\'s opacity slider (one "Change Opacity")', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: async (p) => {
        await p.getByRole('button', { name: 'Opacity 100% for Layer 1' }).click();
        const slider = p.locator('input[aria-label="Layer 1 opacity"]');
        await expect(slider).toBeVisible();
        await slider.focus();
        for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowLeft');
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.set', opacity: 97 });
      },
    });
    expect(api.layers[1]!.opacity).toBeCloseTo(0.97, 5);
    expect(api.history.undo.at(-1)).toBe('Change Opacity');
  });

  test('layer.set blendMode matches the Blend menu in the effects drawer', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: async (p) => {
        await setBlendMode(p, 'multiply');
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.set', blendMode: 'multiply' });
      },
    });
    expect(api.layers[2]!.blendMode).toBe('multiply');
    expect(api.history.undo.at(-1)).toBe('Change Blend Mode');
  });

  test('layer.reorder matches a drag of the Layer 2 row onto the top of the Background row', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: async (p) => dragRow(p, await idOf(p, 'Layer 2'), await idOf(p, 'Background'), 0.2),
      viaApi: async (p) => {
        await run(p, { op: 'layer.reorder', layer: 'Layer 2', target: 'Background', position: 'above' });
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 2', 'Layer 1', 'Project']);
    expect(api.history.undo.at(-1)).toBe('Reorder Layer');
  });
});

test.describe('the Layer menu and the layer commands', () => {
  test('layer.merge-down matches Layer > Merge Down', async ({ page }) => {
    let merged = '';
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: (p) => clickMenu(p, 'Layer', 'Merge Down'),
      viaApi: async (p) => {
        merged = (await run<{ id: string }>(p, { op: 'layer.merge-down' })).id;
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Project']);
    expect(api.history.undo.at(-1)).toBe('Merge Down');
    expect(await idOf(page, 'Layer 1')).toBe(merged);
    expect(await docPixel(page, 100, 80, merged)).toEqual(OPAQUE_BLUE);
    expect(await docPixel(page, 30, 30, merged)).toEqual(OPAQUE_RED);
  });

  test('layer.flatten matches Layer > Flatten Image, and resolves after it has finished', async ({ page }) => {
    let flat = '';
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: async (p) => {
        await clickMenu(p, 'Layer', 'Flatten Image');
        await expect.poll(() => topHistoryLabel(p)).toBe('Flatten Image');
      },
      viaApi: async (p) => {
        flat = (await run<{ id: string }>(p, { op: 'layer.flatten' })).id;
        expect(await topHistoryLabel(p)).toBe('Flatten Image');
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Project']);
    expect(await idOf(page, 'Background')).toBe(flat);
    expect(await docPixel(page, 30, 30, flat)).toEqual(OPAQUE_RED);
    expect(await docPixel(page, 100, 80, flat)).toEqual(OPAQUE_BLUE);
    expect(await docPixel(page, 5, 5, flat)).toEqual(WHITE);
  });

  test('layer.group with two layers matches Layer > Group Layers with both selected', async ({ page }) => {
    let group = '';
    const { api } = await compareUiAndApi(page, {
      setup: paintTwoLayers,
      viaUi: async (p) => {
        await cmdClickRow(p, 'Layer 1');
        await clickMenu(p, 'Layer', 'Group Layers');
      },
      viaApi: async (p) => {
        group = (await run<{ id: string }>(p, { op: 'layer.group', layers: ['Layer 1', 'Layer 2'] })).id;
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Layer 2', 'Group', 'Project']);
    expect(api.layers[1]!.parent).toBe(3);
    expect(api.layers[2]!.parent).toBe(3);
    expect(await idOf(page, 'Group')).toBe(group);
  });

  test('layer.group with one layer matches Layer > Group Layers, which wraps it', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: (p) => clickMenu(p, 'Layer', 'Group Layers'),
      viaApi: async (p) => {
        await run(p, { op: 'layer.group' });
      },
    });
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Group', 'Project']);
    expect(api.layers[1]!.parent).toBe(2);
    expect(api.history.undo.at(-1)).toBe('Group Layers');
  });
});

test.describe('layer commands on their own', () => {
  test.beforeEach(async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await paintLayer1(page);
  });

  test('layer.add inside a group lands in it, and layer.add-group takes a name', async ({ page }) => {
    const group = (await run<{ id: string }>(page, { op: 'layer.add-group', name: 'Trees' })).id;
    const layer = (await run<{ id: string }>(page, { op: 'layer.add', name: 'Oak' })).id;
    const doc = await info(page);
    expect(doc.layers.find((l) => l.id === layer)).toMatchObject({ name: 'Oak', parent: group, isActive: true });
    expect(doc.layers.find((l) => l.id === group)).toMatchObject({ name: 'Trees', type: 'group' });
    expect(doc.history.undo).toEqual(['New Document', 'Fill', 'Add Layer', 'Rename Layer']);
  });

  test('layer.remove removes a named layer that is not active, with its pixels', async ({ page }) => {
    const layer1 = await idOf(page, 'Layer 1');
    await run(page, { op: 'layer.select', layer: 'Background' });
    const result = await run<{ removed: string[]; activeLayer: string }>(page, { op: 'layer.remove', layer: 'Layer 1' });
    expect(result).toEqual({ removed: [layer1], activeLayer: await idOf(page, 'Background') });
    expect(await names(page)).toEqual(['Background', 'Project']);
  });

  test('layer.set hides, locks, fades and blends, one history step each, and undo restores each', async ({ page }) => {
    const result = await run<LayerInfo>(page, { op: 'layer.set', visible: false, locked: true, opacity: 25, blendMode: 'screen' });
    expect(result).toMatchObject({ visible: false, locked: true, opacity: 25, blendMode: 'screen' });
    expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Toggle Visibility', 'Lock Layer', 'Change Opacity', 'Change Blend Mode']);
    await expect(page.getByRole('button', { name: 'Opacity 25% for Layer 1' })).toHaveCount(1);
    await run(page, { op: 'history.undo', steps: 4 });
    expect((await info(page)).layers[1]).toMatchObject({ visible: true, locked: false, opacity: 100, blendMode: 'normal' });
  });

  test('layer.duplicate of another layer makes it active first, then the copy', async ({ page }) => {
    const copy = (await run<{ id: string }>(page, { op: 'layer.duplicate', layer: 'Background' })).id;
    expect(await names(page)).toEqual(['Background', 'Background copy', 'Layer 1', 'Project']);
    expect((await info(page)).layers.find((l) => l.isActive)!.id).toBe(copy);
    expect(await docPixel(page, 5, 5, copy)).toEqual(WHITE);
  });

  test('layer.merge-down of a named layer merges it, and layer.reorder inside a group nests it', async ({ page }) => {
    const group = (await run<{ id: string }>(page, { op: 'layer.add-group' })).id;
    const result = await run<{ parent: string }>(page, { op: 'layer.reorder', layer: 'Layer 1', target: 'Group', position: 'inside' });
    expect(result).toEqual({ parent: group });
    expect((await info(page)).layers.find((l) => l.name === 'Layer 1')!.parent).toBe(group);
    await run(page, { op: 'layer.reorder', layer: 'Layer 1', target: 'Background', position: 'above' });
    const background = await idOf(page, 'Background');
    expect(await docPixel(page, 30, 30, background)).toEqual(WHITE);
    expect((await run<{ id: string }>(page, { op: 'layer.merge-down', layer: 'Layer 1' })).id).toBe(background);
    expect(await names(page)).toEqual(['Background', 'Group', 'Project']);
    expect(await docPixel(page, 30, 30, background)).toEqual(OPAQUE_RED);
  });
});

test.describe('layer command refusals', () => {
  test.beforeEach(async ({ page }) => {
    await run(page, { op: 'doc.new', width: 120, height: 90 });
  });

  test('each refusal is a refused CommandError that leaves the document unchanged', async ({ page }) => {
    await run(page, { op: 'layer.add-group', name: 'G' });
    await run(page, { op: 'layer.reorder', layer: 'Layer 1', target: 'G', position: 'inside' });
    await run(page, { op: 'layer.select', layer: 'Background' });
    const before = await info(page);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ op: 'layer.remove', layer: 'Project' }, 'The root group cannot be deleted.'],
      [{ op: 'layer.select', layer: 'Background', mode: 'toggle' }, 'The active layer always stays selected: make another layer active first.'],
      [{ op: 'layer.set', layer: 'Project', opacity: 50 }, 'The root group has no opacity of its own to change.'],
      [{ op: 'layer.set', blendMode: 'pass-through' }, 'pass-through is only for groups.'],
      [{ op: 'layer.duplicate', layer: 'Project' }, 'The root group cannot be duplicated: the Duplicate Layer button is disabled while it is active.'],
      [{ op: 'layer.merge-down' }, 'There is no layer below the active layer to merge into.'],
      [{ op: 'layer.merge-down', layer: 'G' }, 'The active layer is a group, and the layer below it is inside it: Merge Down merges a layer into its sibling below.'],
      [{ op: 'layer.merge-down', layer: 'Layer 1' }, 'The layer below the active layer is in a different group: Merge Down merges a layer into its sibling below.'],
      [{ op: 'layer.reorder', layer: 'Project', target: 'G', position: 'below' }, 'The root group cannot be moved.'],
      [{ op: 'layer.reorder', layer: 'G', target: 'G', position: 'inside' }, 'A layer cannot be placed relative to itself.'],
      [{ op: 'layer.reorder', layer: 'G', target: 'Layer 1', position: 'above' }, '"Layer 1" is inside "G": a group cannot be moved into itself.'],
      [{ op: 'layer.reorder', layer: 'G', target: 'Background', position: 'inside' }, '"Background" is not a group: only a group can take a layer inside it.'],
      [{ op: 'layer.reorder', layer: 'G', target: 'Project', position: 'below' }, 'Nothing can be placed above or below the root group: use position "inside" for the top of the document.'],
      [{ op: 'layer.reorder', layer: 'Layer 1', target: 'G', position: 'inside' }, '"Layer 1" is already inside "G".'],
    ];
    for (const [invocation, message] of cases) {
      const error = await runError(page, invocation as { op: string });
      expect(error, JSON.stringify(invocation)).toEqual({ code: 'refused', message });
    }
    expect(await info(page)).toEqual(before);
  });

  test('layer.remove-selected refuses with only the root group selected, as the disabled button', async ({ page }) => {
    await clickLayerRow(page, (await info(page)).layers.find((l) => l.type === 'group')!.id);
    await expect(toolbarButton(page, 'Delete Layer')).toBeDisabled();
    expect(await runError(page, { op: 'layer.remove-selected' })).toEqual({
      code: 'refused',
      message: 'No deletable layer is selected: the root group cannot be deleted.',
    });
  });

  test('layer-creating commands refuse in an Indexed document, as the UI does', async ({ page }) => {
    await clickMenu(page, 'Image', 'Mode', 'Indexed Color...');
    await page.getByRole('dialog', { name: 'Indexed Color', exact: true }).getByRole('button', { name: 'Convert', exact: true }).click();
    await expect.poll(async () => (await run<{ colorMode: string }>(page, { op: 'doc.info' })).colorMode).toBe('indexed');
    const before = await info(page);
    for (const op of ['layer.add', 'layer.add-group', 'layer.duplicate', 'layer.group']) {
      expect(await runError(page, { op })).toEqual({ code: 'refused', message: 'Indexed mode does not support layers. Convert to RGB first.' });
    }
    expect(await info(page)).toEqual(before);
  });

  test('invalid params are rejected before anything runs', async ({ page }) => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ op: 'layer.set' }, /^layer\.set: pass at least one of name, visible, locked, opacity, blendMode$/],
      [{ op: 'layer.set', opacity: 150 }, /^layer\.set: opacity must be an integer from 0 to 100/],
      [{ op: 'layer.set', name: '   ' }, /^layer\.set: name must contain something other than spaces$/],
      [{ op: 'layer.select', layer: 'Background', mode: 'all' }, /^layer\.select: mode must be one of/],
      [{ op: 'layer.reorder', layer: 'Background', target: 'Layer 1', position: 'over' }, /^layer\.reorder: position must be one of "above", "below", "inside"/],
      [{ op: 'layer.group', layers: ['Project'] }, /^layer\.group: the root group cannot be grouped$/],
      [{ op: 'layer.flatten', layer: 'Background' }, /^layer\.flatten: unknown param "layer"/],
    ];
    for (const [invocation, message] of cases) {
      const error = await runError(page, invocation as { op: string });
      expect(error.code, JSON.stringify(invocation)).toBe('invalid');
      expect(error.message).toMatch(message);
    }
    expect(await runError(page, { op: 'layer.remove', layer: 'Nope' })).toEqual({
      code: 'not-found',
      message: 'No layer has the id or name "Nope".',
    });
  });
});
