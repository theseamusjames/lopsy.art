/**
 * The gesture commands other than paint.stroke (src/commands/paint/drag.ts,
 * src/commands/selection/tool-select.ts, src/commands/layer/move.ts,
 * src/commands/gesture/gesture.ts) against the same mouse gesture, at View >
 * Actual Size with one move event per whole document pixel, then on their
 * own for every refusal.
 */
import { test, expect, run, runError, compareUiAndApi, gpuMaskHash, snapshot, type Page } from './harness';
import { docToScreen, selectTool, setForegroundColor } from '../helpers';
import { clickMenu, dragMarquee, historyLabels, settle, surfaceState } from '../surface-helpers';
import { rowButton } from '../surface-helpers-keys';

interface Point {
  x: number;
  y: number;
}

type Key = 'Shift' | 'Alt' | 'Meta';

interface MoveResult {
  layer: string;
  x: number;
  y: number;
}

async function actualSize(page: Page): Promise<void> {
  await clickMenu(page, 'View', 'Actual Size');
  await settle(page);
}

async function mouseGesture(page: Page, points: readonly Point[], keys: readonly Key[] = []): Promise<void> {
  const [first, ...rest] = points;
  if (!first) throw new Error('mouseGesture needs points');
  const start = await docToScreen(page, first.x, first.y);
  await page.mouse.move(start.x, start.y);
  for (const key of keys) await page.keyboard.down(key);
  await page.mouse.down();
  for (const p of rest) {
    const s = await docToScreen(page, p.x, p.y);
    await page.mouse.move(s.x, s.y, { steps: 1 });
  }
  await page.mouse.up();
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  await settle(page);
}

async function toolDrag(page: Page, tool: string, points: readonly Point[], keys: readonly Key[] = []): Promise<void> {
  await selectTool(page, tool);
  await mouseGesture(page, points, keys);
}

async function api(page: Page, invocation: { op: string; [key: string]: unknown }): Promise<unknown> {
  const result = await run(page, invocation);
  await settle(page);
  return result;
}

async function fill(page: Page, rgb: readonly [number, number, number], x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await setForegroundColor(page, ...rgb);
  await dragMarquee(page, x0, y0, x1, y1);
  await clickMenu(page, 'Edit', 'Fill');
}

/** A blue block and a green block beside it on the white background, deselected, red foreground. */
async function blocks(page: Page): Promise<void> {
  await actualSize(page);
  await fill(page, [30, 60, 220], 20, 30, 110, 120);
  await fill(page, [40, 200, 70], 110, 30, 180, 120);
  await clickMenu(page, 'Select', 'Deselect');
  await setForegroundColor(page, 255, 0, 0);
  await settle(page);
}

/** A new layer holding an orange square at (40,30)-(100,90), active, deselected. */
async function squareLayer(page: Page): Promise<void> {
  await actualSize(page);
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await fill(page, [240, 140, 20], 40, 30, 100, 90);
  await clickMenu(page, 'Select', 'Deselect');
  await settle(page);
}

async function activeLayerId(page: Page): Promise<string> {
  const id = (await surfaceState(page)).activeLayerId;
  if (!id) throw new Error('no active layer');
  return id;
}

async function lockActive(page: Page): Promise<void> {
  await rowButton(page, await activeLayerId(page), 'Lock layer').click();
  await settle(page);
}

test.describe('the gesture commands against the same mouse gesture', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  for (const type of ['linear', 'radial'] as const) {
    for (const withSelection of [false, true]) {
      test(`paint.gradient ${type}${withSelection ? ' inside a selection' : ''}`, async ({ page }) => {
        const { api: after } = await compareUiAndApi(page, {
          setup: async (p) => {
            await actualSize(p);
            await run(p, { op: 'tool.set', tool: 'gradient', options: { type, stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }] } });
            if (withSelection) await dragMarquee(p, 40, 30, 150, 110);
          },
          viaUi: (p) => toolDrag(p, 'gradient', [{ x: 50, y: 60 }, { x: 90, y: 70 }, { x: 140, y: 80 }]),
          viaApi: async (p) => { await api(p, { op: 'paint.gradient', from: { x: 50, y: 60 }, to: { x: 140, y: 80 } }); },
        });
        expect(after.history.undo.at(-1)).toBe(type === 'linear' ? 'Linear Gradient' : 'Radial Gradient');
        expect(after.selection.active).toBe(withSelection);
      });
    }
  }

  for (const mode of ['rectangle', 'ellipse'] as const) {
    test(`paint.shape ${mode} with pixel output`, async ({ page }) => {
      const results: unknown[] = [];
      const { api: after } = await compareUiAndApi(page, {
        setup: async (p) => {
          await actualSize(p);
          await setForegroundColor(p, 200, 30, 120);
          await run(p, { op: 'tool.set', tool: 'shape', options: { mode, output: 'pixels' } });
        },
        viaUi: (p) => toolDrag(p, 'shape', [{ x: 100, y: 75 }, { x: 120, y: 90 }, { x: 150, y: 110 }]),
        viaApi: async (p) => { results.push(await api(p, { op: 'paint.shape', from: { x: 100, y: 75 }, to: { x: 150, y: 110 } })); },
      });
      expect(after.history.undo.at(-1)).toBe('Shape');
      expect(results).toEqual([{ tool: 'shape', layer: expect.any(String), output: 'pixels', path: null }]);
    });
  }

  test('paint.shape constrained (Cmd) is a circle, as a Cmd-drag is', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => {
        await actualSize(p);
        await run(p, { op: 'tool.set', tool: 'shape', options: { mode: 'ellipse' } });
      },
      viaUi: (p) => toolDrag(p, 'shape', [{ x: 100, y: 75 }, { x: 150, y: 95 }], ['Meta']),
      viaApi: async (p) => { await api(p, { op: 'paint.shape', from: { x: 100, y: 75 }, to: { x: 150, y: 95 }, constrain: true }); },
    });
  });

  test('paint.shape keeps a fillColor that tool.set chose before the Shape tool was first active on the page', async ({ page }) => {
    await run(page, [
      { op: 'doc.new', width: 200, height: 150 },
      { op: 'color.set', foreground: '#00ff00' },
      { op: 'tool.set', tool: 'shape', options: { mode: 'rectangle', output: 'pixels', fillColor: '#c81e78' } },
      { op: 'paint.shape', from: { x: 100, y: 75 }, to: { x: 150, y: 110 } },
    ]);
    expect(await run(page, { op: 'tool.options', tool: 'shape' })).toMatchObject({ options: { fillColor: '#c81e78' } });
    expect(await run(page, { op: 'view.sample', x: 100, y: 75 })).toEqual({ hex: '#c81e78', alpha: 1 });
  });

  test('paint.shape with path output adds a path and returns its id', async ({ page }) => {
    const results: Array<{ path: string | null; output: string }> = [];
    const { api: after } = await compareUiAndApi(page, {
      setup: async (p) => {
        await actualSize(p);
        await run(p, { op: 'tool.set', tool: 'shape', options: { mode: 'rectangle', output: 'path' } });
      },
      viaUi: (p) => toolDrag(p, 'shape', [{ x: 100, y: 75 }, { x: 150, y: 110 }]),
      viaApi: async (p) => { results.push(await api(p, { op: 'paint.shape', from: { x: 100, y: 75 }, to: { x: 150, y: 110 } }) as { path: string | null; output: string }); },
    });
    expect(after.paths).toHaveLength(1);
    expect(after.history.undo.at(-1)).toBe('Add Path');
    expect(results[0]?.output).toBe('path');
    expect(results[0]?.path).toEqual(expect.any(String));
  });

  test('paint.bucket fills a bounded region as a Paint Bucket click does', async ({ page }) => {
    const { api: after } = await compareUiAndApi(page, {
      setup: blocks,
      viaUi: (p) => toolDrag(p, 'fill', [{ x: 60, y: 70 }]),
      viaApi: async (p) => { await api(p, { op: 'paint.bucket', x: 60, y: 70 }); },
    });
    expect(after.history.undo.at(-1)).toBe('Bucket Fill');
  });

  test('select.wand replace, then add, as a click then a Shift-click', async ({ page }) => {
    const masks: Array<string | null> = [];
    const { api: after } = await compareUiAndApi(page, {
      setup: blocks,
      viaUi: async (p) => {
        await toolDrag(p, 'wand', [{ x: 60, y: 70 }]);
        await mouseGesture(p, [{ x: 150, y: 70 }], ['Shift']);
      },
      viaApi: async (p) => {
        expect(await api(p, { op: 'select.wand', x: 60, y: 70 })).toEqual({ tool: 'wand' });
        masks.push((await snapshot(p)).selection.mask);
        await api(p, { op: 'select.wand', x: 150, y: 70, mode: 'add' });
      },
    });
    expect(masks[0]).not.toBeNull();
    expect(after.selection.mask).not.toBe(masks[0]);
    expect(after.history.undo.at(-1)).toBe('Add to Selection');
  });

  test('select.quick matches a Quick Selection drag', async ({ page }) => {
    const path = [{ x: 40, y: 50 }, { x: 60, y: 70 }, { x: 90, y: 90 }];
    const { api: after } = await compareUiAndApi(page, {
      setup: blocks,
      viaUi: (p) => toolDrag(p, 'quick-select', path),
      viaApi: async (p) => { expect(await api(p, { op: 'select.quick', points: path })).toEqual({ tool: 'quick-select' }); },
    });
    expect(after.selection.active).toBe(true);
  });

  test('layer.move matches a Move-tool drag of a layer', async ({ page }) => {
    const results: MoveResult[] = [];
    const { api: after } = await compareUiAndApi(page, {
      setup: squareLayer,
      viaUi: (p) => toolDrag(p, 'move', [{ x: 70, y: 60 }, { x: 80, y: 66 }, { x: 95, y: 75 }]),
      viaApi: async (p) => { results.push(await api(p, { op: 'layer.move', dx: 25, dy: 15 }) as MoveResult); },
    });
    const moved = after.layers.find((l) => l.name === 'Layer 2');
    expect(results).toEqual([{ layer: expect.any(String), x: 65, y: 45 }]);
    expect({ x: moved?.x, y: moved?.y }).toEqual({ x: 65, y: 45 });
    expect(after.history.undo.at(-1)).toBe('Move');
  });

  test('layer.move carries the layer\'s mask, as the drag does', async ({ page }) => {
    const masks: Array<string | null> = [];
    const { api: after } = await compareUiAndApi(page, {
      setup: async (p) => {
        await squareLayer(p);
        await p.locator('[aria-label="Add Mask"]').click();
        await settle(p);
        await setForegroundColor(p, 0, 0, 0);
        await toolDrag(p, 'brush', [{ x: 45, y: 40 }, { x: 95, y: 80 }]);
      },
      viaUi: (p) => toolDrag(p, 'move', [{ x: 70, y: 60 }, { x: 82, y: 50 }, { x: 90, y: 40 }]),
      viaApi: async (p) => {
        const id = await activeLayerId(p);
        masks.push(await gpuMaskHash(p, id));
        await api(p, { op: 'layer.move', dx: 20, dy: -20 });
        masks.push(await gpuMaskHash(p, id));
      },
    });
    expect(masks[1]).not.toBe(masks[0]);
    expect(after.layers.find((l) => l.name === 'Layer 2')?.mask).toBe(masks[1]);
  });

  test('with a selection layer.move is refused, and tool.gesture with the move tool drags the selected pixels as the mouse does', async ({ page }) => {
    const refusals: unknown[] = [];
    const drag = [{ x: 60, y: 50 }, { x: 70, y: 58 }, { x: 85, y: 70 }];
    const { api: after } = await compareUiAndApi(page, {
      setup: async (p) => {
        await squareLayer(p);
        await dragMarquee(p, 45, 35, 75, 65);
      },
      viaUi: (p) => toolDrag(p, 'move', drag),
      viaApi: async (p) => {
        const before = await snapshot(p);
        refusals.push(await runError(p, { op: 'layer.move', dx: 25, dy: 20 }));
        expect(await snapshot(p)).toEqual(before);
        await api(p, { op: 'tool.gesture', tool: 'move', points: drag });
      },
    });
    expect(refusals).toEqual([{
      code: 'refused',
      message: 'A selection is active, and a Move drag would lift the selected pixels instead of moving the layer: deselect first (select.none), or drag the selection with tool.gesture and the move tool.',
    }]);
    expect(after.selection.bounds).toEqual({ x: 70, y: 55, width: 30, height: 30 });
  });

  test('tool.gesture: Pen-tool clicks build the same path', async ({ page }) => {
    const anchors = [{ x: 30, y: 40 }, { x: 120, y: 30 }, { x: 160, y: 110 }];
    const clicks = [...anchors, anchors[0]!];
    const { api: after } = await compareUiAndApi(page, {
      setup: actualSize,
      viaUi: async (p) => {
        await selectTool(p, 'path');
        for (const c of clicks) await mouseGesture(p, [c]);
      },
      viaApi: async (p) => {
        for (const c of clicks) await api(p, { op: 'tool.gesture', tool: 'path', points: [c] });
      },
    });
    expect(after.paths).toEqual([{ closed: true, anchors }]);
  });
});

test.describe('the gesture commands on their own', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await page.waitForSelector('[data-testid="canvas-container"]');
    await settle(page, 300);
  });

  test('paint.gradient refuses a click without a drag', async ({ page }) => {
    expect(await runError(page, { op: 'paint.gradient', from: { x: 10.2, y: 10 }, to: { x: 9.8, y: 10.4 } })).toEqual({
      code: 'invalid',
      message: 'paint.gradient: from and to land on the same pixel; a click without a drag draws nothing.',
    });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('paint.shape refuses a click, a flat box, and a constrained drag with symmetry on', async ({ page }) => {
    expect(await runError(page, { op: 'paint.shape', from: { x: 50, y: 50 }, to: { x: 52, y: 52 } })).toEqual({
      code: 'invalid',
      message: 'paint.shape: from and to must be at least 4 px apart; a shorter drag is a click, which opens the Shape Size dialog in the UI.',
    });
    expect(await runError(page, { op: 'paint.shape', from: { x: 50, y: 50 }, to: { x: 90, y: 50 } })).toEqual({
      code: 'invalid',
      message: 'paint.shape: from and to must differ in both x and y, or the shape has no width or height.',
    });
    await selectTool(page, 'brush');
    await page.getByRole('button', { name: 'Symmetry Horizontal' }).click();
    expect(await runError(page, { op: 'paint.shape', from: { x: 50, y: 50 }, to: { x: 90, y: 80 }, constrain: true })).toEqual({
      code: 'refused',
      message: 'With symmetry on, the Cmd/Ctrl press that constrains a shape sets the symmetry centre instead: turn symmetry off to draw a constrained shape.',
    });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('paint.bucket refuses a pixel outside the document or the selection', async ({ page }) => {
    expect(await runError(page, { op: 'paint.bucket', x: 200, y: 10 })).toEqual({
      code: 'refused',
      message: '(200, 10) is outside the 200x150 document: a Paint Bucket click there fills nothing.',
    });
    await run(page, { op: 'select.rect', x: 10, y: 10, width: 50, height: 50 });
    expect(await runError(page, { op: 'paint.bucket', x: 100, y: 100 })).toEqual({
      code: 'refused',
      message: '(100, 100) is outside the selection: the Paint Bucket fills only inside it, and a click outside does nothing.',
    });
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await run(page, { op: 'paint.bucket', x: 20, y: 20 })).toEqual({ tool: 'fill', layer: expect.any(String) });
    expect(await historyLabels(page)).toEqual(['New Document', 'Bucket Fill']);
  });

  test('select.wand refuses a pixel outside the document and works on a locked layer', async ({ page }) => {
    expect(await runError(page, { op: 'select.wand', x: -1, y: 10 })).toEqual({
      code: 'refused',
      message: '(-1, 10) is outside the 200x150 document: a Magic Wand click there selects nothing.',
    });
    await lockActive(page);
    await run(page, { op: 'select.wand', x: 10, y: 10 });
    const after = await snapshot(page);
    expect(after.selection.bounds).toEqual({ x: 0, y: 0, width: 200, height: 150 });
  });

  test('the drag commands refuse a locked layer, and a group where they write pixels', async ({ page }) => {
    await lockActive(page);
    const locked = '"Layer 1" is locked: unlock it to use the';
    expect(await runError(page, { op: 'paint.gradient', from: { x: 1, y: 1 }, to: { x: 50, y: 50 } })).toEqual({ code: 'refused', message: `${locked} Gradient tool on it.` });
    expect(await runError(page, { op: 'paint.bucket', x: 10, y: 10 })).toEqual({ code: 'refused', message: `${locked} Paint Bucket tool on it.` });
    expect(await runError(page, { op: 'layer.move', dx: 5, dy: 5 })).toEqual({ code: 'refused', message: `${locked} Move tool on it.` });
    expect(await runError(page, { op: 'tool.gesture', tool: 'brush', points: [{ x: 5, y: 5 }] })).toEqual({ code: 'refused', message: `${locked} Brush tool on it.` });
    await run(page, { op: 'layer.add-group' });
    const group = "Groups can't be painted on. Select a layer inside the group.";
    expect(await runError(page, { op: 'paint.gradient', from: { x: 1, y: 1 }, to: { x: 50, y: 50 } })).toEqual({ code: 'refused', message: group });
    expect(await runError(page, { op: 'paint.shape', from: { x: 10, y: 10 }, to: { x: 50, y: 50 } })).toEqual({ code: 'refused', message: group });
    expect(await runError(page, { op: 'paint.bucket', x: 10, y: 10 })).toEqual({ code: 'refused', message: group });
    expect(await historyLabels(page)).toEqual(['New Document', 'Lock Layer']);
  });

  test('layer.move refuses a zero offset and reports the cropped position', async ({ page }) => {
    expect(await runError(page, { op: 'layer.move', dx: 0, dy: 0 })).toEqual({
      code: 'invalid',
      message: 'layer.move: dx and dy are both 0; a Move click without a drag moves nothing.',
    });
    expect((await runError(page, { op: 'layer.move', dx: 1.5, dy: 0 })).code).toBe('invalid');
    expect((await runError(page, { op: 'layer.move', layer: 'nope', dx: 1, dy: 0 })).code).toBe('not-found');
    await run(page, [{ op: 'layer.add' }, { op: 'select.rect', x: 30, y: 20, width: 40, height: 30 }, { op: 'color.set', foreground: '#ff0000' }, { op: 'paint.fill' }, { op: 'select.none' }]);
    expect(await run(page, { op: 'layer.move', dx: -10, dy: 7 })).toEqual({ layer: expect.any(String), x: 20, y: 27 });
    expect((await historyLabels(page)).at(-1)).toBe('Move');
  });

  test('tool.gesture: one point is a click; a marquee drag works on a locked layer', async ({ page }) => {
    await lockActive(page);
    expect(await run(page, { op: 'tool.gesture', tool: 'marquee-rect', points: [{ x: 10, y: 10 }, { x: 60, y: 40 }] }))
      .toEqual({ tool: 'marquee-rect', layer: expect.any(String) });
    expect((await snapshot(page)).selection.bounds).toEqual({ x: 10, y: 10, width: 50, height: 30 });
    expect((await runError(page, { op: 'tool.gesture', points: [] })).code).toBe('invalid');
    expect((await runError(page, { op: 'tool.gesture', tool: 'burn', points: [{ x: 1, y: 1 }] })).code).toBe('invalid');
  });
});
