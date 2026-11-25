/**
 * layer.transform's rotate (any angle but ±90), scale, skew, distort and
 * perspective (src/commands/layer/transform.ts, transform-drag.ts): the
 * command drags the Move tool's transform handles through the canvas
 * gesture dispatcher, in the Move-options mode whose handles make the step.
 * These specs check the pixels it leaves against the geometry asked for,
 * its history, undo and its refusals. Comparisons with the same drag made
 * with the mouse are in layer-transform-drag-ui.spec.ts.
 */
import { test, expect, run, runError, type Page } from './harness';
import { settle } from '../surface-helpers';
import { clickMenu } from '../surface-helpers';
import { docPixelHash } from '../surface-helpers-filters';

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface TransformResult {
  layers: string[];
  rotate?: number;
  scale?: Point;
  skew?: Point;
  corners?: Record<string, Point>;
}

/** The block every test turns or scales: 60 × 40 px, centre (130, 90). */
const BLOCK = { x: 100, y: 70, width: 60, height: 40 };

async function newDoc(page: Page): Promise<void> {
  await run(page, { op: 'doc.new', width: 300, height: 200 });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

async function block(page: Page, rect: { x: number; y: number; width: number; height: number }, color = '#e0662a'): Promise<void> {
  await run(page, [
    { op: 'color.set', foreground: color },
    { op: 'select.rect', ...rect },
    { op: 'paint.fill' },
    { op: 'select.none', commit: true },
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

/** The layer's alpha in document space: a function from a pixel to 0-255, and the bounds of its pixels at alpha 128 or more. */
async function alphaMap(page: Page, name: string): Promise<{ alpha: (x: number, y: number) => number; bounds: Bounds | null }> {
  const id = await layerId(page, name);
  const read = await page.evaluate(async (layer) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { width: number; height: number; layers: Array<{ id: string; x: number; y: number }> } } };
    const pixels = await (w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)(layer);
    const doc = store.getState().document;
    const l = doc.layers.find((x) => x.id === layer)!;
    const out = new Array<number>(doc.width * doc.height).fill(0);
    if (pixels && pixels.width > 0) {
      for (let y = 0; y < pixels.height; y++) {
        for (let x = 0; x < pixels.width; x++) {
          const dx = x + l.x;
          const dy = y + l.y;
          if (dx < 0 || dy < 0 || dx >= doc.width || dy >= doc.height) continue;
          out[dy * doc.width + dx] = pixels.pixels[(y * pixels.width + x) * 4 + 3] ?? 0;
        }
      }
    }
    return { width: doc.width, height: doc.height, out };
  }, id);
  const alpha = (x: number, y: number): number => (x < 0 || y < 0 || x >= read.width || y >= read.height ? 0 : read.out[y * read.width + x] ?? 0);
  let bounds: Bounds | null = null;
  for (let y = 0; y < read.height; y++) {
    for (let x = 0; x < read.width; x++) {
      if (alpha(x, y) < 128) continue;
      bounds = bounds
        ? { minX: Math.min(bounds.minX, x), minY: Math.min(bounds.minY, y), maxX: Math.max(bounds.maxX, x), maxY: Math.max(bounds.maxY, y) }
        : { minX: x, minY: y, maxX: x, maxY: y };
    }
  }
  return { alpha, bounds };
}

/** The pixels whose centres a shape covers, from its corners: the bounds a pixel-centre test gives, within a pixel. */
function expectBounds(actual: Bounds | null, corners: readonly Point[]): void {
  expect(actual).not.toBeNull();
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const expected = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs) - 1, maxY: Math.max(...ys) - 1 };
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(Math.abs(actual![key] - expected[key]), `${key}: ${actual![key]} against ${expected[key]}`).toBeLessThanOrEqual(1);
  }
}

function turn(p: Point, centre: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { x: centre.x + dx * Math.cos(a) - dy * Math.sin(a), y: centre.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

function corners(rect: { x: number; y: number; width: number; height: number }): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

async function labels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { undoStack: Array<{ label: string }> } };
    return store.getState().undoStack.map((e) => e.label);
  });
}

async function selectionActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { selection: { active: boolean } } };
    return store.getState().selection.active;
  });
}

/** The Move options' transform modes: the shared box's, and a text layer's own. */
async function modes(page: Page): Promise<{ box: string; text: string }> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { layerTransformMode: string; textTransformMode: string } };
    return { box: ui.getState().layerTransformMode, text: ui.getState().textTransformMode };
  });
}

/** Whether `p` is inside the convex quad `quad` (corners in order) and `margin` px or more from every edge; a negative margin grows the quad. */
function insideQuad(p: Point, quad: readonly Point[], margin: number): boolean {
  let area = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % quad.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  const winding = Math.sign(area);
  return quad.every((a, i) => {
    const b = quad[(i + 1) % quad.length]!;
    const distance = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    return distance * winding >= margin;
  });
}

/**
 * Every pixel centre well inside `quad` is opaque and every one well outside
 * it is clear: the layer's pixels fill the quad and nothing else.
 */
function expectFills(alpha: (x: number, y: number) => number, quad: readonly Point[], size = { width: 300, height: 200 }): void {
  const wrong: string[] = [];
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const centre = { x: x + 0.5, y: y + 0.5 };
      if (insideQuad(centre, quad, 2)) {
        if (alpha(x, y) !== 255) wrong.push(`(${x}, ${y}) inside is ${alpha(x, y)}`);
      } else if (!insideQuad(centre, quad, -2) && alpha(x, y) !== 0) {
        wrong.push(`(${x}, ${y}) outside is ${alpha(x, y)}`);
      }
    }
  }
  expect(wrong.slice(0, 10)).toEqual([]);
}

/** The projective map that takes `rect`'s corners onto `quad` (clockwise from the top-left). */
function projection(rect: { x: number; y: number; width: number; height: number }, quad: readonly [Point, Point, Point, Point]): (p: Point) => Point {
  const [tl, tr, br, bl] = quad;
  const sx = tl.x - tr.x + br.x - bl.x;
  const sy = tl.y - tr.y + br.y - bl.y;
  const dx1 = tr.x - br.x;
  const dx2 = bl.x - br.x;
  const dy1 = tr.y - br.y;
  const dy2 = bl.y - br.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return (p) => {
    const u = (p.x - rect.x) / rect.width;
    const v = (p.y - rect.y) / rect.height;
    const w = g * u + h * v + 1;
    return {
      x: ((tr.x - tl.x + g * tr.x) * u + (bl.x - tl.x + h * bl.x) * v + tl.x) / w,
      y: ((tr.y - tl.y + g * tr.y) * u + (bl.y - tl.y + h * bl.y) * v + tl.y) / w,
    };
  };
}

async function transform(page: Page, params: Record<string, unknown>): Promise<TransformResult> {
  const result = await run<TransformResult>(page, { op: 'layer.transform', ...params });
  await settle(page, 200);
  return result;
}

test.describe('layer.transform drags the Move tool\'s handles', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await newDoc(page);
    await block(page, BLOCK);
  });

  test('turns one raster layer by 30° about the centre of its content, in one undoable step', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    const result = await transform(page, { rotate: 30 });
    expect(result.layers).toEqual([await layerId(page, 'Layer 1')]);
    expect(Math.abs(result.rotate! - 30)).toBeLessThan(0.01);
    const centre = { x: 130, y: 90 };
    const { alpha, bounds } = await alphaMap(page, 'Layer 1');
    expectBounds(bounds, corners(BLOCK).map((p) => turn(p, centre, 30)));
    // Inside the turned block, near each turned corner; and the unturned corners, now empty.
    for (const p of corners(BLOCK).map((c) => turn({ x: c.x + (centre.x - c.x) * 0.15, y: c.y + (centre.y - c.y) * 0.15 }, centre, 30))) {
      expect(alpha(Math.floor(p.x), Math.floor(p.y)), `inside at ${p.x}, ${p.y}`).toBe(255);
    }
    expect(alpha(101, 71)).toBe(0);
    expect(alpha(158, 108)).toBe(0);
    expect(await labels(page)).toEqual(['New Document', 'Fill', 'Transform']);
    expect(await selectionActive(page)).toBe(false);

    await run(page, { op: 'history.undo' });
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    // The step was recorded with the layer's pixels selected (the Cmd-click before the drag), and undo restores that selection.
    expect(await selectionActive(page)).toBe(true);
  });

  test('turns by an angle past a half turn and the other way', async ({ page }) => {
    const result = await transform(page, { rotate: -200 });
    expect(Math.abs(result.rotate! + 200)).toBeLessThan(0.01);
    const { bounds } = await alphaMap(page, 'Layer 1');
    expectBounds(bounds, corners(BLOCK).map((p) => turn(p, { x: 130, y: 90 }, -200)));
  });

  test('scales uniformly from the top-left corner by default', async ({ page }) => {
    const result = await transform(page, { scale: { x: 2, y: 2 } });
    expect(result.scale).toEqual({ x: 2, y: 2 });
    const { alpha, bounds } = await alphaMap(page, 'Layer 1');
    expectBounds(bounds, corners({ x: 100, y: 70, width: 120, height: 80 }));
    expect(alpha(215, 145)).toBe(255);
    expect(alpha(103, 73)).toBe(255);
    expect(alpha(97, 67)).toBe(0);
    expect(alpha(223, 153)).toBe(0);
    expect(await labels(page)).toEqual(['New Document', 'Fill', 'Transform']);
  });

  test('scales each axis by its own factor about another anchor', async ({ page }) => {
    const result = await transform(page, { scale: { x: 1.5, y: 0.5 }, anchor: 'bottom-right' });
    expect(result.scale).toEqual({ x: 1.5, y: 0.5 });
    const { alpha, bounds } = await alphaMap(page, 'Layer 1');
    expectBounds(bounds, corners({ x: 70, y: 90, width: 90, height: 20 }));
    expect(alpha(72, 100)).toBe(255);
    expect(alpha(130, 80)).toBe(0);
  });

  test('scales one axis from an edge anchor, and reaches the factor within half a pixel', async ({ page }) => {
    const result = await transform(page, { scale: { x: 1.3333, y: 1 }, anchor: 'left' });
    expect(Math.abs(result.scale!.x - 1.3333) * BLOCK.width).toBeLessThanOrEqual(0.5);
    expect(result.scale!.y).toBe(1);
    const { bounds } = await alphaMap(page, 'Layer 1');
    expectBounds(bounds, corners({ x: 100, y: 70, width: 80, height: 40 }));
  });

  test('turns several layers together about the centre of their content', async ({ page }) => {
    await run(page, { op: 'layer.add', name: 'Second' });
    await block(page, { x: 200, y: 110, width: 30, height: 30 }, '#2a6ae0');
    const result = await transform(page, { layers: ['Layer 1', 'Second'], rotate: 45 });
    expect(result.layers).toHaveLength(2);
    // The union of the two blocks is (100, 70)-(230, 140), centre (165, 105).
    const centre = { x: 165, y: 105 };
    expectBounds((await alphaMap(page, 'Layer 1')).bounds, corners(BLOCK).map((p) => turn(p, centre, 45)));
    expectBounds((await alphaMap(page, 'Second')).bounds, corners({ x: 200, y: 110, width: 30, height: 30 }).map((p) => turn(p, centre, 45)));
    expect(await labels(page)).toEqual(['New Document', 'Fill', 'Add Layer', 'Rename Layer', 'Fill', 'Transform']);

    await run(page, { op: 'history.undo' });
    expectBounds((await alphaMap(page, 'Second')).bounds, corners({ x: 200, y: 110, width: 30, height: 30 }));
  });

  test('scales a group as one box', async ({ page }) => {
    await run(page, { op: 'layer.group', layers: ['Layer 1'] });
    const result = await transform(page, { layer: 'Group', scale: { x: 0.5, y: 0.5 }, anchor: 'top-left' });
    expect(result.layers).toEqual([await layerId(page, 'Layer 1')]);
    expectBounds((await alphaMap(page, 'Layer 1')).bounds, corners({ x: 100, y: 70, width: 30, height: 20 }));
  });

  test('a text layer is turned and scaled by its own handles and stays live text', async ({ page }) => {
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Turn me' });
    const turned = await transform(page, { rotate: 30 });
    expect(Math.abs(turned.rotate! - 30)).toBeLessThan(0.01);
    const scaled = await transform(page, { scale: { x: 2, y: 2 } });
    expect(Math.abs(scaled.scale!.x - 2)).toBeLessThan(0.05);
    const text = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; type: string; text?: string; transform?: { a: number; b: number; c: number; d: number } }> } };
      };
      const doc = store.getState().document;
      return doc.layers.find((l) => l.id === doc.activeLayerId)!;
    });
    expect(text.type).toBe('text');
    expect(text.text).toBe('Turn me');
    const a = (30 * Math.PI) / 180;
    expect(text.transform!.a).toBeCloseTo(2 * Math.cos(a), 1);
    expect(text.transform!.b).toBeCloseTo(2 * Math.sin(a), 1);
    expect(text.transform!.c).toBeCloseTo(-2 * Math.sin(a), 1);
    expect(text.transform!.d).toBeCloseTo(2 * Math.cos(a), 1);
    expect((await labels(page)).slice(-2)).toEqual(['Transform', 'Transform']);
  });
});

test.describe('layer.transform drag refusals', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await newDoc(page);
    await block(page, BLOCK);
  });

  async function expectUnchanged(page: Page, before: string, history = ['New Document', 'Fill']): Promise<void> {
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    expect(await labels(page)).toEqual(history);
    expect(await selectionActive(page)).toBe(false);
  }

  test('invalid params', async ({ page }) => {
    const invalid = async (params: Record<string, unknown>): Promise<string> => {
      const error = await runError(page, { op: 'layer.transform', ...params });
      expect(error.code, JSON.stringify(params)).toBe('invalid');
      return error.message;
    };
    expect(await invalid({ rotate: 30, scale: { x: 2, y: 2 } })).toBe('layer.transform: pass exactly one of rotate, flip, scale, skew, distort or perspective.');
    expect(await invalid({ skew: { x: 10, y: 0 }, distort: { 'top-left': { x: 5, y: 5 } } })).toContain('pass exactly one of');
    expect(await invalid({ rotate: 0 })).toBe('layer.transform: rotate 0 turns nothing.');
    expect(await invalid({ rotate: -360 })).toBe('layer.transform: rotate -360 turns nothing.');
    await invalid({ rotate: 400 });
    await invalid({ scale: { x: 0, y: 1 } });
    await invalid({ scale: { x: -1, y: 1 } });
    await invalid({ scale: { x: 21, y: 1 } });
    await invalid({ scale: 2 });
    expect(await invalid({ scale: { x: 1, y: 1 } })).toBe('layer.transform: scale {x: 1, y: 1} changes nothing.');
    expect(await invalid({ scale: { x: 2, y: 2 }, anchor: 'left' })).toContain('is an edge, whose drag scales only x');
    expect(await invalid({ rotate: 30, anchor: 'left' })).toBe('layer.transform: anchor goes with scale or skew only.');
    expect(await invalid({ distort: { 'top-left': { x: 5, y: 5 } }, anchor: 'left' })).toBe('layer.transform: anchor goes with scale or skew only.');
    expect(await invalid({ skew: { x: 10, y: 10 } })).toContain('skew shears along one axis at a time');
    expect(await invalid({ skew: { x: 0, y: 0 } })).toContain('skew shears along one axis at a time');
    await invalid({ skew: { x: 61, y: 0 } });
    expect(await invalid({ skew: { x: 10, y: 0 }, anchor: 'left' })).toBe('layer.transform: a skew along x holds the "top" or "bottom" edge still, not "left".');
    expect(await invalid({ skew: { x: 0, y: 10 }, anchor: 'top-left' })).toBe('layer.transform: a skew along y holds the "left" or "right" edge still, not "top-left".');
    expect(await invalid({ distort: {} })).toBe('layer.transform: distort moves no corner by a whole pixel.');
    expect(await invalid({ distort: { 'top-left': { x: 0.2, y: -0.4 } } })).toBe('layer.transform: distort moves no corner by a whole pixel.');
    expect(await invalid({ distort: { middle: { x: 5, y: 5 } } })).toContain('distort has unknown key "middle"');
    expect(await invalid({ perspective: {} })).toBe('layer.transform: perspective moves neither edge by a whole pixel.');
    expect(await invalid({ perspective: { top: { inset: 0 } } })).toBe('layer.transform: perspective moves neither edge by a whole pixel.');
    expect(await invalid({ perspective: { top: { shift: 4 } } })).toContain('perspective.top.inset is required');
    expect(await invalid({ perspective: { left: { inset: 4 } } })).toContain('perspective has unknown key "left"');
  });

  test('a marquee is refused with the buttons\' message', async ({ page }) => {
    await run(page, { op: 'select.rect', x: 10, y: 10, width: 40, height: 40 });
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    expect(await runError(page, { op: 'layer.transform', rotate: 30 })).toEqual({
      code: 'refused',
      message: 'A marquee is active, and the Move buttons would transform the selected pixels instead of the layers: deselect first (select.none with commit: true), or transform the selection with tool.gesture and the move tool.',
    });
    expect((await runError(page, { op: 'layer.transform', scale: { x: 2, y: 2 } })).code).toBe('refused');
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    expect(await labels(page)).toEqual(['New Document', 'Fill']);
    expect(await selectionActive(page)).toBe(true);
  });

  test('a locked layer', async ({ page }) => {
    await run(page, { op: 'layer.set', locked: true });
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    expect(await runError(page, { op: 'layer.transform', rotate: 30 })).toMatchObject({ code: 'refused', message: expect.stringContaining('is locked') });
    await expectUnchanged(page, before, ['New Document', 'Fill', 'Lock Layer']);
  });

  test('an empty layer', async ({ page }) => {
    await run(page, { op: 'layer.add', name: 'Empty' });
    expect(await runError(page, { op: 'layer.transform', rotate: 30 })).toEqual({ code: 'refused', message: '"Empty" has no pixels on the canvas to transform.' });
    expect(await selectionActive(page)).toBe(false);
  });

  test('several layers with nothing to transform', async ({ page }) => {
    await run(page, [{ op: 'layer.add', name: 'A' }, { op: 'layer.add', name: 'B' }]);
    expect(await runError(page, { op: 'layer.transform', layers: ['A', 'B'], scale: { x: 2, y: 2 } })).toEqual({
      code: 'refused',
      message: 'The selected layers have nothing to transform: they are empty or locked.',
    });
  });

  test('layer-mask edit mode', async ({ page }) => {
    await run(page, [{ op: 'mask.add' }, { op: 'mask.edit', enabled: true }]);
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    expect(await runError(page, { op: 'layer.transform', rotate: 30 })).toMatchObject({
      code: 'refused',
      message: expect.stringContaining('Leave mask edit mode to move or transform a selection.'),
    });
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
  });

  test('a scale past the largest document side', async ({ page }) => {
    await run(page, [{ op: 'doc.new', width: 1000, height: 100 }, { op: 'select.all' }, { op: 'paint.fill' }, { op: 'select.none', commit: true }]);
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    expect(await runError(page, { op: 'layer.transform', scale: { x: 17, y: 1 }, anchor: 'left' })).toEqual({
      code: 'refused',
      message: 'The scaled box would be 17000 × 100 px, larger than the largest document side (16384 px).',
    });
    await expectUnchanged(page, before);
  });

  test('View > Snap to Grid with the grid shown, when it would change the result', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    // Showing the grid turns Snap to Grid on until it is toggled by hand.
    await clickMenu(page, 'View', 'Show Grid');
    expect(await runError(page, { op: 'layer.transform', rotate: 20 })).toMatchObject({
      code: 'refused',
      message: expect.stringContaining('lands on 15° steps: it would turn 15° instead of 20°'),
    });
    expect(await runError(page, { op: 'layer.transform', scale: { x: 1.1, y: 1.1 } })).toMatchObject({
      code: 'refused',
      message: expect.stringContaining('snaps its handle to the'),
    });
    await expectUnchanged(page, before);
    // A multiple of 15° is what the snap gives anyway.
    const result = await transform(page, { rotate: 45 });
    expect(result.rotate).toBe(45);
  });
});

test.describe('layer.transform skews and moves corners in the Move options\' other modes', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await newDoc(page);
    await block(page, BLOCK);
  });

  test('skews one raster layer sideways, the top edge held, in one undoable step that leaves the mode as it was', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    // tan 26.565° is 0.5: the bottom edge, 40 px below the top, slides 20 px right.
    const result = await transform(page, { skew: { x: 26.565, y: 0 } });
    expect(result.layers).toEqual([await layerId(page, 'Layer 1')]);
    expect(result.skew!.y).toBe(0);
    expect(result.skew!.x).toBeCloseTo(26.565051, 5);
    const { alpha } = await alphaMap(page, 'Layer 1');
    expectFills(alpha, [{ x: 100, y: 70 }, { x: 160, y: 70 }, { x: 180, y: 110 }, { x: 120, y: 110 }]);
    expect(await labels(page)).toEqual(['New Document', 'Fill', 'Transform']);
    expect(await selectionActive(page)).toBe(false);
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });

    await run(page, { op: 'history.undo' });
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
  });

  test('skews the other way and along y, holding the edge named', async ({ page }) => {
    // The bottom edge held: the top edge slides 20 px right for a negative x.
    await transform(page, { skew: { x: -26.565, y: 0 }, anchor: 'bottom' });
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 120, y: 70 }, { x: 180, y: 70 }, { x: 160, y: 110 }, { x: 100, y: 110 }]);
    await run(page, { op: 'history.undo' });
    await run(page, { op: 'select.none', commit: true });
    // tan 18.435° is a third: the right side, 60 px from the left, slides 20 px down.
    const down = await transform(page, { skew: { x: 0, y: 18.435 } });
    expect(down.skew!.x).toBe(0);
    expect(down.skew!.y).toBeCloseTo(18.434949, 5);
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 100, y: 70 }, { x: 160, y: 90 }, { x: 160, y: 130 }, { x: 100, y: 110 }]);
    await run(page, { op: 'history.undo' });
    await run(page, { op: 'select.none', commit: true });
    // The right side held: the left side slides 20 px up for a positive y.
    await transform(page, { skew: { x: 0, y: 18.435 }, anchor: 'right' });
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 100, y: 50 }, { x: 160, y: 70 }, { x: 160, y: 110 }, { x: 100, y: 90 }]);
  });

  test('a skew lands on whole pixels and reports the angle it reached', async ({ page }) => {
    // 10° would slide the bottom edge 7.05 px; a pointer moves it 7.
    const result = await transform(page, { skew: { x: 10, y: 0 } });
    expect(result.skew!.x).toBeCloseTo((Math.atan(7 / 40) * 180) / Math.PI, 5);
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 100, y: 70 }, { x: 160, y: 70 }, { x: 167, y: 110 }, { x: 107, y: 110 }]);
  });

  test('distorts one raster layer by moving two corners, one history step a corner', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    const result = await transform(page, { distort: { 'top-right': { x: 30, y: -20 }, 'bottom-left': { x: -19.6, y: 10.4 } } });
    expect(result.corners).toEqual({
      'top-left': { x: 0, y: 0 },
      'top-right': { x: 30, y: -20 },
      'bottom-right': { x: 0, y: 0 },
      'bottom-left': { x: -20, y: 10 },
    });
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 100, y: 70 }, { x: 190, y: 50 }, { x: 160, y: 110 }, { x: 80, y: 120 }]);
    expect(await labels(page)).toEqual(['New Document', 'Fill', 'Transform', 'Transform']);
    expect(await selectionActive(page)).toBe(false);
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });

    await run(page, { op: 'history.undo', steps: 2 });
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
  });

  test('gives one raster layer perspective: an edge narrows about its middle, and the other can widen', async ({ page }) => {
    const top = await transform(page, { perspective: { top: { inset: 15 } } });
    expect(top.corners).toEqual({
      'top-left': { x: 15, y: 0 },
      'top-right': { x: -15, y: 0 },
      'bottom-right': { x: 0, y: 0 },
      'bottom-left': { x: 0, y: 0 },
    });
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 115, y: 70 }, { x: 145, y: 70 }, { x: 160, y: 110 }, { x: 100, y: 110 }]);
    expect(await labels(page)).toEqual(['New Document', 'Fill', 'Transform']);

    await run(page, { op: 'history.undo' });
    await run(page, { op: 'select.none', commit: true });
    const both = await transform(page, { perspective: { top: { inset: 10, shift: -10 }, bottom: { inset: -20, shift: 5 } } });
    expect(both.corners).toEqual({
      'top-left': { x: 10, y: -10 },
      'top-right': { x: -10, y: -10 },
      'bottom-right': { x: 20, y: 5 },
      'bottom-left': { x: -20, y: 5 },
    });
    expectFills((await alphaMap(page, 'Layer 1')).alpha, [{ x: 110, y: 60 }, { x: 150, y: 60 }, { x: 180, y: 115 }, { x: 80, y: 115 }]);
    expect((await labels(page)).slice(-2)).toEqual(['Transform', 'Transform']);
  });

  test('skews and distorts several layers together in their shared box', async ({ page }) => {
    await run(page, { op: 'layer.add', name: 'Second' });
    await block(page, { x: 200, y: 110, width: 30, height: 30 }, '#2a6ae0');
    // The union of the two blocks is (100, 70)-(230, 140): 70 px tall, so tan 0.2 slides its bottom edge 14 px.
    const skewed = await transform(page, { layers: ['Layer 1', 'Second'], skew: { x: 11.31, y: 0 } });
    expect(skewed.layers).toHaveLength(2);
    expect(skewed.skew!.x).toBeCloseTo(11.309932, 5);
    const shear = (p: Point): Point => ({ x: p.x + (p.y - 70) * 0.2, y: p.y });
    expectFills((await alphaMap(page, 'Layer 1')).alpha, corners(BLOCK).map(shear));
    expectFills((await alphaMap(page, 'Second')).alpha, corners({ x: 200, y: 110, width: 30, height: 30 }).map(shear));
    expect((await labels(page)).at(-1)).toBe('Transform');
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });

    await run(page, { op: 'history.undo' });
    const moved = await transform(page, { layers: ['Layer 1', 'Second'], distort: { 'top-left': { x: 20, y: 10 } } });
    expect(moved.corners!['top-left']).toEqual({ x: 20, y: 10 });
    // Both layers follow the one projective map that takes the shared box onto its new corners.
    const project = projection({ x: 100, y: 70, width: 130, height: 70 }, [{ x: 120, y: 80 }, { x: 230, y: 70 }, { x: 230, y: 140 }, { x: 100, y: 140 }]);
    expectFills((await alphaMap(page, 'Layer 1')).alpha, corners(BLOCK).map(project));
    expectFills((await alphaMap(page, 'Second')).alpha, corners({ x: 200, y: 110, width: 30, height: 30 }).map(project));
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });
  });

  test('skews a text layer by its own Skew handles, and it stays live text', async ({ page }) => {
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Lean' });
    const result = await transform(page, { skew: { x: -20, y: 0 } });
    expect(Math.abs(result.skew!.x + 20)).toBeLessThan(2);
    expect(result.skew!.y).toBe(0);
    const text = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; type: string; text?: string; transform?: { a: number; b: number; c: number; d: number } }> } };
      };
      const doc = store.getState().document;
      return doc.layers.find((l) => l.id === doc.activeLayerId)!;
    });
    expect(text.type).toBe('text');
    expect(text.text).toBe('Lean');
    expect(text.transform!.a).toBeCloseTo(1, 6);
    expect(text.transform!.b).toBeCloseTo(0, 6);
    expect(text.transform!.c).toBeCloseTo(Math.tan((result.skew!.x * Math.PI) / 180), 5);
    expect(text.transform!.d).toBeCloseTo(1, 6);
    expect((await labels(page)).at(-1)).toBe('Transform');
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });
  });

  test('a mode left pressed in the Move options is pressed again afterwards, whatever the step needed', async ({ page }) => {
    await run(page, { op: 'layer.add', name: 'Second' });
    await block(page, { x: 200, y: 110, width: 30, height: 30 }, '#2a6ae0');
    await run(page, [{ op: 'layer.select', layer: 'Layer 1' }, { op: 'layer.select', layer: 'Second', mode: 'toggle' }]);
    await run(page, { op: 'tool.select', tool: 'move' });
    await page.getByRole('button', { name: 'Transform mode: Distort' }).click();
    expect((await modes(page)).box).toBe('distort');
    // A turn needs Free, which has the rotate handles; the command presses it and Distort again after.
    const turned = await transform(page, { rotate: 45 });
    expect(turned.rotate).toBeCloseTo(45, 2);
    expect((await modes(page)).box).toBe('distort');
    const skewed = await transform(page, { skew: { x: 0, y: 10 } });
    expect(skewed.skew!.y).toBeGreaterThan(9);
    expect((await modes(page)).box).toBe('distort');
    await expect(page.getByRole('button', { name: 'Transform mode: Distort' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('layer.transform skew, distort and perspective refusals', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await newDoc(page);
    await block(page, BLOCK);
  });

  test('distort and perspective on a text layer, which has only Free and Skew', async ({ page }) => {
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Flat' });
    const history = await labels(page);
    expect(await runError(page, { op: 'layer.transform', distort: { 'top-left': { x: 10, y: 10 } } })).toEqual({
      code: 'refused',
      message: 'The Move tool offers a text layer only its Free and Skew modes: rasterize "Flat" (layer.rasterize) to distort it.',
    });
    expect(await runError(page, { op: 'layer.transform', perspective: { top: { inset: 10 } } })).toEqual({
      code: 'refused',
      message: 'The Move tool offers a text layer only its Free and Skew modes: rasterize "Flat" (layer.rasterize) to give it perspective.',
    });
    expect(await labels(page)).toEqual(history);
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });
  });

  test('distort on several layers that include text, with the toast the handles show', async ({ page }) => {
    await run(page, { op: 'text.add', x: 40, y: 60, text: 'Flat' });
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    const history = await labels(page);
    for (const params of [{ distort: { 'top-left': { x: 10, y: 10 } } }, { perspective: { bottom: { inset: 10 } } }]) {
      expect(await runError(page, { op: 'layer.transform', layers: ['Layer 1', 'Flat'], ...params })).toEqual({
        code: 'refused',
        message: 'Rasterize the text layers before distorting them with other layers.',
      });
    }
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    expect(await labels(page)).toEqual(history);
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });
    // A skew is affine, which text follows.
    const skewed = await transform(page, { layers: ['Layer 1', 'Flat'], skew: { x: 15, y: 0 } });
    expect(skewed.layers).toHaveLength(2);
  });

  test('corners that would fold the box, before any of them is moved', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    // The top-left corner dragged past the bottom-right one.
    expect(await runError(page, { op: 'layer.transform', distort: { 'top-right': { x: 10, y: 0 }, 'top-left': { x: 80, y: 60 } } })).toEqual({
      code: 'refused',
      message: 'These offsets would fold the box: its corners would be at (180, 130), (170, 70), (160, 110), (100, 110) (clockwise from the top-left), which is not a convex quad. Move the corners less.',
    });
    // The top edge's ends crossed over.
    expect((await runError(page, { op: 'layer.transform', perspective: { top: { inset: 40 } } })).message).toContain('would fold the box');
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    expect(await labels(page)).toEqual(['New Document', 'Fill']);
    expect(await selectionActive(page)).toBe(false);
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });
  });

  test('a skew too slight to move the edge a pixel', async ({ page }) => {
    const before = await docPixelHash(page, await layerId(page, 'Layer 1'));
    expect(await runError(page, { op: 'layer.transform', skew: { x: 0.5, y: 0 } })).toEqual({
      code: 'refused',
      message: 'This skew would slide the box\'s bottom edge by less than a pixel (the edge is 40 px from the one held), and a drag moves by whole pixels: skew by a larger angle.',
    });
    expect(await docPixelHash(page, await layerId(page, 'Layer 1'))).toBe(before);
    expect(await labels(page)).toEqual(['New Document', 'Fill']);
    expect(await selectionActive(page)).toBe(false);
  });

  test('a marquee, a locked layer and layer-mask edit mode, as for the other drags', async ({ page }) => {
    await run(page, { op: 'select.rect', x: 10, y: 10, width: 40, height: 40 });
    expect((await runError(page, { op: 'layer.transform', skew: { x: 20, y: 0 } })).message).toContain('A marquee is active');
    await run(page, { op: 'select.none', commit: true });
    await run(page, [{ op: 'mask.add' }, { op: 'mask.edit', enabled: true }]);
    expect((await runError(page, { op: 'layer.transform', distort: { 'top-left': { x: 10, y: 10 } } })).message).toContain('Leave mask edit mode to move or transform a selection.');
    await run(page, [{ op: 'mask.edit', enabled: false }, { op: 'layer.set', locked: true }]);
    expect((await runError(page, { op: 'layer.transform', perspective: { top: { inset: 10 } } })).message).toContain('is locked');
    expect(await modes(page)).toEqual({ box: 'free', text: 'free' });
  });
});
