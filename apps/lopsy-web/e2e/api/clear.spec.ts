/**
 * `paint.clear` (src/commands/paint/clear.ts) and `mask.clear`
 * (src/commands/mask/clear.ts): the Delete key's two clears, each against
 * the key, including the cases the characterization specs pin as-is (a
 * pending Move float committed first, a locked layer cleared anyway).
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { createDocument } from '../helpers';
import { dragMarquee, fillRect, floatSelection, historyLabels, settle, surfaceState, toasts } from '../surface-helpers';
import { clickLayerRow, maskMode, pressKey, rowButton } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };

async function layer1(page: Page): Promise<string> {
  const layer = (await surfaceState(page)).layers.find((l) => l.name === 'Layer 1');
  if (!layer) throw new Error('no Layer 1');
  return layer.id;
}

async function redBlock(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 80, 60, RED);
  await pressKey(page, 'ControlOrMeta+d');
}

async function redBlockWithMarquee(page: Page): Promise<void> {
  await redBlock(page);
  await dragMarquee(page, 10, 10, 50, 50);
}

/** The red block with a mask, in mask edit mode, and a marquee over part of it. */
async function maskedWithMarquee(page: Page): Promise<void> {
  await redBlock(page);
  await page.locator('[aria-label="Add Mask"]').click();
  await settle(page);
  await dragMarquee(page, 40, 30, 120, 90);
}

async function freshDocument(page: Page): Promise<void> {
  await createDocument(page, 200, 150, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

test.describe('the Delete key\'s clears and paint.clear / mask.clear', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the Layers panel needs the desktop layout');
  });

  test('paint.clear matches Delete with a marquee: "Clear Selection", the layer and selection kept', async ({ page }) => {
    const results: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: redBlockWithMarquee,
      viaUi: (p) => pressKey(p, 'Delete'),
      viaApi: async (p) => {
        results.push(await run(p, { op: 'paint.clear' }));
      },
    });
    expect(results).toEqual([{ layer: expect.any(String) }]);
    expect(api.history.undo).toEqual(['New Document', 'Fill', 'Clear Selection']);
    expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Project']);
    expect(api.selection.bounds).toEqual({ x: 10, y: 10, width: 40, height: 40 });
  });

  test('paint.clear matches Delete after a Move drag: the float is committed first', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await fillRect(p, 20, 20, 80, 60, RED);
        await floatSelection(p, { x: 50, y: 40 }, { x: 90, y: 60 });
        expect((await surfaceState(p)).hasFloat).toBe(true);
      },
      viaUi: (p) => pressKey(p, 'Delete'),
      viaApi: async (p) => {
        await run(p, { op: 'paint.clear' });
        expect((await surfaceState(p)).hasFloat).toBe(false);
      },
    });
    expect(api.history.undo).toEqual(['New Document', 'Fill', 'Move', 'Clear Selection']);
  });

  test('paint.clear matches Delete on a LOCKED layer: both clear it (the key has no lock check)', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await redBlock(p);
        await rowButton(p, await layer1(p), 'Lock layer').click();
        await settle(p);
        await dragMarquee(p, 10, 10, 50, 50);
      },
      viaUi: (p) => pressKey(p, 'Delete'),
      viaApi: async (p) => {
        await run(p, { op: 'paint.clear' });
      },
    });
    expect(api.layers[1]!.locked).toBe(true);
    expect(api.history.undo.at(-1)).toBe('Clear Selection');
  });

  test('mask.clear matches Delete in mask edit mode: "Mask Clear", the layer pixels untouched', async ({ page }) => {
    const modes: string[] = [];
    const { ui, api } = await compareUiAndApi(page, {
      setup: maskedWithMarquee,
      viaUi: async (p) => {
        await pressKey(p, 'Delete');
        modes.push(await maskMode(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'mask.clear' });
        modes.push(await maskMode(p));
      },
    });
    expect(modes).toEqual(['layerMask', 'layerMask']);
    expect(api.history.undo.at(-1)).toBe('Mask Clear');
    expect(api.layers[1]!.pixels).toBe(ui.layers[1]!.pixels);
  });

  test('mask.clear on a layer not in mask edit mode matches a click on its mask thumbnail, then Delete', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => {
        await maskedWithMarquee(p);
        await clickLayerRow(p, await layer1(p));
      },
      viaUi: async (p) => {
        await p.getByRole('button', { name: 'Edit mask for Layer 1', exact: true }).click();
        await settle(p);
        await pressKey(p, 'Delete');
      },
      viaApi: async (p) => {
        expect(await maskMode(p)).toBe('off');
        await run(p, { op: 'mask.clear', layer: 'Layer 1' });
        expect(await maskMode(p)).toBe('layerMask');
      },
    });
  });

  test('mask.clear matches Delete in mask edit mode on a LOCKED layer (pinned as-is)', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await maskedWithMarquee(p);
        await rowButton(p, await layer1(p), 'Lock layer').click();
        await settle(p);
      },
      viaUi: (p) => pressKey(p, 'Delete'),
      viaApi: async (p) => {
        await run(p, { op: 'mask.clear' });
      },
    });
    expect(api.history.undo.slice(-2)).toEqual(['Lock Layer', 'Mask Clear']);
  });

  test('paint.clear refuses with no selection, where Delete would remove the layer, and in mask edit mode', async ({ page }) => {
    await freshDocument(page);
    await redBlock(page);
    expect(await runError(page, { op: 'paint.clear' })).toEqual({
      code: 'refused',
      message: 'Nothing is selected: paint.clear clears the selected pixels. (The Delete key with no selection removes the layer: that is layer.remove.)',
    });
    expect((await surfaceState(page)).orderNames).toEqual(['Background', 'Layer 1', 'Project']);
    await page.locator('[aria-label="Add Mask"]').click();
    await settle(page);
    await dragMarquee(page, 40, 30, 120, 90);
    const history = await historyLabels(page);
    expect(await runError(page, { op: 'paint.clear' })).toEqual({
      code: 'refused',
      message: '"Layer 1" is in mask edit mode, where the Delete key clears the mask: use mask.clear, or mask.edit with enabled false to clear its pixels.',
    });
    expect(await historyLabels(page)).toEqual(history);
    expect(await toasts(page)).toEqual([]);
  });

  test('mask.clear refuses a layer with no mask', async ({ page }) => {
    await freshDocument(page);
    expect(await runError(page, { op: 'mask.clear' })).toEqual({ code: 'refused', message: '"Layer 1" has no mask.' });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });
});
