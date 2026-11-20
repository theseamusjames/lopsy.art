/**
 * paint.stroke with the spray tool (src/commands/paint/stroke.ts). Spray
 * scatters random dots, so these specs assert where paint may and must
 * land, how much of it there is, and the history, not exact pixels. The
 * one exact comparison with the mouse pins Math.random on both sides.
 *
 * Documents are 300x200 with a white Background and an empty Layer 1, which
 * the strokes paint in opaque red.
 */
import { test, expect, run, runError, compareUiAndApi, gpuMaskHash, type Page } from './harness';
import { docToScreen } from '../helpers';
import { clickMenu, historyLabels, settle, toasts } from '../surface-helpers';
import { pressKey } from '../surface-helpers-keys';
import { docPixelHash } from '../surface-helpers-filters';

interface Point {
  x: number;
  y: number;
}

interface StrokeResult {
  tool: string;
  layer: string;
  line: boolean;
}

const WIDTH = 300;
const HEIGHT = 200;
/** The Size the specs spray with: dots land within 30 px of the pointer. */
const SIZE = 60;
/** A dot is at most 12% of the radius across (4 px here), plus its soft edge. */
const REACH = SIZE / 2 + 6;

async function freshDocument(page: Page): Promise<void> {
  await run(page, { op: 'doc.new', width: WIDTH, height: HEIGHT });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
  await sprayOptions(page, {});
}

async function sprayOptions(page: Page, options: Record<string, number>): Promise<void> {
  await run(page, [
    { op: 'color.set', foreground: '#ff0000' },
    { op: 'tool.set', tool: 'spray', options: { size: SIZE, density: 20, opacity: 100, softness: 0, ...options } },
  ]);
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

/** The pixels of Layer 1 that hold paint, in document space, each with its alpha. */
async function painted(page: Page): Promise<Array<Point & { alpha: number }>> {
  const id = await layerId(page, 'Layer 1');
  return page.evaluate(async ({ layer, width, height }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    const read = await (w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)(layer);
    const at = store.getState().document.layers.find((l) => l.id === layer)!;
    const out: Array<{ x: number; y: number; alpha: number }> = [];
    if (!read) return out;
    for (let y = 0; y < read.height; y++) {
      for (let x = 0; x < read.width; x++) {
        const alpha = read.pixels[(y * read.width + x) * 4 + 3] ?? 0;
        const dx = x + at.x;
        const dy = y + at.y;
        if (alpha > 0 && dx >= 0 && dy >= 0 && dx < width && dy < height) out.push({ x: dx, y: dy, alpha });
      }
    }
    return out;
  }, { layer: id, width: WIDTH, height: HEIGHT });
}

function distanceToPath(p: Point, path: readonly Point[]): number {
  const centre = { x: p.x + 0.5, y: p.y + 0.5 };
  if (path.length === 1) return Math.hypot(centre.x - path[0]!.x, centre.y - path[0]!.y);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((centre.x - a.x) * (b.x - a.x) + (centre.y - a.y) * (b.y - a.y)) / lengthSq));
    best = Math.min(best, Math.hypot(centre.x - (a.x + t * (b.x - a.x)), centre.y - (a.y + t * (b.y - a.y))));
  }
  return best;
}

async function spray(page: Page, points: readonly Point[], params: Record<string, unknown> = {}): Promise<StrokeResult> {
  const result = await run<StrokeResult>(page, { op: 'paint.stroke', tool: 'spray', points, ...params });
  await settle(page, 200);
  return result;
}

test.describe('paint.stroke with the spray tool', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await freshDocument(page);
  });

  test('a click scatters dots within the spray\'s size, as one "Spray" step', async ({ page }) => {
    const id = await layerId(page, 'Layer 1');
    const before = await docPixelHash(page, id);
    const history = await historyLabels(page);
    const at = { x: 150, y: 100 };
    expect(await spray(page, [at])).toEqual({ tool: 'spray', layer: id, line: false });

    const dots = await painted(page);
    expect(dots.length).toBeGreaterThan(40);
    expect(Math.max(...dots.map((p) => distanceToPath(p, [at])))).toBeLessThanOrEqual(REACH);
    // The dots are the foreground red, each at its own strength, over the white Background.
    const strongest = dots.reduce((a, b) => (b.alpha > a.alpha ? b : a));
    const { hex } = await run<{ hex: string }>(page, { op: 'view.sample', x: strongest.x, y: strongest.y });
    expect(hex).toMatch(/^#ff([0-9a-f]{2})\1$/);
    expect(hex).not.toBe('#ffffff');
    expect(await historyLabels(page)).toEqual([...history, 'Spray']);

    await run(page, { op: 'history.undo' });
    expect(await docPixelHash(page, id)).toBe(before);
  });

  test('a drag sprays all the way along its path and nowhere else, in one step', async ({ page }) => {
    const history = await historyLabels(page);
    const path = [{ x: 50, y: 60 }, { x: 150, y: 60 }, { x: 250, y: 140 }];
    await spray(page, path);
    const dots = await painted(page);
    expect(Math.max(...dots.map((p) => distanceToPath(p, path)))).toBeLessThanOrEqual(REACH);
    // Every 25 px stretch of the path has paint within the spray's radius of it.
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const pieces = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 25);
      for (let k = 0; k < pieces; k++) {
        const from = { x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces };
        const to = { x: a.x + ((b.x - a.x) * (k + 1)) / pieces, y: a.y + ((b.y - a.y) * (k + 1)) / pieces };
        expect(dots.some((p) => distanceToPath(p, [from, to]) <= SIZE / 2), `near (${from.x}, ${from.y})-(${to.x}, ${to.y})`).toBe(true);
      }
    }
    expect(await historyLabels(page)).toEqual([...history, 'Spray']);
  });

  test('dwell holds the pointer still while the spray builds up, then stops it', async ({ page }) => {
    const id = await layerId(page, 'Layer 1');
    const at = { x: 150, y: 100 };
    await spray(page, [at]);
    const instant = (await painted(page)).length;
    await run(page, { op: 'history.undo' });

    const history = await historyLabels(page);
    const started = Date.now();
    await spray(page, [at], { dwell: 1000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    const dots = await painted(page);
    // The press's burst and one more about every 166 ms: several times the dots of a click.
    expect(dots.length).toBeGreaterThan(instant * 2.5);
    expect(Math.max(...dots.map((p) => distanceToPath(p, [at])))).toBeLessThanOrEqual(REACH);
    expect(await historyLabels(page)).toEqual([...history, 'Spray']);

    // The release stopped the spray's timer: nothing more lands.
    const after = await docPixelHash(page, id);
    await page.waitForTimeout(600);
    expect(await docPixelHash(page, id)).toBe(after);
  });

  test('dwell applies at every point of a drag', async ({ page }) => {
    const path = [{ x: 60, y: 100 }, { x: 150, y: 100 }, { x: 240, y: 100 }];
    await spray(page, path);
    const near = (dots: readonly Point[], at: Point): number => dots.filter((p) => distanceToPath(p, [at]) <= SIZE / 2).length;
    const instant = await painted(page);
    await run(page, { op: 'history.undo' });
    await spray(page, path, { dwell: 700 });
    const held = await painted(page);
    for (const at of path) expect(near(held, at), `at (${at.x}, ${at.y})`).toBeGreaterThan(near(instant, at) * 1.3);
    expect(Math.max(...held.map((p) => distanceToPath(p, path)))).toBeLessThanOrEqual(REACH);
  });

  test('reads the Spray options set with tool.set', async ({ page }) => {
    const at = { x: 150, y: 100 };
    await sprayOptions(page, { density: 1 });
    await spray(page, [at]);
    const sparse = (await painted(page)).length;
    await run(page, { op: 'history.undo' });
    await sprayOptions(page, { density: 100, size: 120 });
    await spray(page, [at]);
    const dense = await painted(page);
    expect(sparse).toBeGreaterThan(0);
    expect(dense.length).toBeGreaterThan(sparse * 10);
    // A size of 120 scatters out to 60 px, with dots up to 7 px in radius.
    const far = Math.max(...dense.map((p) => distanceToPath(p, [at])));
    expect(far).toBeGreaterThan(SIZE / 2);
    expect(far).toBeLessThanOrEqual(70);
  });

  test('in layer-mask edit mode it paints the mask, as "Mask Paint"', async ({ page }) => {
    const id = await layerId(page, 'Layer 1');
    await run(page, [{ op: 'select.all' }, { op: 'paint.fill' }, { op: 'select.none' }, { op: 'mask.add' }]);
    const pixels = await docPixelHash(page, id);
    const mask = await gpuMaskHash(page, id);
    const history = await historyLabels(page);
    await spray(page, [{ x: 150, y: 100 }], { dwell: 300 });
    expect(await historyLabels(page)).toEqual([...history, 'Mask Paint']);
    expect(await docPixelHash(page, id)).toBe(pixels);
    expect(await gpuMaskHash(page, id)).not.toBe(mask);
  });
});

test.describe('paint.stroke spray refusals', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the toolbox needs the desktop layout');
    await freshDocument(page);
  });

  const AT = [{ x: 150, y: 100 }];

  test('invalid params: dwell out of range or on another tool, and line', async ({ page }) => {
    const invalid = async (params: Record<string, unknown>): Promise<string> => {
      const error = await runError(page, { op: 'paint.stroke', points: AT, ...params });
      expect(error.code, JSON.stringify(params)).toBe('invalid');
      return error.message;
    };
    const history = await historyLabels(page);
    await invalid({ tool: 'spray', dwell: -1 });
    await invalid({ tool: 'spray', dwell: 2001 });
    await invalid({ tool: 'spray', dwell: 10.5 });
    expect(await invalid({ tool: 'brush', dwell: 100 })).toBe('paint.stroke: dwell is only for the spray tool, which deposits while it is held still; a brush stroke is instantaneous.');
    expect(await invalid({ dwell: 100 })).toContain('dwell is only for the spray tool');
    expect(await invalid({ tool: 'spray', line: true })).toBe('paint.stroke: line is not for the spray tool, which has no Shift-click line: list the points to spray along instead.');
    const eleven = Array.from({ length: 11 }, (_, i) => ({ x: 20 + i * 20, y: 100 }));
    expect(await invalid({ tool: 'spray', points: eleven, dwell: 1000 })).toBe(
      'paint.stroke: a dwell of 1000 ms at each of 11 points is 11000 ms, more than the 10000 ms one stroke may rest: use fewer points or a shorter dwell.',
    );
    expect(await historyLabels(page)).toEqual(history);
    expect(await painted(page)).toEqual([]);
  });

  test('a locked layer, and a text layer with the toast the tool shows', async ({ page }) => {
    await run(page, { op: 'layer.set', locked: true });
    expect(await runError(page, { op: 'paint.stroke', tool: 'spray', points: AT, dwell: 200 })).toEqual({
      code: 'refused',
      message: '"Layer 1" is locked: unlock it to use the Spray tool on it.',
    });
    await run(page, [{ op: 'layer.set', locked: false }, { op: 'text.add', x: 30, y: 60, text: 'Hi' }]);
    const history = await historyLabels(page);
    const refusal = 'Text layers must be rasterized before they can be painted on.';
    expect(await runError(page, { op: 'paint.stroke', tool: 'spray', points: AT })).toEqual({ code: 'refused', message: refusal });
    expect(await historyLabels(page)).toEqual(history);
    expect(await painted(page)).toEqual([]);
    const screen = await docToScreen(page, 150, 100);
    await page.mouse.click(screen.x, screen.y);
    expect(await toasts(page)).toContain(refusal);
  });
});

test.describe('paint.stroke spray against the Spray tool and the mouse', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the toolbox needs the desktop layout');
  });

  /**
   * Pins the page's Math.random, the one source of the spray's scatter, so
   * the mouse and the command lay the same dots. With every draw the same,
   * each burst puts its dots on one spot, and a burst repeated where one
   * already landed changes nothing (a stroke keeps the strongest dab at each
   * pixel), so the bursts the hold timer adds on the mouse's side while
   * Playwright is between events do not show.
   */
  async function pinRandom(page: Page): Promise<void> {
    await page.evaluate(() => {
      Math.random = () => 0.37;
    });
  }

  async function setup(page: Page): Promise<void> {
    await clickMenu(page, 'View', 'Actual Size');
    await sprayOptions(page, {});
    await pinRandom(page);
  }

  async function dragThrough(page: Page, points: readonly Point[], holdMs = 0): Promise<void> {
    const [first, ...rest] = await Promise.all(points.map((p) => docToScreen(page, p.x, p.y)));
    await page.mouse.move(first!.x, first!.y);
    await page.mouse.down();
    if (holdMs > 0) await page.waitForTimeout(holdMs);
    for (const p of rest) {
      await page.mouse.move(p.x, p.y, { steps: 1 });
      if (holdMs > 0) await page.waitForTimeout(holdMs);
    }
    await page.mouse.up();
    await settle(page, 200);
  }

  test('a drag through the same points', async ({ page }) => {
    const points = [{ x: 60, y: 70 }, { x: 110, y: 90 }, { x: 170, y: 80 }, { x: 240, y: 130 }];
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup,
      viaUi: async (p) => {
        await pressKey(p, 'j');
        await dragThrough(p, points);
      },
      viaApi: async (p) => {
        await run(p, { op: 'paint.stroke', tool: 'spray', points });
        await settle(p, 200);
      },
    });
    expect(api.editor.tool).toBe('spray');
    expect(api.history.undo.at(-1)).toBe('Spray');
    expect(api.layers.find((l) => l.name === 'Layer 1')!.pixels).not.toBeNull();
  });

  test('a drag that lingers at every point, against the command with a dwell', async ({ page }) => {
    const points = [{ x: 80, y: 100 }, { x: 150, y: 100 }, { x: 220, y: 100 }];
    await compareUiAndApi(page, {
      withEditorState: true,
      setup,
      viaUi: async (p) => {
        await pressKey(p, 'j');
        await dragThrough(p, points, 400);
      },
      viaApi: async (p) => {
        await run(p, { op: 'paint.stroke', tool: 'spray', points, dwell: 400 });
        await settle(p, 200);
      },
    });
  });
});
