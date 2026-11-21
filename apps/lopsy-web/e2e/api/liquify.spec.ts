/**
 * filter.liquify (src/commands/filter/liquify.ts): the command opens the
 * Liquify session as Filter > Liquify... does, sets the panel's Mode, Brush
 * Size and Pressure for each stroke, drags the brush through the canvas
 * gesture dispatcher and presses Apply. These specs check the pixels it
 * moves, its one history step, that no session is left open, its refusals,
 * and that the same strokes made with the mouse leave the same document.
 *
 * Documents are 200x150 with a white Background. Layer 1 holds black
 * vertical stripes 10 px wide every 20 px (x 0..10, 20..30, ...), drawn with
 * commands.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { docToScreen } from '../helpers';
import { clickMenu, historyLabels, settle, toasts } from '../surface-helpers';
import { docPixelHash } from '../surface-helpers-filters';

const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

interface Point {
  x: number;
  y: number;
}

interface LiquifyResult {
  layer: string;
  target: string;
  strokes: number;
  dabs: number;
}

const WIDTH = 200;
const HEIGHT = 150;

async function stripes(page: Page): Promise<void> {
  const steps: Array<Record<string, unknown> & { op: string }> = [{ op: 'color.set', foreground: '#000000' }];
  for (let x = 0; x < WIDTH; x += 20) steps.push({ op: 'select.rect', x, y: 0, width: 10, height: HEIGHT, mode: x === 0 ? 'replace' : 'add' });
  steps.push({ op: 'paint.fill' }, { op: 'select.none' });
  await run(page, steps);
}

async function freshDocument(page: Page): Promise<void> {
  await run(page, { op: 'doc.new', width: WIDTH, height: HEIGHT });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
  await stripes(page);
}

async function layerId(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.name === n);
    if (!layer) throw new Error(`no layer ${n}`);
    return layer.id;
  }, name);
}

/** Layer 1's alpha over the document, row by row: 0 where it is clear, 255 inside a stripe. */
async function alpha(page: Page): Promise<number[][]> {
  const id = await layerId(page, 'Layer 1');
  return page.evaluate(async ({ layer, width, height }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    const read = await (w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)(layer);
    const at = store.getState().document.layers.find((l) => l.id === layer)!;
    const rows = Array.from({ length: height }, () => new Array<number>(width).fill(0));
    if (!read) return rows;
    for (let y = 0; y < read.height; y++) {
      for (let x = 0; x < read.width; x++) {
        const dx = x + at.x;
        const dy = y + at.y;
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        rows[dy]![dx] = read.pixels[(y * read.width + x) * 4 + 3] ?? 0;
      }
    }
    return rows;
  }, { layer: id, width: WIDTH, height: HEIGHT });
}

/** The stripes as drawn: opaque for x in 0..10, 20..30, and so on. */
function striped(x: number): number {
  return x % 20 < 10 ? 255 : 0;
}

/** The pixels that are no longer what the stripes had there, by more than a resampling edge would change. */
function changed(rows: number[][]): Point[] {
  const out: Point[] = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y]!.length; x++) {
      if (Math.abs(rows[y]![x]! - striped(x)) > 32) out.push({ x, y });
    }
  }
  return out;
}

function farthest(points: readonly Point[], from: Point): number {
  return Math.max(0, ...points.map((p) => Math.hypot(p.x + 0.5 - from.x, p.y + 0.5 - from.y)));
}

async function sessionOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as Record<string, { getState: () => { liquify: unknown } }>).__uiStore!.getState().liquify !== null);
}

async function activeTool(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as Record<string, { getState: () => { activeTool: string } }>).__uiStore!.getState().activeTool);
}

/** Points from `from` to `to` in steps of `step` px along x, as a slow drag delivers them. */
function sweep(from: Point, to: Point, step: number): Point[] {
  const points: Point[] = [];
  for (let x = from.x; x <= to.x; x += step) points.push({ x, y: from.y });
  return points;
}

function dwell(at: Point, dabs: number): Point[] {
  return Array.from({ length: dabs + 1 }, () => ({ ...at }));
}

async function liquify(page: Page, strokes: Array<Record<string, unknown>>): Promise<LiquifyResult> {
  const result = await run<LiquifyResult>(page, { op: 'filter.liquify', strokes });
  await settle(page, 200);
  return result;
}

test.describe('filter.liquify', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await freshDocument(page);
  });

  test('a push stroke shoves the pixels under the brush along the drag, as one "Liquify" step with no session left open', async ({ page }) => {
    const id = await layerId(page, 'Layer 1');
    const before = await docPixelHash(page, id);
    const history = await historyLabels(page);
    const tool = await activeTool(page);
    expect(changed(await alpha(page))).toEqual([]);

    const points = sweep({ x: 60, y: 75 }, { x: 100, y: 75 }, 4);
    const result = await liquify(page, [{ size: 40, pressure: 100, points }]);
    expect(result).toEqual({ layer: id, target: 'pixels', strokes: 1, dabs: points.length - 1 });

    const rows = await alpha(page);
    const moved = changed(rows);
    expect(moved.length).toBeGreaterThan(200);
    // Nothing moves outside the brush's reach: 20 px round the path from (60, 75) to (100, 75).
    for (const p of moved) {
      expect(Math.abs(p.y + 0.5 - 75), `(${p.x}, ${p.y})`).toBeLessThanOrEqual(21);
      expect(p.x, `(${p.x}, ${p.y})`).toBeGreaterThanOrEqual(39);
      expect(p.x, `(${p.x}, ${p.y})`).toBeLessThanOrEqual(121);
    }
    // Along the path the stripes are dragged to the right: the one at x 60..70 has left its place for x 78..87.
    expect(rows[75]!.slice(61, 77).every((a) => a < 64)).toBe(true);
    expect(rows[75]!.slice(79, 87).every((a) => a > 192)).toBe(true);
    expect(await historyLabels(page)).toEqual([...history, 'Liquify']);
    expect(await sessionOpen(page)).toBe(false);
    expect(await activeTool(page)).toBe(tool);

    await run(page, { op: 'history.undo' });
    expect(await docPixelHash(page, id)).toBe(before);
  });

  test('twirl, bloat and pinch work on one spot with every dab, each its own way, inside the brush only', async ({ page }) => {
    const id = await layerId(page, 'Layer 1');
    const at = { x: 100, y: 75 };
    const hashes: string[] = [];
    for (const mode of ['twirl-cw', 'twirl-ccw', 'bloat', 'pinch']) {
      const result = await liquify(page, [{ mode, size: 60, pressure: 60, points: dwell(at, 12) }]);
      expect(result.dabs).toBe(12);
      const moved = changed(await alpha(page));
      expect(moved.length, mode).toBeGreaterThan(100);
      expect(farthest(moved, at), mode).toBeLessThanOrEqual(31);
      hashes.push(await docPixelHash(page, id));
      await run(page, { op: 'history.undo' });
    }
    expect(new Set(hashes).size).toBe(4);
  });

  test('a larger brush reaches further, more pressure moves more, and more dabs add up', async ({ page }) => {
    const at = { x: 100, y: 75 };
    const reach = async (stroke: Record<string, unknown>): Promise<{ far: number; count: number }> => {
      await liquify(page, [{ mode: 'bloat', points: dwell(at, 6), ...stroke }]);
      const moved = changed(await alpha(page));
      await run(page, { op: 'history.undo' });
      return { far: farthest(moved, at), count: moved.length };
    };
    const small = await reach({ size: 30, pressure: 50 });
    const large = await reach({ size: 90, pressure: 50 });
    expect(small.count).toBeGreaterThan(0);
    expect(small.far).toBeLessThanOrEqual(16);
    expect(large.far).toBeGreaterThan(25);
    expect(large.far).toBeLessThanOrEqual(46);
    const light = await reach({ size: 60, pressure: 10 });
    const heavy = await reach({ size: 60, pressure: 100 });
    expect(light.count).toBeGreaterThan(0);
    expect(heavy.count).toBeGreaterThan(light.count * 2);
    const longer = await reach({ size: 60, pressure: 10, points: dwell(at, 40) });
    expect(longer.count).toBeGreaterThan(light.count * 2);
  });

  test('several strokes add up in one session and one history step', async ({ page }) => {
    const history = await historyLabels(page);
    const result = await liquify(page, [
      { mode: 'bloat', size: 50, pressure: 80, points: dwell({ x: 50, y: 40 }, 8) },
      { mode: 'pinch', size: 50, pressure: 80, points: dwell({ x: 150, y: 110 }, 8) },
    ]);
    expect(result).toMatchObject({ strokes: 2, dabs: 16 });
    const moved = changed(await alpha(page));
    expect(moved.some((p) => Math.hypot(p.x - 50, p.y - 40) < 25)).toBe(true);
    expect(moved.some((p) => Math.hypot(p.x - 150, p.y - 110) < 25)).toBe(true);
    expect(moved.every((p) => Math.hypot(p.x + 0.5 - 50, p.y + 0.5 - 40) <= 26 || Math.hypot(p.x + 0.5 - 150, p.y + 0.5 - 110) <= 26)).toBe(true);
    expect(await historyLabels(page)).toEqual([...history, 'Liquify']);
  });

  test('a gesture command works straight after it: the session is closed', async ({ page }) => {
    await liquify(page, [{ points: sweep({ x: 60, y: 75 }, { x: 80, y: 75 }, 4) }]);
    await run(page, [{ op: 'color.set', foreground: '#ff0000' }, { op: 'paint.stroke', points: [{ x: 20, y: 20 }, { x: 60, y: 20 }] }]);
    expect((await run<{ hex: string }>(page, { op: 'view.sample', x: 40, y: 20 })).hex).toBe('#ff0000');
  });
});

test.describe('filter.liquify refusals', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menus need the desktop layout');
    await freshDocument(page);
  });

  const STROKE = { points: [{ x: 60, y: 75 }, { x: 70, y: 75 }] };

  async function expectUntouched(page: Page, before: string, history: string[]): Promise<void> {
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    expect(await historyLabels(page)).toEqual(history);
    expect(await sessionOpen(page)).toBe(false);
  }

  test('invalid params', async ({ page }) => {
    const invalid = async (strokes: unknown): Promise<string> => {
      const error = await runError(page, { op: 'filter.liquify', strokes });
      expect(error.code, JSON.stringify(strokes)).toBe('invalid');
      return error.message;
    };
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    const history = await historyLabels(page);
    await invalid([]);
    expect(await invalid([{ points: [{ x: 10, y: 10 }] }])).toContain('strokes[0].points must be an array of 2 to 10000 items');
    await invalid([{ ...STROKE, mode: 'swirl' }]);
    await invalid([{ ...STROKE, size: 3 }]);
    await invalid([{ ...STROKE, size: 501 }]);
    await invalid([{ ...STROKE, pressure: 0 }]);
    await invalid([{ ...STROKE, pressure: 50.5 }]);
    await invalid([{ ...STROKE, strength: 50 }]);
    const many = Array.from({ length: 6001 }, () => ({ x: 60, y: 75 }));
    expect(await invalid([{ points: many }, { points: many }])).toBe(
      'filter.liquify: the strokes make 12000 dabs between them, more than the 10000 one call may apply: use fewer points, or apply and call again.',
    );
    expect((await runError(page, { op: 'filter.liquify' })).code).toBe('invalid');
    await expectUntouched(page, before, history);
  });

  test('a text layer and a group, with the toast the menu shows', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    await run(page, { op: 'text.add', x: 30, y: 60, text: 'Hi' });
    expect(await runError(page, { op: 'filter.liquify', strokes: [STROKE] })).toEqual({ code: 'refused', message: TEXT_REFUSAL });
    await run(page, { op: 'layer.add-group' });
    const history = await historyLabels(page);
    expect(await runError(page, { op: 'filter.liquify', strokes: [STROKE] })).toEqual({ code: 'refused', message: GROUP_REFUSAL });
    await expectUntouched(page, before, history);
    await clickMenu(page, 'Filter', 'Liquify...');
    await settle(page);
    expect(await toasts(page)).toContain(GROUP_REFUSAL);
    expect(await sessionOpen(page)).toBe(false);
  });

  test('layer-mask edit mode, where the menu item is disabled', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    await run(page, { op: 'mask.add' });
    const history = await historyLabels(page);
    expect(await runError(page, { op: 'filter.liquify', strokes: [STROKE] })).toEqual({
      code: 'refused',
      message: 'Liquify writes the layer\'s pixels, and Filter > Liquify... is disabled in layer-mask edit mode: leave it first (mask.edit with enabled: false).',
    });
    await expectUntouched(page, before, history);
  });

  test('a locked layer', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    await run(page, { op: 'layer.set', locked: true });
    const history = await historyLabels(page);
    expect(await runError(page, { op: 'filter.liquify', strokes: [STROKE] })).toEqual({
      code: 'refused',
      message: '"Layer 1" is locked: unlock it to liquify it (layer.set with locked: false).',
    });
    await expectUntouched(page, before, history);
  });

  test('while a session is open, and the open session still refuses every other gesture', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    const history = await historyLabels(page);
    await clickMenu(page, 'Filter', 'Liquify...');
    await settle(page);
    expect(await sessionOpen(page)).toBe(true);
    const open = 'A Liquify session is open, and it would take the press instead of the tool: apply or cancel it first.';
    expect(await runError(page, { op: 'filter.liquify', strokes: [STROKE] })).toEqual({ code: 'refused', message: open });
    expect(await runError(page, { op: 'paint.stroke', points: STROKE.points })).toEqual({ code: 'refused', message: open });
    expect(await runError(page, { op: 'tool.gesture', tool: 'brush', points: STROKE.points })).toEqual({ code: 'refused', message: open });
    // The session the person opened is still theirs: the refused command did not close it.
    expect(await sessionOpen(page)).toBe(true);
    await page.getByRole('dialog', { name: 'Liquify' }).getByRole('button', { name: 'Cancel' }).click();
    await settle(page);
    await expectUntouched(page, before, history);
  });
});

test.describe('filter.liquify against Filter > Liquify... and the mouse', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menus need the desktop layout');
  });

  /** One drag: a press at the first point, then one pointer move to each further point. */
  async function dragThrough(page: Page, points: readonly Point[]): Promise<void> {
    const [first, ...rest] = await Promise.all(points.map((p) => docToScreen(page, p.x, p.y)));
    await page.mouse.move(first!.x, first!.y);
    await page.mouse.down();
    for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 1 });
    await page.mouse.up();
    await settle(page);
  }

  /** Sets a panel slider with the arrow keys, as a person at the keyboard does. */
  async function setSlider(page: Page, name: string, from: number, to: number): Promise<void> {
    const slider = page.getByRole('dialog', { name: 'Liquify' }).getByRole('slider', { name });
    await slider.focus();
    for (let i = 0; i < Math.abs(to - from); i++) await page.keyboard.press(to > from ? 'ArrowRight' : 'ArrowLeft');
    await expect(slider).toHaveValue(String(to));
  }

  async function setup(page: Page): Promise<void> {
    await clickMenu(page, 'View', 'Actual Size');
    await stripes(page);
  }

  test('a push stroke with the brush size and pressure set in the panel', async ({ page }) => {
    const points = [{ x: 60, y: 70 }, { x: 66, y: 72 }, { x: 73, y: 75 }, { x: 81, y: 77 }, { x: 90, y: 78 }, { x: 98, y: 78 }];
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup,
      viaUi: async (p) => {
        await clickMenu(p, 'Filter', 'Liquify...');
        await settle(p);
        await setSlider(p, 'Brush size', 64, 48);
        await setSlider(p, 'Brush pressure', 50, 80);
        await dragThrough(p, points);
        await p.getByTestId('liquify-apply').click();
        await settle(p, 300);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'filter.liquify', strokes: [{ size: 48, pressure: 80, points }] })).toMatchObject({ strokes: 1, dabs: 5 });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Liquify');
  });

  test('a twirl worked into one spot, then a bloat stroke, in one session', async ({ page }) => {
    // A pointer that jitters about one spot: every move is a dab.
    const jitter = [{ x: 100, y: 75 }, { x: 101, y: 75 }, { x: 100, y: 76 }, { x: 99, y: 75 }, { x: 100, y: 74 }, { x: 100, y: 75 }, { x: 101, y: 76 }, { x: 100, y: 75 }];
    const swell = [{ x: 40, y: 40 }, { x: 42, y: 40 }, { x: 44, y: 41 }, { x: 46, y: 41 }, { x: 48, y: 42 }];
    await compareUiAndApi(page, {
      withEditorState: true,
      setup,
      viaUi: async (p) => {
        await clickMenu(p, 'Filter', 'Liquify...');
        await settle(p);
        const panel = p.getByRole('dialog', { name: 'Liquify' });
        await panel.getByRole('combobox', { name: 'Liquify mode' }).selectOption('twirl-cw');
        await dragThrough(p, jitter);
        await panel.getByRole('combobox', { name: 'Liquify mode' }).selectOption('bloat');
        await setSlider(p, 'Brush size', 64, 40);
        await dragThrough(p, swell);
        await p.getByTestId('liquify-apply').click();
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, {
          op: 'filter.liquify',
          strokes: [{ mode: 'twirl-cw', points: jitter }, { mode: 'bloat', size: 40, points: swell }],
        });
      },
    });
  });
});
