/**
 * The paths that commit a pending Move float (a Layers-panel row click, Cmd+D)
 * and the arrow-key nudges, against layer.select, select.none {commit} and
 * layer.nudge / select.nudge (src/commands/layer/nudge.ts).
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { clickMenu, fillRect, floatSelection, historyLabels, settle, surfaceState } from '../surface-helpers';
import { blurFocus, clickLayerRow, layerByName, pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };

/** A red block on Layer 1, still selected by the marquee that filled it. */
async function redBlock(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 80, 60, RED);
  await settle(page);
}

/** The red block lifted and dragged with the Move tool: the float stays pending. */
async function pendingFloat(page: Page): Promise<void> {
  await redBlock(page);
  await floatSelection(page, { x: 50, y: 40 }, { x: 90, y: 60 });
  expect((await surfaceState(page)).hasFloat).toBe(true);
}

/** Layer 2 added above, then Layer 1 made active again and given a pending float. */
async function pendingFloatUnderLayer2(page: Page): Promise<void> {
  const layer1 = (await surfaceState(page)).activeLayerId!;
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await clickLayerRow(page, layer1);
  await pendingFloat(page);
}

/** One held arrow-key burst: `count` keydowns (repeats after the first), then the keyup. */
async function holdArrow(page: Page, key: string, count: number): Promise<void> {
  await blurFocus(page);
  for (let i = 0; i < count; i++) await page.keyboard.down(key);
  await page.keyboard.up(key);
  await settle(page, 300);
}

async function api(page: Page, invocation: { op: string; [key: string]: unknown }): Promise<unknown> {
  const result = await run(page, invocation);
  await settle(page, 300);
  return result;
}

test.describe('committing a pending Move float', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  test('layer.select commits the float as a plain row click does', async ({ page }) => {
    const floats: boolean[] = [];
    const { api: after } = await compareUiAndApi(page, {
      setup: pendingFloatUnderLayer2,
      viaUi: async (p) => {
        await clickLayerRow(p, layerByName(await surfaceState(p), 'Layer 2').id);
        floats.push((await surfaceState(p)).hasFloat);
      },
      viaApi: async (p) => {
        await api(p, { op: 'layer.select', layer: 'Layer 2' });
        floats.push((await surfaceState(p)).hasFloat);
      },
    });
    expect(floats).toEqual([false, false]);
    expect(after.layers[after.activeLayer!]?.name).toBe('Layer 2');
    expect(after.history.undo).toEqual(['New Document', 'Add Layer', 'Fill', 'Move']);
  });

  test('select.none {commit: true} matches Cmd+D with a float pending', async ({ page }) => {
    const states: Array<{ hasFloat: boolean; hasTransform: boolean }> = [];
    const record = async (p: Page): Promise<void> => {
      const { hasFloat, hasTransform } = await surfaceState(p);
      states.push({ hasFloat, hasTransform });
    };
    const { api: after } = await compareUiAndApi(page, {
      setup: pendingFloat,
      viaUi: async (p) => {
        await pressKey(p, 'ControlOrMeta+d');
        await record(p);
      },
      viaApi: async (p) => {
        expect(await api(p, { op: 'select.none', commit: true })).toEqual({ active: false, bounds: null });
        await record(p);
      },
    });
    expect(states).toEqual([{ hasFloat: false, hasTransform: false }, { hasFloat: false, hasTransform: false }]);
    expect(after.history.undo).toEqual(['New Document', 'Fill', 'Move']);
  });

  test('select.none without commit leaves the float live, as Select > Deselect does', async ({ page }) => {
    const floats: boolean[] = [];
    await compareUiAndApi(page, {
      setup: pendingFloat,
      viaUi: async (p) => {
        await clickMenu(p, 'Select', 'Deselect');
        floats.push((await surfaceState(p)).hasFloat);
      },
      viaApi: async (p) => {
        await api(p, { op: 'select.none' });
        floats.push((await surfaceState(p)).hasFloat);
      },
    });
    expect(floats).toEqual([true, true]);
  });
});

test.describe('the arrow-key nudges', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  test('layer.nudge matches ArrowRight x3 held and Shift+ArrowDown with the Move tool on a whole layer', async ({ page }) => {
    const results: unknown[] = [];
    const { api: after } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: async (p) => {
        await redBlock(p);
        await pressKey(p, 'ControlOrMeta+d');
      },
      viaUi: async (p) => {
        await pressKey(p, 'v');
        await holdArrow(p, 'ArrowRight', 3);
        await pressKey(p, 'Shift+ArrowDown', 300);
      },
      viaApi: async (p) => {
        results.push(await api(p, { op: 'layer.nudge', dx: 3 }));
        results.push(await api(p, { op: 'layer.nudge', dy: 10 }));
      },
    });
    expect(after.history.undo).toEqual(['New Document', 'Fill', 'Nudge', 'Nudge']);
    expect(after.editor.tool).toBe('move');
    expect(results).toEqual([
      { layer: expect.any(String), x: expect.any(Number), y: expect.any(Number), selection: null },
      { layer: expect.any(String), x: expect.any(Number), y: expect.any(Number), selection: null },
    ]);
  });

  test('layer.nudge floats and moves the selected pixels as the keys do', async ({ page }) => {
    const floats: boolean[] = [];
    const { api: after } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: redBlock,
      viaUi: async (p) => {
        await pressKey(p, 'v');
        await holdArrow(p, 'ArrowRight', 3);
        await pressKey(p, 'Shift+ArrowDown', 300);
        floats.push((await surfaceState(p)).hasFloat);
      },
      viaApi: async (p) => {
        expect(await api(p, { op: 'layer.nudge', dx: 3 })).toMatchObject({ selection: { x: 23, y: 20, width: 60, height: 40 } });
        await api(p, { op: 'layer.nudge', dy: 10 });
        floats.push((await surfaceState(p)).hasFloat);
      },
    });
    expect(floats).toEqual([true, true]);
    expect(after.selection.bounds).toEqual({ x: 23, y: 30, width: 60, height: 40 });
    expect(after.history.undo).toEqual(['New Document', 'Fill', 'Nudge', 'Nudge']);
  });

  test('select.nudge moves the selection outline as the keys do with a selection tool', async ({ page }) => {
    const { api: after } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: redBlock,
      viaUi: async (p) => {
        await holdArrow(p, 'ArrowRight', 3);
        await pressKey(p, 'Shift+ArrowDown', 300);
      },
      viaApi: async (p) => {
        expect(await api(p, { op: 'select.nudge', dx: 3 })).toEqual({ bounds: { x: 23, y: 20, width: 60, height: 40 } });
        await api(p, { op: 'select.nudge', dy: 10 });
      },
    });
    expect(after.selection.bounds).toEqual({ x: 23, y: 30, width: 60, height: 40 });
    expect(after.history.undo).toEqual(['New Document', 'Fill', 'Nudge', 'Nudge']);
    expect(after.editor.tool).toBe('marquee-rect');
  });
});

test.describe('the nudge commands on their own', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the Layers panel needs the desktop layout');
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await page.waitForSelector('[data-testid="canvas-container"]');
    await settle(page, 300);
  });

  test('refuse a zero offset, a locked layer and a missing selection', async ({ page }) => {
    expect(await runError(page, { op: 'layer.nudge' })).toEqual({ code: 'invalid', message: 'layer.nudge: dx and dy are both 0; nothing would move.' });
    expect(await runError(page, { op: 'select.nudge', dx: 2 })).toEqual({ code: 'refused', message: 'Nothing is selected: there is no outline to nudge.' });
    expect((await runError(page, { op: 'layer.nudge', dx: 1.5 })).code).toBe('invalid');
    await run(page, { op: 'layer.set', locked: true });
    expect(await runError(page, { op: 'layer.nudge', dx: 1 })).toEqual({ code: 'refused', message: '"Layer 1" is locked: the arrow keys do not move it.' });
    expect(await historyLabels(page)).toEqual(['New Document', 'Lock Layer']);
  });
});
