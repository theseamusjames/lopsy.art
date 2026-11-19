/**
 * The `adjust` commands (src/commands/adjust/adjust.ts): each against the
 * Adjustments drawer control it stands for, then on its own for every
 * refusal. Snapshots carry each group's nodes (without ids) and a hash of the
 * export composite, so a comparison fails when the adjustments differ or
 * render differently.
 */
import { test, expect, run, runError, compareUiAndApi, snapshot, type Page } from './harness';
import { createDocument, getRootGroupId, openGroupEffectsPanel } from '../helpers';
import { clickMenu, fillRect, historyLabels, settle } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';

interface NodeSummary {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

interface Adjustments {
  group: string;
  enabled: boolean;
  nodes: NodeSummary[];
}

const DEFAULT_TYPES = ['levels', 'curves', 'exposure', 'hue-saturation', 'color-grading'];

function drawer(page: Page) {
  return page.getByTestId('effects-drawer');
}

function nodeRow(page: Page, label: string) {
  return drawer(page).locator('div[class*="nodeRow"]', { hasText: label });
}

/** An orange block, then the root group's Adjustments drawer open (which makes the root group active). */
async function paintAndOpenRoot(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 180, 130, { r: 200, g: 120, b: 40 });
  await pressKey(page, 'ControlOrMeta+d');
  await openGroupEffectsPanel(page, await getRootGroupId(page));
  await settle(page);
}

async function addThroughMenu(page: Page, label: string): Promise<void> {
  await page.locator('[aria-label="Add Adjustment"]').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await settle(page);
}

async function expand(page: Page, label: string): Promise<void> {
  const row = nodeRow(page, label);
  const button = row.locator('[aria-label="Expand"]');
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function typeValue(page: Page, label: string, field: string, value: number): Promise<void> {
  const input = nodeRow(page, label).locator(`[aria-label="${field} value"]`);
  await input.fill(String(value));
  await input.press('Enter');
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
}

async function list(page: Page): Promise<Adjustments> {
  return run<Adjustments>(page, { op: 'adjust.list' });
}

async function idOfType(page: Page, type: string): Promise<string> {
  const node = (await list(page)).nodes.find((n) => n.type === type);
  if (!node) throw new Error(`no ${type} node`);
  return node.id;
}

test.describe('the Adjustments drawer and the adjust commands', () => {
  test.describe.configure({ timeout: 150_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the Layers panel and drawer need the desktop layout');
  });

  test('adjust.add matches the Add Adjustment menu for four node types', async ({ page }) => {
    const composites: string[] = [];
    const types = [
      ['vignette', 'Vignette'], ['invert', 'Invert'], ['black-white', 'Black & White'], ['photo-filter', 'Photo Filter'],
    ] as const;
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintAndOpenRoot(p);
        composites.push((await snapshot(p)).composite);
      },
      viaUi: async (p) => {
        for (const [, label] of types) await addThroughMenu(p, label);
      },
      viaApi: async (p) => {
        for (const [type] of types) {
          const result = await run<Adjustments & { id: string }>(p, { op: 'adjust.add', type });
          expect(result.nodes.at(-1)).toMatchObject({ id: result.id, type, enabled: true });
        }
      },
    });
    expect(api.layers.at(-1)!.adjustments!.nodes.map((n) => n.type)).toEqual([...DEFAULT_TYPES, ...types.map(([t]) => t)]);
    expect(api.history.undo.slice(-4)).toEqual(Array(4).fill('Add Adjustment'));
    expect(api.composite).not.toBe(composites[0]);
  });

  test('adjust.set matches typing two values into a node\'s fields', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintAndOpenRoot(p);
        await expand(p, 'Hue / Saturation');
      },
      viaUi: async (p) => {
        await typeValue(p, 'Hue / Saturation', 'Hue', 40);
        await typeValue(p, 'Hue / Saturation', 'Lightness', -25);
        await blur(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'adjust.set', node: 'hue-saturation', params: { hue: 40, lightness: -25 } });
      },
    });
    const node = api.layers.at(-1)!.adjustments!.nodes.find((n) => n.type === 'hue-saturation');
    expect(node?.params).toEqual({ hue: 40, saturation: 0, lightness: -25 });
    expect(api.history.undo.slice(-2)).toEqual(['Edit Hue / Saturation', 'Edit Hue / Saturation']);
  });

  test('adjust.set curves matches a click on the curve editor, with the point it added', async ({ page }) => {
    let curves: unknown = null;
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintAndOpenRoot(p);
        await expand(p, 'Curves');
      },
      viaUi: async (p) => {
        const editor = nodeRow(p, 'Curves').locator('[aria-label="Tone curve editor"]');
        const box = await editor.boundingBox();
        if (!box) throw new Error('no curve editor');
        await editor.click({ position: { x: box.width * 0.4, y: box.height * 0.3 } });
        await blur(p);
        curves = (await list(p)).nodes.find((n) => n.type === 'curves')?.params.curves;
      },
      viaApi: async (p) => {
        await run(p, { op: 'adjust.set', node: 'curves', params: { curves } });
      },
    });
    const rgb = (curves as { rgb: Array<{ x: number; y: number }> }).rgb;
    expect(rgb).toHaveLength(3);
    expect(api.history.undo.at(-1)).toBe('Edit Curves');
  });

  test('adjust.set-node-enabled, adjust.remove and adjust.set-enabled match the drawer\'s buttons', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintAndOpenRoot(p);
        await addThroughMenu(p, 'Invert');
      },
      viaUi: async (p) => {
        await nodeRow(p, 'Invert').locator('[aria-label="Disable node"]').click();
        await settle(p);
        await nodeRow(p, 'Exposure').locator('[aria-label="Remove node"]').click();
        await settle(p);
        await drawer(p).locator('[aria-label="Disable adjustments"]').click();
        await settle(p);
      },
      viaApi: async (p) => {
        await run(p, [
          { op: 'adjust.set-node-enabled', node: 'invert', enabled: false },
          { op: 'adjust.remove', node: 'exposure' },
          { op: 'adjust.set-enabled', enabled: false },
        ]);
      },
    });
    const adjustments = api.layers.at(-1)!.adjustments!;
    expect(adjustments.enabled).toBe(false);
    expect(adjustments.nodes.map((n) => [n.type, n.enabled])).toContainEqual(['invert', false]);
    expect(adjustments.nodes.some((n) => n.type === 'exposure')).toBe(false);
    expect(api.history.undo.slice(-3)).toEqual(['Add Adjustment', 'Toggle Adjustment', 'Remove Adjustment']);
  });

  test('adjust.reorder matches dragging a node onto another in the drawer', async ({ page }) => {
    let order: string[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintAndOpenRoot(p);
        await addThroughMenu(p, 'Invert');
      },
      viaUi: async (p) => {
        const header = (label: string) => nodeRow(p, label).locator('div[class*="nodeHeader"]');
        await header('Invert').dragTo(header('Levels'));
        await settle(p);
        order = (await list(p)).nodes.map((n) => n.type);
      },
      viaApi: async (p) => {
        const nodes = (await list(p)).nodes;
        const ids = order.map((type) => nodes.find((n) => n.type === type)!.id);
        await run(p, { op: 'adjust.reorder', nodes: ids });
      },
    });
    expect(order).toEqual(['invert', ...DEFAULT_TYPES]);
    expect(api.history.undo.at(-1)).toBe('Reorder Adjustments');
  });

  test('the adjust commands work on their own and refuse what the panel cannot do', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    const before = await list(page);
    expect(before.nodes.map((n) => n.type)).toEqual(DEFAULT_TYPES);
    expect(before.group).toBe(await getRootGroupId(page));

    const added = await run<{ id: string }>(page, { op: 'adjust.add', type: 'exposure' });
    expect((await runError(page, { op: 'adjust.set', node: 'exposure', params: { exposure: 1 } })).message).toContain('has 2 exposure nodes');
    await run(page, { op: 'adjust.set', node: added.id, params: { exposure: 1.5 } });
    expect((await list(page)).nodes.find((n) => n.id === added.id)?.params).toEqual({ exposure: 1.5 });
    expect(await runError(page, { op: 'adjust.set', node: added.id, params: { exposure: 9 } })).toEqual({
      code: 'invalid', message: 'adjust.set: params.exposure must be a number from -5 to 5, got 9',
    });
    expect((await runError(page, { op: 'adjust.set', node: added.id, params: { gamma: 1 } })).message).toBe(
      'adjust.set: unknown param "gamma"; valid params for exposure: exposure',
    );
    expect((await runError(page, { op: 'adjust.remove', node: 'nope' })).code).toBe('not-found');
    expect((await runError(page, { op: 'adjust.list', group: 'Layer 1' })).code).toBe('invalid');
    expect((await runError(page, { op: 'adjust.reorder', nodes: [added.id] })).code).toBe('invalid');
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Adjustment', 'Edit Exposure']);

    const levels = await idOfType(page, 'levels');
    await run(page, { op: 'adjust.set', node: levels, params: { levels: { rgb: { inputBlack: 0.2, gamma: 1.5 } } } });
    const level = (await list(page)).nodes.find((n) => n.id === levels)?.params.levels as Record<string, Record<string, number>>;
    expect(level.rgb).toEqual({ inputBlack: 0.2, inputWhite: 1, gamma: 1.5, outputBlack: 0, outputWhite: 1 });

    const group = await run<{ id: string }>(page, { op: 'layer.add-group' });
    expect(await list(page)).toEqual({ group: group.id, enabled: true, nodes: [] });
  });

  test('adjust.add refuses a type the Add Adjustment menu hides in a grayscale document', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    await clickMenu(page, 'Image', 'Mode', 'Grayscale');
    await expect.poll(async () => (await historyLabels(page)).at(-1)).toBe('Convert to Grayscale');
    expect(await runError(page, { op: 'adjust.add', type: 'saturation' })).toEqual({
      code: 'refused',
      message: 'Saturation & Vibrance is not offered in grayscale documents: the Add Adjustment menu leaves it out.',
    });
  });
});
