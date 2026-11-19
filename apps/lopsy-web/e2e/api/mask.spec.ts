/**
 * The `mask` commands (src/commands/mask/mask.ts): each against the Layers
 * panel control it stands for, then on its own for the cases the UI never
 * reaches and for every refusal. Snapshots carry each mask's GPU bytes, so a
 * comparison fails when the masks differ.
 */
import { test, expect, run, runError, compareUiAndApi, gpuMaskHash, snapshot, type Page } from './harness';
import { brushStroke, dragMarquee, fillRect, historyLabels, settle } from '../surface-helpers';
import { clickLayerRow, maskMode, pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };

interface MaskState {
  layer: string;
  hasMask: boolean;
  enabled: boolean | null;
  editing: boolean;
}

/** A red block on Layer 1 at (20,20)-(80,60), with the marquee dropped. */
async function paintLayer1(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 80, 60, RED);
  await pressKey(page, 'ControlOrMeta+d');
}

function toolbarButton(page: Page, name: string) {
  return page.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name, exact: true });
}

async function clickButton(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
  await settle(page);
}

async function idOf(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.name === n);
    if (!layer) throw new Error(`no layer named ${n}`);
    return layer.id;
  }, name);
}

/** paintLayer1, then Add Mask over a marquee at (40,30)-(120,90), so the mask hides part of the block. */
async function maskedLayer1(page: Page): Promise<void> {
  await paintLayer1(page);
  await dragMarquee(page, 40, 30, 120, 90);
  await toolbarButton(page, 'Add Mask').click();
  await settle(page);
}

const STROKE = [{ x: 30, y: 40 }, { x: 70, y: 45 }, { x: 110, y: 50 }];

test.describe('the Layers panel mask controls and the mask commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the Layers panel needs the desktop layout');
  });

  test('mask.add matches Add Mask with no selection, and enters mask edit mode', async ({ page }) => {
    const modes: string[] = [];
    let result: MaskState | null = null;
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: async (p) => {
        await toolbarButton(p, 'Add Mask').click();
        await settle(p);
        modes.push(await maskMode(p));
      },
      viaApi: async (p) => {
        result = await run<MaskState>(p, { op: 'mask.add' });
        modes.push(await maskMode(p));
      },
    });
    expect(modes).toEqual(['layerMask', 'layerMask']);
    expect(result).toMatchObject({ hasMask: true, enabled: true, editing: true });
    expect(api.history.undo.at(-1)).toBe('Add Mask');
    expect(api.layers[1]!.mask).not.toBeNull();
  });

  test('mask.add matches Add Mask over a marquee: the mask reveals the selection, which is dropped', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer1(p);
        await dragMarquee(p, 40, 30, 120, 90);
      },
      viaUi: async (p) => {
        await toolbarButton(p, 'Add Mask').click();
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'mask.add' });
      },
    });
    expect(api.selection.active).toBe(false);
    expect(api.history.undo.at(-1)).toBe('Add Mask');
  });

  test('mask.add on another layer makes it active first and refuses a second mask', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    const background = await idOf(page, 'Background');
    expect(await run<MaskState>(page, { op: 'mask.add', layer: 'Background' })).toEqual({
      layer: background, hasMask: true, enabled: true, editing: true,
    });
    expect(await runError(page, { op: 'mask.add', layer: 'Background' })).toEqual({
      code: 'refused',
      message: '"Background" already has a mask: the Add Mask button is hidden while the active layer has one.',
    });
  });

  test('mask.remove matches the Delete mask button', async ({ page }) => {
    const modes: string[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: maskedLayer1,
      viaUi: async (p) => {
        await clickButton(p, 'Delete mask');
        modes.push(await maskMode(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'mask.remove' });
        modes.push(await maskMode(p));
      },
    });
    expect(modes).toEqual(['off', 'off']);
    expect(api.layers[1]!.hasMask).toBe(false);
    expect(api.history.undo.slice(-2)).toEqual(['Add Mask', 'Remove Mask']);
  });

  test('mask.remove refuses a layer with no mask', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'mask.remove' })).toEqual({ code: 'refused', message: '"Layer 1" has no mask.' });
  });

  test('mask.set-enabled turns a mask off and on with "Toggle Mask", and a repeat adds nothing', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await maskedLayer1(page);
    const masked = await snapshot(page);
    expect(await run<MaskState>(page, { op: 'mask.set-enabled', enabled: false })).toMatchObject({ enabled: false });
    expect(await run<MaskState>(page, { op: 'mask.set-enabled', enabled: false })).toMatchObject({ enabled: false });
    const off = await snapshot(page);
    expect(off.layers[1]!.maskEnabled).toBe(false);
    expect(off.history.undo.slice(-2)).toEqual(['Add Mask', 'Toggle Mask']);
    await run(page, { op: 'mask.set-enabled', enabled: true });
    const on = await snapshot(page);
    expect(on.layers[1]!.maskEnabled).toBe(true);
    expect(on.layers[1]!.mask).toBe(masked.layers[1]!.mask);
    expect(on.history.undo.slice(-3)).toEqual(['Add Mask', 'Toggle Mask', 'Toggle Mask']);
    expect(await runError(page, { op: 'mask.set-enabled', layer: 'Background', enabled: true })).toEqual({
      code: 'refused', message: '"Background" has no mask.',
    });
  });

  test('mask.edit matches a click on the mask thumbnail: the same brush stroke then lands on the mask', async ({ page }) => {
    const modes: string[] = [];
    let maskBefore: string | null = null;
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await maskedLayer1(p);
        await clickLayerRow(p, await idOf(p, 'Background'));
      },
      viaUi: async (p) => {
        await clickButton(p, 'Edit mask for Layer 1');
        modes.push(await maskMode(p));
        await brushStroke(p, STROKE, BLACK);
      },
      viaApi: async (p) => {
        maskBefore = await gpuMaskHash(p, await idOf(p, 'Layer 1'));
        await run(p, { op: 'mask.edit', layer: 'Layer 1', enabled: true });
        modes.push(await maskMode(p));
        await brushStroke(p, STROKE, BLACK);
      },
    });
    expect(modes).toEqual(['layerMask', 'layerMask']);
    expect(api.activeLayer).toBe(1);
    expect(api.layers[1]!.mask).not.toBe(maskBefore);
  });

  test('mask.edit enabled false matches a click on the layer row', async ({ page }) => {
    const modes: string[] = [];
    await compareUiAndApi(page, {
      setup: maskedLayer1,
      viaUi: async (p) => {
        await clickLayerRow(p, await idOf(p, 'Layer 1'));
        modes.push(await maskMode(p));
        await brushStroke(p, STROKE, BLACK);
      },
      viaApi: async (p) => {
        await run(p, { op: 'mask.edit', enabled: false });
        modes.push(await maskMode(p));
        await brushStroke(p, STROKE, BLACK);
      },
    });
    expect(modes).toEqual(['off', 'off']);
  });

  test('mask.edit refuses to edit a mask that is not there', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'mask.edit', enabled: true })).toEqual({ code: 'refused', message: '"Layer 1" has no mask.' });
    expect(await maskMode(page)).toBe('off');
  });

  test('mask.to-selection matches the Convert mask to selection button', async ({ page }) => {
    const modes: string[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: maskedLayer1,
      viaUi: async (p) => {
        await clickButton(p, 'Convert mask to selection');
        modes.push(await maskMode(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'mask.to-selection' });
        modes.push(await maskMode(p));
      },
    });
    expect(modes).toEqual(['off', 'off']);
    expect(api.selection.active).toBe(true);
  });

  test('mask.to-selection refuses a layer with no mask', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    const before = await historyLabels(page);
    expect(await runError(page, { op: 'mask.to-selection' })).toEqual({ code: 'refused', message: '"Layer 1" has no mask.' });
    expect(await historyLabels(page)).toEqual(before);
  });
});
