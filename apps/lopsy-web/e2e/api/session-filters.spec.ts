/**
 * The on-canvas session filters (src/commands/filter/session-filters.ts):
 * filter.mesh-warp against the Move tool's Mesh Warp controls with a real
 * drag of a grid point, and filter.tilt-shift against Filter > Tilt-Shift
 * Blur... with its slider, then each on its own for the pixels it moves and
 * every refusal.
 *
 * Documents are 200x150 with a white Background. Layer 1 holds black
 * vertical stripes 10 px wide every 20 px (x 0..10, 20..30, ...), drawn with
 * commands.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { docToScreen } from '../helpers';
import { clickMenu, historyLabels, settle, toasts } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';

const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

interface Sample {
  hex: string;
  alpha: number;
}

interface MeshSession {
  grid: { cols: number; rows: number; points: Array<{ x: number; y: number }> };
  bounds: { x: number; y: number; width: number; height: number };
}

interface TiltSession {
  focusPosition: number;
  focusWidth: number;
  blurRadius: number;
  angle: number;
}

async function stripes(page: Page): Promise<void> {
  const steps: Array<Record<string, unknown> & { op: string }> = [{ op: 'color.set', foreground: '#000000' }];
  for (let x = 0; x < 200; x += 20) steps.push({ op: 'select.rect', x, y: 0, width: 10, height: 150, mode: x === 0 ? 'replace' : 'add' });
  steps.push({ op: 'paint.fill' }, { op: 'select.none' });
  await run(page, steps);
}

async function freshDocument(page: Page): Promise<void> {
  await run(page, { op: 'doc.new', width: 200, height: 150 });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
  await stripes(page);
}

async function sample(page: Page, x: number, y: number): Promise<string> {
  return (await run<Sample>(page, { op: 'view.sample', x, y })).hex;
}

async function readMeshSession(page: Page): Promise<MeshSession> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, { getState: () => { meshWarp: MeshSession | null } }>).__uiStore!;
    const session = ui.getState().meshWarp;
    if (!session) throw new Error('no Mesh Warp session');
    return { grid: session.grid, bounds: session.bounds };
  });
}

async function readTiltSession(page: Page): Promise<TiltSession> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, { getState: () => { tiltShift: TiltSession | null } }>).__uiStore!;
    const session = ui.getState().tiltShift;
    if (!session) throw new Error('no Tilt-Shift session');
    const { focusPosition, focusWidth, blurRadius, angle } = session;
    return { focusPosition, focusWidth, blurRadius, angle };
  });
}

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

test.describe('filter.mesh-warp and the Move tool\'s Mesh Warp controls', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the options bar and menus need the desktop layout');
  });

  test('warps the pixels round a moved point, leaving the grid\'s edge in place, as one "Mesh Warp" step', async ({ page }) => {
    await freshDocument(page);
    expect([await sample(page, 107, 75), await sample(page, 117, 75)]).toEqual(['#000000', '#ffffff']);
    const before = await historyLabels(page);
    const result = await run(page, { op: 'filter.mesh-warp', gridSize: 3, points: [{ col: 1, row: 1, dx: 15, dy: 0 }] });
    expect(result).toMatchObject({ target: 'pixels', bounds: { x: 0, y: 0, width: 200, height: 150 } });
    // The stripe at x 100..110 follows the centre point (100, 75) about 15 px to the right; the top edge does not move.
    expect([await sample(page, 107, 75), await sample(page, 117, 75)]).toEqual(['#ffffff', '#000000']);
    expect([await sample(page, 107, 0), await sample(page, 117, 0)]).toEqual(['#000000', '#ffffff']);
    expect(await historyLabels(page)).toEqual([...before, 'Mesh Warp']);
  });

  test('with a selection, a point dragged on the canvas and Apply match the command replaying the drag\'s offset', async ({ page }) => {
    let session: MeshSession | null = null;
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await stripes(p);
        await run(p, { op: 'select.rect', x: 40, y: 30, width: 120, height: 90 });
      },
      viaUi: async (p) => {
        await pressKey(p, 'v');
        await p.getByRole('button', { name: 'Activate mesh warp' }).click();
        const { bounds } = await readMeshSession(p);
        const handle = { x: bounds.x + bounds.width / 3, y: bounds.y + bounds.height / 3 };
        await dragDoc(p, handle, { x: handle.x + 22, y: handle.y + 14 });
        session = await readMeshSession(p);
        await p.getByRole('group', { name: 'Mesh warp controls' }).getByRole('button', { name: 'Apply', exact: true }).click();
        await settle(p, 300);
      },
      viaApi: async (p) => {
        if (!session) throw new Error('the UI side recorded no session');
        const { grid, bounds } = session;
        const points = grid.points.flatMap((point, index) => {
          const col = index % grid.cols;
          const row = Math.floor(index / grid.cols);
          const dx = (point.x - col / (grid.cols - 1)) * bounds.width;
          const dy = (point.y - row / (grid.rows - 1)) * bounds.height;
          return dx === 0 && dy === 0 ? [] : [{ col, row, dx, dy }];
        });
        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ col: 1, row: 1 });
        expect(await run(p, { op: 'filter.mesh-warp', gridSize: grid.cols, points })).toMatchObject({ bounds });
      },
    });
    expect(session!.bounds).toEqual({ x: 40, y: 30, width: 120, height: 90 });
    expect(api.history.undo.at(-1)).toBe('Mesh Warp');
  });

  test('refuses a text layer with the toast the controls show, and a group', async ({ page }) => {
    await freshDocument(page);
    await run(page, { op: 'text.add', x: 30, y: 60, text: 'Hi' });
    const before = await historyLabels(page);
    expect(await runError(page, { op: 'filter.mesh-warp' })).toEqual({ code: 'refused', message: TEXT_REFUSAL });
    await run(page, { op: 'layer.add-group' });
    expect(await runError(page, { op: 'filter.mesh-warp' })).toEqual({ code: 'refused', message: GROUP_REFUSAL });
    expect(await historyLabels(page)).toEqual(before);
    await run(page, { op: 'layer.select', layer: 'Hi' });
    await pressKey(page, 'v');
    await page.getByRole('button', { name: 'Activate mesh warp' }).click();
    expect(await toasts(page)).toContain(TEXT_REFUSAL);
  });

  test('refuses while a session is open', async ({ page }) => {
    await freshDocument(page);
    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');
    await settle(page);
    expect(await runError(page, { op: 'filter.mesh-warp' })).toEqual({
      code: 'refused',
      message: 'A Tilt-Shift session is open, and it would take the press instead of the tool: apply or cancel it first.',
    });
    expect((await runError(page, { op: 'filter.tilt-shift' })).message).toMatch(/^A Tilt-Shift session is open/);
  });
});

test.describe('filter.tilt-shift and Filter > Tilt-Shift Blur...', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menus need the desktop layout');
  });

  test('keeps the band sharp and blurs the rest, as one "Tilt-Shift Blur" step with no session left open', async ({ page }) => {
    await freshDocument(page);
    const before = await historyLabels(page);
    expect(await run(page, { op: 'filter.tilt-shift', focusPosition: 0.15, focusWidth: 0.2, blurRadius: 16 })).toMatchObject({ target: 'pixels' });
    // focusPosition 0.15 at angle 0: the band is near the top.
    expect(await sample(page, 5, 22)).toBe('#000000');
    expect(await sample(page, 5, 140)).not.toBe('#000000');
    expect(await historyLabels(page)).toEqual([...before, 'Tilt-Shift Blur']);
    const open = await page.evaluate(() => (window as unknown as Record<string, { getState: () => { tiltShift: unknown } }>).__uiStore!.getState().tiltShift);
    expect(open).toBeNull();
  });

  test('at angle 90 the band is vertical, and focusPosition 0 is the right edge', async ({ page }) => {
    await freshDocument(page);
    await run(page, { op: 'filter.tilt-shift', focusPosition: 0.15, focusWidth: 0.2, blurRadius: 16, angle: 90 });
    expect(await sample(page, 165, 75)).toBe('#000000');
    expect(await sample(page, 25, 75)).not.toBe('#000000');
  });

  test('the session with its Blur Radius slider set by keyboard and Apply matches the command with the session\'s values', async ({ page }) => {
    let values: TiltSession | null = null;
    const { api } = await compareUiAndApi(page, {
      setup: stripes,
      viaUi: async (p) => {
        await clickMenu(p, 'Filter', 'Tilt-Shift Blur...');
        await settle(p);
        const dialog = p.getByRole('dialog', { name: 'Tilt-Shift Blur' });
        await dialog.getByRole('slider', { name: 'Blur radius' }).focus();
        for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowRight');
        await settle(p);
        values = await readTiltSession(p);
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await settle(p, 300);
      },
      viaApi: async (p) => {
        if (!values) throw new Error('the UI side recorded no values');
        await run(p, { op: 'filter.tilt-shift', ...values });
      },
    });
    expect(values).toEqual({ focusPosition: 0.5, focusWidth: 0.4, blurRadius: 18, angle: 0 });
    expect(api.history.undo.at(-1)).toBe('Tilt-Shift Blur');
  });

  test('refuses layer-mask edit mode, a group with the menu\'s toast, and a text layer', async ({ page }) => {
    await freshDocument(page);
    await run(page, { op: 'mask.add' });
    expect((await runError(page, { op: 'filter.tilt-shift' })).message).toBe(
      'Tilt-Shift Blur writes the layer\'s pixels, and Filter > Tilt-Shift Blur... is disabled in layer-mask edit mode: leave it first (mask.edit with enabled: false).',
    );
    await run(page, { op: 'mask.edit', enabled: false });
    await run(page, { op: 'text.add', x: 30, y: 60, text: 'Hi' });
    expect(await runError(page, { op: 'filter.tilt-shift' })).toEqual({ code: 'refused', message: TEXT_REFUSAL });
    await run(page, { op: 'layer.add-group' });
    const before = await historyLabels(page);
    expect(await runError(page, { op: 'filter.tilt-shift' })).toEqual({ code: 'refused', message: GROUP_REFUSAL });
    expect(await historyLabels(page)).toEqual(before);
    await clickMenu(page, 'Filter', 'Tilt-Shift Blur...');
    await settle(page);
    expect(await toasts(page)).toContain(GROUP_REFUSAL);
  });
});
