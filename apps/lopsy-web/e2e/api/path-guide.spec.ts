/**
 * The `path` and `guide` commands (src/commands/path/path.ts,
 * src/commands/guide/guide.ts): each against the Pen tool, Paths panel, Path
 * menu, ruler or Edit menu control it stands for, then on its own for the
 * operations the UI has no control for and for every refusal. Snapshots carry
 * every path's anchor points and every guide; names and the selected path are
 * compared through path.list.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { createDocument, docToScreen } from '../helpers';
import { clickMenu, dragMarquee, historyLabels, settle, surfaceState, toasts } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';
import { showPathsPanel } from '../surface-helpers-filters';

interface Anchor {
  point: { x: number; y: number };
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
}

interface PathInfo {
  id: string;
  name: string;
  closed: boolean;
  anchors: Anchor[];
}

interface PathList {
  paths: PathInfo[];
  selected: string | null;
}

/** Names in order, and the index of the selected path: what the Paths panel shows, without ids. */
async function panelState(page: Page): Promise<{ names: string[]; selected: number }> {
  const { paths, selected } = await run<PathList>(page, { op: 'path.list' });
  return { names: paths.map((p) => p.name), selected: paths.findIndex((p) => p.id === selected) };
}

async function selectionToPath(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await dragMarquee(page, x0, y0, x1, y1);
  await clickMenu(page, 'Select', 'Selection → Path');
  await pressKey(page, 'ControlOrMeta+d');
}

/** A = x 20..100, y 20..100, then B = x 60..140, y 40..120; B is selected. */
async function twoOverlappingPaths(page: Page): Promise<void> {
  await selectionToPath(page, 20, 20, 100, 100);
  await selectionToPath(page, 60, 40, 140, 120);
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const at = await docToScreen(page, x, y);
  await page.mouse.click(at.x, at.y);
  await settle(page);
}

async function rulerClick(page: Page, docX: number): Promise<void> {
  const container = await page.locator('[data-testid="canvas-container"]').boundingBox();
  if (!container) throw new Error('no canvas container');
  const { x } = await docToScreen(page, docX, 0);
  await page.mouse.click(x, container.y + 10);
  await settle(page);
}

async function guidePositions(page: Page): Promise<Array<{ orientation: string; position: number }>> {
  const { guides } = await run<{ guides: Array<{ orientation: string; position: number }> }>(page, { op: 'guide.list' });
  return guides.map(({ orientation, position }) => ({ orientation, position }));
}

async function freshDocument(page: Page): Promise<void> {
  await createDocument(page, 200, 150, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

function pathRow(list: ReturnType<Page['locator']>, index: number) {
  return list.getByRole('option').nth(index);
}

test.describe('the Pen tool, Paths panel and Path menu, and the path commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and panels need the desktop layout');
  });

  test('path.add matches a Pen draft committed with the Commit path button (no stroke)', async ({ page }) => {
    let drawn: Anchor[] = [];
    const panels: Array<{ names: string[]; selected: number }> = [];
    const { api } = await compareUiAndApi(page, {
      viaUi: async (p) => {
        await pressKey(p, 'p');
        for (const [x, y] of [[40, 40], [160, 50], [120, 110]] as const) await clickDoc(p, x, y);
        await p.getByRole('button', { name: 'Commit path', exact: true }).click();
        await settle(p);
        const { paths } = await run<PathList>(p, { op: 'path.list' });
        drawn = paths[0]!.anchors;
        panels.push(await panelState(p));
      },
      viaApi: async (p) => {
        const anchors = drawn.map((a) => ({ point: a.point, ...(a.handleIn && { handleIn: a.handleIn }), ...(a.handleOut && { handleOut: a.handleOut }) }));
        expect(await run(p, { op: 'path.add', anchors })).toMatchObject({ name: 'Path 1' });
        panels.push(await panelState(p));
      },
    });
    expect(drawn).toHaveLength(3);
    expect(api.paths).toHaveLength(1);
    expect(api.history.undo).toEqual(['New Document', 'Add Path']);
    expect(panels).toEqual([{ names: ['Path 1'], selected: 0 }, { names: ['Path 1'], selected: 0 }]);
  });

  test('path.stroke matches the Paths panel\'s Stroke Path dialog with a typed width', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => selectionToPath(p, 30, 30, 150, 110),
      viaUi: async (p) => {
        await showPathsPanel(p);
        await p.getByRole('button', { name: 'Stroke Path', exact: true }).click();
        const dialog = p.getByRole('dialog', { name: 'Stroke Path' });
        await dialog.locator('input[type="number"]').fill('6');
        await dialog.getByRole('button', { name: 'Stroke', exact: true }).click();
        await settle(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'path.stroke', width: 6 })).toMatchObject({ width: 6 });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Stroke Path');
  });

  test('path.stroke clamps a width over 50 as the dialog does, and the result matches', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => selectionToPath(p, 30, 30, 150, 110),
      viaUi: async (p) => {
        await showPathsPanel(p);
        await p.getByRole('button', { name: 'Stroke Path', exact: true }).click();
        const dialog = p.getByRole('dialog', { name: 'Stroke Path' });
        await dialog.locator('input[type="number"]').fill('80');
        await dialog.getByRole('button', { name: 'Stroke', exact: true }).click();
        await settle(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'path.stroke', width: 50 })).toMatchObject({ width: 50 });
      },
    });
  });

  test('path.select matches a click on a path row in the Paths panel', async ({ page }) => {
    const panels: Array<{ names: string[]; selected: number }> = [];
    await compareUiAndApi(page, {
      setup: twoOverlappingPaths,
      viaUi: async (p) => {
        await pathRow(await showPathsPanel(p), 0).click();
        await settle(p);
        panels.push(await panelState(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'path.select', path: 'Path 1' });
        panels.push(await panelState(p));
      },
    });
    expect(panels).toEqual([{ names: ['Path 1', 'Path 2'], selected: 0 }, { names: ['Path 1', 'Path 2'], selected: 0 }]);
  });

  test('path.remove matches the Paths panel\'s Delete Path button', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: twoOverlappingPaths,
      viaUi: async (p) => {
        await showPathsPanel(p);
        await p.getByRole('button', { name: 'Delete Path', exact: true }).click();
        await settle(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'path.remove', path: 'Path 2' })).toMatchObject({ name: 'Path 2' });
      },
    });
    expect(api.paths).toHaveLength(1);
    expect(api.history.undo.at(-1)).toBe('Delete Path');
  });

  const BOOLEANS = [
    ['Unite Paths', 'path.unite', 1],
    ['Subtract Paths', 'path.subtract', 1],
    ['Intersect Paths', 'path.intersect', 1],
    ['Exclude Paths', 'path.exclude', 2],
  ] as const;

  for (const [item, op, count] of BOOLEANS) {
    test(`${op} matches Path > ${item} on two overlapping paths`, async ({ page }) => {
      const panels: Array<{ names: string[]; selected: number }> = [];
      const { api } = await compareUiAndApi(page, {
        setup: twoOverlappingPaths,
        viaUi: async (p) => {
          await clickMenu(p, 'Path', item);
          await settle(p);
          panels.push(await panelState(p));
        },
        viaApi: async (p) => {
          expect((await run<{ paths: unknown[] }>(p, { op })).paths).toHaveLength(count);
          panels.push(await panelState(p));
        },
      });
      expect(api.paths).toHaveLength(count);
      expect(api.history.undo.at(-1)).toBe(item);
      expect(panels[1]).toEqual(panels[0]);
    });
  }

  test('the boolean commands refuse with too few paths, no selected path, or an empty result, where the menu does nothing', async ({ page }) => {
    await freshDocument(page);
    expect(await runError(page, { op: 'path.unite' })).toEqual({
      code: 'refused', message: 'A boolean path operation needs two paths; the document has 0.',
    });
    await selectionToPath(page, 10, 10, 50, 50);
    await selectionToPath(page, 120, 80, 180, 140);
    const before = await historyLabels(page);
    expect(await runError(page, { op: 'path.intersect' })).toEqual({
      code: 'refused', message: 'Intersect Paths: the result has no area, so the paths are unchanged.',
    });
    await run(page, { op: 'path.select' });
    expect((await runError(page, { op: 'path.subtract' })).message).toMatch(/^No path is selected/);
    expect(await historyLabels(page)).toEqual(before);
    expect((await surfaceState(page)).pathCount).toBe(2);
  });

  test('path.rename renames with "Rename Path" (no UI control does this)', async ({ page }) => {
    await freshDocument(page);
    const { id } = await run<{ id: string }>(page, { op: 'path.add', anchors: [{ point: { x: 10, y: 10 } }, { point: { x: 90, y: 60 } }] });
    expect(await run(page, { op: 'path.rename', path: id, name: 'Outline' })).toEqual({ id, name: 'Outline' });
    await expect((await showPathsPanel(page)).getByRole('option')).toHaveText(['Outline']);
    expect(await historyLabels(page)).toEqual(['New Document', 'Add Path', 'Rename Path']);
    expect(await runError(page, { op: 'path.rename', path: 'Outline', name: 'Outline' })).toEqual({
      code: 'refused', message: 'The path is already named "Outline".',
    });
    expect((await runError(page, { op: 'path.remove', path: 'Path 9' })).code).toBe('not-found');
  });

  /** A closed curve: a lens from (40, 75) to (160, 75), bulging 40 px up and down. */
  const LENS = [
    { point: { x: 40, y: 75 }, handleIn: { x: 40, y: 115 }, handleOut: { x: 40, y: 35 } },
    { point: { x: 160, y: 75 }, handleIn: { x: 160, y: 35 }, handleOut: { x: 160, y: 115 } },
  ];

  test('path.to-selection matches the Paths panel\'s Path to Selection button on a curved path', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await run(p, { op: 'path.add', anchors: LENS, closed: true });
      },
      viaUi: async (p) => {
        await showPathsPanel(p);
        await p.getByRole('button', { name: 'Path to Selection', exact: true }).click();
        await settle(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'path.to-selection' })).toMatchObject({ name: 'Path 1' });
      },
    });
    expect(api.selection.active).toBe(true);
    expect(api.history.undo).toEqual(['New Document', 'Add Path', 'Path to Selection']);
  });

  test('path.to-selection then paint.fill fills the curve, and refuses with no path selected', async ({ page }) => {
    await freshDocument(page);
    const { id } = await run<{ id: string }>(page, { op: 'path.add', anchors: LENS, closed: true });
    await run(page, { op: 'path.select' });
    expect((await runError(page, { op: 'path.to-selection' })).message).toBe('No path is selected: pass path, or select one with path.select.');
    await run(page, [
      { op: 'path.to-selection', path: id },
      { op: 'color.set', foreground: '#ff0000' },
      { op: 'paint.fill' },
    ]);
    const at = async (x: number, y: number) => (await run<{ hex: string }>(page, { op: 'view.sample', x, y })).hex;
    // The bezier bulges about 30 px each way at the middle, so (100, 50) is inside and (100, 20) and the corner (45, 50) outside.
    expect([await at(100, 75), await at(100, 50), await at(100, 100)]).toEqual(['#ff0000', '#ff0000', '#ff0000']);
    expect([await at(100, 20), await at(100, 130), await at(45, 50), await at(10, 75)]).toEqual(['#ffffff', '#ffffff', '#ffffff', '#ffffff']);
    expect((await historyLabels(page)).slice(-2)).toEqual(['Path to Selection', 'Fill']);
  });

  test('path.stroke refuses a group with the dialog\'s toast text, and no selected path', async ({ page }) => {
    await freshDocument(page);
    expect((await runError(page, { op: 'path.stroke' })).message).toBe('No path is selected: pass path, or select one with path.select.');
    await selectionToPath(page, 30, 30, 150, 110);
    await clickMenu(page, 'Layer', 'Group Layers');
    await settle(page);
    await showPathsPanel(page);
    await page.getByRole('button', { name: 'Stroke Path', exact: true }).click();
    await page.getByRole('dialog', { name: 'Stroke Path' }).getByRole('button', { name: 'Stroke', exact: true }).click();
    await settle(page);
    const uiToasts = await toasts(page);
    const history = await historyLabels(page);
    expect(await runError(page, { op: 'path.stroke' })).toEqual({ code: 'refused', message: uiToasts[0] });
    expect(await historyLabels(page)).toEqual(history);
  });
});

test.describe('the rulers and Edit > Clear Guides, and the guide commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the rulers and menu bar need the desktop layout');
  });

  test('guide.add at the position a top-ruler click produced matches the click', async ({ page }) => {
    let clicked: Array<{ orientation: string; position: number }> = [];
    const { api } = await compareUiAndApi(page, {
      viaUi: async (p) => {
        await rulerClick(p, 60);
        clicked = await guidePositions(p);
      },
      viaApi: async (p) => {
        const [guide] = clicked;
        expect(await run(p, { op: 'guide.add', orientation: guide!.orientation, position: guide!.position })).toMatchObject(guide!);
      },
    });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.orientation).toBe('vertical');
    expect(api.guides).toEqual(clicked);
    expect(api.history.undo).toEqual(['New Document']);
  });

  test('guide.clear matches Edit > Clear Guides', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await rulerClick(p, 60);
        await rulerClick(p, 140);
      },
      viaUi: async (p) => {
        await clickMenu(p, 'Edit', 'Clear Guides');
        await settle(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'guide.clear' })).toEqual({ removed: 2 });
      },
    });
    expect(api.guides).toEqual([]);
  });

  test('guide.remove takes a guide off as a click on it in the ruler does', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => {
        await rulerClick(p, 60);
        await rulerClick(p, 140);
      },
      viaUi: async (p) => rulerClick(p, 60),
      viaApi: async (p) => {
        const [first] = await guidePositions(p);
        await run(p, { op: 'guide.remove', orientation: first!.orientation, position: first!.position });
      },
    });
  });

  test('guide.clear refuses with no guides, and guide.remove reports a guide that is not there', async ({ page }) => {
    await freshDocument(page);
    expect(await runError(page, { op: 'guide.clear' })).toEqual({ code: 'refused', message: 'There are no guides to clear.' });
    expect((await runError(page, { op: 'guide.remove', guide: 'nope' })).code).toBe('not-found');
    expect((await runError(page, { op: 'guide.remove', orientation: 'vertical' })).code).toBe('invalid');
  });
});
