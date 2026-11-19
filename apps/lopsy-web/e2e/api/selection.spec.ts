/**
 * The `select` commands (src/commands/selection/selection.ts): each against
 * the tool drag, menu item, dialog or panel click it stands for, then on its
 * own for every refusal. Snapshots carry a hash of the selection mask, and
 * the shape comparisons also run the same Edit > Fill on both sides, so
 * they fail when the selections constrain painting differently.
 */
import { test, expect, run, runError, compareUiAndApi, snapshot, type Page } from './harness';
import { createDocument, docToScreen, selectTool, setForegroundColor, setToolOption } from '../helpers';
import { clickMenu, dragMarquee, fillRect, floatSelection, historyLabels, settle, surfaceState, toasts } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionResult {
  active: boolean;
  bounds: Bounds | null;
}

interface Point {
  x: number;
  y: number;
}

type Modifier = 'Shift' | 'Alt';

async function actualSize(page: Page): Promise<void> {
  await clickMenu(page, 'View', 'Actual Size');
  await settle(page);
}

async function selectionBounds(page: Page): Promise<Bounds | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: Bounds | null } };
    };
    const { selection } = store.getState();
    return selection.active && selection.bounds ? { ...selection.bounds } : null;
  });
}

async function withModifiers(page: Page, modifiers: readonly Modifier[], action: () => Promise<void>): Promise<void> {
  for (const key of modifiers) await page.keyboard.down(key);
  await action();
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  await settle(page);
}

async function fillRed(page: Page): Promise<void> {
  await setForegroundColor(page, RED.r, RED.g, RED.b);
  await clickMenu(page, 'Edit', 'Fill');
  await settle(page);
}

async function dragEllipse(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** A Lasso drag through `points`, one mouse move per point; returns the points the tool recorded. */
async function dragLasso(page: Page, points: readonly Point[]): Promise<Point[]> {
  await selectTool(page, 'lasso');
  const [first, ...rest] = points;
  if (!first) throw new Error('dragLasso needs points');
  const start = await docToScreen(page, first.x, first.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of rest) {
    const s = await docToScreen(page, p.x, p.y);
    await page.mouse.move(s.x, s.y, { steps: 1 });
  }
  const recorded = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { lassoPoints: Point[] };
    };
    return ui.getState().lassoPoints.map((p) => ({ x: p.x, y: p.y }));
  });
  await page.mouse.up();
  await settle(page);
  return recorded;
}

async function layerId(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.name === n);
    if (!layer) throw new Error(`no layer named ${n}`);
    return layer.id;
  }, name);
}

async function paths(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ name: string; closed: boolean; anchors: unknown }> };
    };
    return store.getState().paths.map((p) => ({ name: p.name, closed: p.closed, anchors: p.anchors }));
  });
}

type ModifyItem = 'Grow…' | 'Shrink…' | 'Feather…';
const DIALOG: Record<ModifyItem, { name: string; field: string }> = {
  'Grow…': { name: 'Grow Selection', field: 'Amount (px) value' },
  'Shrink…': { name: 'Shrink Selection', field: 'Amount (px) value' },
  'Feather…': { name: 'Feather Selection', field: 'Radius (px) value' },
};

async function modifyThroughDialog(page: Page, item: ModifyItem, amount: number): Promise<void> {
  await clickMenu(page, 'Select', item);
  const dialog = page.getByRole('dialog', { name: DIALOG[item].name });
  const input = dialog.locator(`input[aria-label="${DIALOG[item].field}"]`);
  await input.fill(String(amount));
  await input.press('Tab');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page, 300);
}

/** The marquee at (50,40)-(150,110), on both sides. */
async function firstBox(page: Page): Promise<void> {
  await actualSize(page);
  await dragMarquee(page, 50, 40, 150, 110);
  expect(await selectionBounds(page)).toEqual({ x: 50, y: 40, width: 100, height: 70 });
}

test.describe('the selection tools and Select menu, and the select commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  test('select.rect matches a Rectangular Marquee drag, and the same Fill lands identically', async ({ page }) => {
    const results: SelectionResult[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: actualSize,
      viaUi: async (p) => {
        await dragMarquee(p, 50, 40, 150, 110);
        expect(await selectionBounds(p)).toEqual({ x: 50, y: 40, width: 100, height: 70 });
        await fillRed(p);
      },
      viaApi: async (p) => {
        results.push(await run<SelectionResult>(p, { op: 'select.rect', x: 50, y: 40, width: 100, height: 70 }));
        await fillRed(p);
      },
    });
    expect(results).toEqual([{ active: true, bounds: { x: 50, y: 40, width: 100, height: 70 } }]);
    expect(api.selection.mask).not.toBeNull();
    expect(api.history.undo).toEqual(['New Document', 'Fill']);
  });

  const COMBINES = [
    { mode: 'add', keys: ['Shift'], label: 'Add to Selection' },
    { mode: 'subtract', keys: ['Alt'], label: 'Subtract from Selection' },
    { mode: 'intersect', keys: ['Shift', 'Alt'], label: 'Intersect Selection' },
  ] as const;

  for (const { mode, keys, label } of COMBINES) {
    test(`select.rect mode ${mode} matches a ${keys.join('+')} marquee drag over a selection`, async ({ page }) => {
      const { api, ui } = await compareUiAndApi(page, {
        setup: firstBox,
        viaUi: async (p) => {
          await selectTool(p, 'marquee-rect');
          const start = await docToScreen(p, 100, 80);
          const end = await docToScreen(p, 180, 130);
          await withModifiers(p, keys, async () => {
            await p.mouse.move(start.x, start.y);
            await p.mouse.down();
            await p.mouse.move(end.x, end.y, { steps: 8 });
            await p.mouse.up();
          });
          await fillRed(p);
        },
        viaApi: async (p) => {
          await run(p, { op: 'select.rect', x: 100, y: 80, width: 80, height: 50, mode });
          await fillRed(p);
        },
      });
      expect(ui.history.undo).toEqual(['New Document', label, 'Fill']);
      expect(api.selection.mask).not.toBeNull();
    });
  }

  test('select.ellipse matches an Elliptical Marquee drag, and the same Fill lands identically', async ({ page }) => {
    const { ui } = await compareUiAndApi(page, {
      setup: actualSize,
      viaUi: async (p) => {
        await dragEllipse(p, 40, 30, 160, 120);
        expect(await selectionBounds(p)).toEqual({ x: 40, y: 30, width: 120, height: 90 });
        await fillRed(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'select.ellipse', x: 40, y: 30, width: 120, height: 90 });
        await fillRed(p);
      },
    });
    expect(ui.layers[1]!.pixels).not.toBeNull();
  });

  test('select.polygon matches a Lasso drag through the same points, and the same Fill lands identically', async ({ page }) => {
    const corners = [{ x: 30, y: 20 }, { x: 170, y: 40 }, { x: 120, y: 130 }, { x: 40, y: 100 }];
    let recorded: Point[] = [];
    await compareUiAndApi(page, {
      setup: actualSize,
      viaUi: async (p) => {
        recorded = await dragLasso(p, corners);
        await fillRed(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'select.polygon', points: recorded });
        await fillRed(p);
      },
    });
    // At 100% zoom one mouse move per corner records exactly the corners.
    expect(recorded).toEqual(corners);
  });

  test('a marquee Feather option set in the options bar softens select.rect as it softens the drag', async ({ page }) => {
    const setFeather = async (p: Page): Promise<void> => {
      await actualSize(p);
      await selectTool(p, 'marquee-rect');
      await setToolOption(p, 'Feather', 6);
    };
    const { api } = await compareUiAndApi(page, {
      setup: setFeather,
      viaUi: async (p) => {
        await dragMarquee(p, 50, 40, 150, 110);
        await fillRed(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'select.rect', x: 50, y: 40, width: 100, height: 70 });
        await fillRed(p);
      },
    });
    expect(api.selection.bounds).not.toEqual({ x: 50, y: 40, width: 100, height: 70 });
  });

  test('select.all matches Select > All', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: firstBox,
      viaUi: (p) => clickMenu(p, 'Select', 'All'),
      viaApi: async (p) => {
        expect(await run(p, { op: 'select.all' })).toEqual({ active: true, bounds: { x: 0, y: 0, width: 200, height: 150 } });
      },
    });
    expect(api.selection.bounds).toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });

  test('select.none matches Select > Deselect', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: firstBox,
      viaUi: (p) => clickMenu(p, 'Select', 'Deselect'),
      viaApi: async (p) => {
        expect(await run(p, { op: 'select.none' })).toEqual({ active: false, bounds: null });
      },
    });
    expect(api.selection).toEqual({ active: false, bounds: null, mask: null });
  });

  test('select.invert matches Select > Inverse, and the same Fill lands identically', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: firstBox,
      viaUi: async (p) => {
        await clickMenu(p, 'Select', 'Inverse');
        await fillRed(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'select.invert' });
        await fillRed(p);
      },
    });
    expect(api.history.undo).toEqual(['New Document', 'Inverse Selection', 'Fill']);
  });

  test('Select > Inverse with a live Move float and nothing selected commits the float, and so does select.invert before refusing', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await fillRect(p, 20, 20, 80, 60, RED);
        await floatSelection(p, { x: 50, y: 40 }, { x: 90, y: 60 });
        await clickMenu(p, 'Select', 'Deselect');
        expect((await surfaceState(p)).hasFloat).toBe(true);
      },
      viaUi: async (p) => {
        await clickMenu(p, 'Select', 'Inverse');
        expect((await surfaceState(p)).hasFloat).toBe(false);
      },
      viaApi: async (p) => {
        expect(await runError(p, { op: 'select.invert' })).toEqual({ code: 'refused', message: 'Nothing is selected to invert.' });
        expect((await surfaceState(p)).hasFloat).toBe(false);
      },
    });
    expect(api.selection.active).toBe(false);
  });

  for (const [item, kind, amount] of [['Grow…', 'grow', 10], ['Shrink…', 'shrink', 20], ['Feather…', 'feather', 5]] as const) {
    test(`select.modify ${kind} matches Select > ${item} Apply`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: firstBox,
        viaUi: async (p) => {
          await modifyThroughDialog(p, item, amount);
          await fillRed(p);
        },
        viaApi: async (p) => {
          await run(p, { op: 'select.modify', kind, amount });
          await fillRed(p);
        },
      });
      expect(api.history.undo).toEqual(['New Document', DIALOG[item].name, 'Fill']);
    });
  }

  test('select.modify refuses an empty result with the text the Shrink dialog toasts', async ({ page }) => {
    const said: string[][] = [];
    let refusal = { code: '', message: '' };
    const { api } = await compareUiAndApi(page, {
      setup: firstBox,
      viaUi: async (p) => {
        await modifyThroughDialog(p, 'Shrink…', 100);
        said.push(await toasts(p));
      },
      viaApi: async (p) => {
        refusal = await runError(p, { op: 'select.modify', kind: 'shrink', amount: 100 });
        said.push(await toasts(p));
      },
    });
    const text = 'No pixels would remain selected. The selection was not changed.';
    expect(said).toEqual([[text], []]);
    expect(refusal).toEqual({ code: 'refused', message: text });
    expect(api.selection.bounds).toEqual({ x: 50, y: 40, width: 100, height: 70 });
    expect(api.history.undo).toEqual(['New Document']);
  });

  test('select.from-layer matches a Cmd-click on the layer thumbnail', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await fillRect(p, 30, 20, 90, 70, RED);
        await pressKey(p, 'ControlOrMeta+d');
      },
      viaUi: async (p) => {
        const id = await layerId(p, 'Layer 1');
        await p.locator(`[data-layer-id="${id}"] div[class*="thumbnail"]`).first().click({ modifiers: ['ControlOrMeta'] });
        await settle(p, 300);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'select.from-layer', layer: 'Layer 1' })).toEqual({
          active: true, bounds: { x: 30, y: 20, width: 60, height: 50 },
        });
      },
    });
    expect(api.selection.bounds).toEqual({ x: 30, y: 20, width: 60, height: 50 });
  });

  test('select.to-path matches Select > Selection → Path', async ({ page }) => {
    const traced: unknown[][] = [];
    const { api } = await compareUiAndApi(page, {
      setup: firstBox,
      viaUi: async (p) => {
        await clickMenu(p, 'Select', 'Selection → Path');
        await settle(p);
        traced.push(await paths(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'select.to-path' });
        traced.push(await paths(p));
      },
    });
    expect(traced[0]!.length).toBe(1);
    expect(traced[1]).toEqual(traced[0]);
    expect(api.history.undo).toEqual(['New Document', 'Selection to Path']);
  });

  test('select.from-layer refuses a layer with no opaque pixels and a group', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await settle(page, 300);
    expect(await runError(page, { op: 'select.from-layer' })).toEqual({
      code: 'refused', message: '"Layer 1" has no opaque pixels: the selection was not changed.',
    });
    const group = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; name: string; type: string }> } };
      };
      return store.getState().document.layers.find((l) => l.type === 'group') ?? null;
    });
    if (!group) throw new Error('the document has no root group');
    expect(await runError(page, { op: 'select.from-layer', layer: group.id })).toEqual({
      code: 'refused', message: `"${group.name}" is a group: groups have no thumbnail to select pixels from.`,
    });
  });

  test('the commands refuse what the UI ignores: no selection, a box or polygon off the document', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    for (const op of ['select.invert', 'select.to-path']) {
      expect((await runError(page, { op })).code).toBe('refused');
    }
    expect(await runError(page, { op: 'select.modify', kind: 'grow', amount: 3 })).toEqual({
      code: 'refused', message: 'Nothing is selected to grow.',
    });
    expect(await runError(page, { op: 'select.rect', x: 300, y: 0, width: 10, height: 10 })).toEqual({
      code: 'refused', message: 'The box does not overlap the 200x150 document.',
    });
    expect(await runError(page, { op: 'select.polygon', points: [{ x: -50, y: -50 }, { x: -10, y: -50 }, { x: -10, y: -10 }] })).toEqual({
      code: 'refused', message: 'The polygon covers no pixel of the document.',
    });
    expect((await runError(page, { op: 'select.modify', kind: 'shrink', amount: 101 })).code).toBe('invalid');
    expect(await historyLabels(page)).toEqual(['New Document']);
    const snap = await snapshot(page);
    expect(snap.selection.active).toBe(false);
  });

  test('select.to-path refuses an active selection with no outline, as the menu does nothing', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    await run(page, [{ op: 'select.all' }, { op: 'select.invert' }]);
    expect(await runError(page, { op: 'select.to-path' })).toEqual({
      code: 'refused', message: 'The selection has no outline to trace.',
    });
    expect(await historyLabels(page)).toEqual(['New Document', 'Inverse Selection']);
  });
});
