/**
 * `paint.stroke` (src/commands/paint/stroke.ts) against the same drag made
 * with the mouse. Both sides run at View > Actual Size, and each mouse move
 * lands on a whole document pixel in one event (`steps: 1`), so the pointer
 * reaches the gesture dispatcher with exactly the points the command sends;
 * the snapshots must then be identical, pixels and history included.
 */
import { test, expect, run, runError, compareUiAndApi, compositeHash, gpuMaskHash, snapshot, type Page } from './harness';
import { docToScreen, selectTool, setForegroundColor } from '../helpers';
import { clickMenu, dragMarquee, historyLabels, settle, startTextEditing, surfaceState, toasts } from '../surface-helpers';
import { pressKey, rowButton } from '../surface-helpers-keys';

interface Point {
  x: number;
  y: number;
}

type Key = 'Shift' | 'Alt' | 'Meta';

const RED = { r: 255, g: 0, b: 0 };
const STROKE: Point[] = [{ x: 30, y: 40 }, { x: 60, y: 55 }, { x: 95, y: 50 }, { x: 130, y: 80 }, { x: 160, y: 70 }];
const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

async function actualSize(page: Page): Promise<void> {
  await clickMenu(page, 'View', 'Actual Size');
  await settle(page);
}

/** A mouse drag through `points`: one move event per point, each on a whole document pixel. */
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

async function stroke(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const result = await run(page, { op: 'paint.stroke', ...params });
  await settle(page);
  return result;
}

async function redSetup(page: Page): Promise<void> {
  await actualSize(page);
  await setForegroundColor(page, RED.r, RED.g, RED.b);
}

/** Red, then a blue block and a green block to work over, deselected. */
async function paintedSetup(page: Page): Promise<void> {
  await actualSize(page);
  await setForegroundColor(page, 30, 60, 220);
  await dragMarquee(page, 20, 30, 110, 120);
  await clickMenu(page, 'Edit', 'Fill');
  await setForegroundColor(page, 40, 200, 70);
  await dragMarquee(page, 110, 30, 180, 120);
  await clickMenu(page, 'Edit', 'Fill');
  await clickMenu(page, 'Select', 'Deselect');
  await setForegroundColor(page, RED.r, RED.g, RED.b);
  await settle(page);
}

async function activeLayerId(page: Page): Promise<string> {
  const id = (await surfaceState(page)).activeLayerId;
  if (!id) throw new Error('no active layer');
  return id;
}

test.describe('paint.stroke against the same mouse drag', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  test('a multi-point brush stroke', async ({ page }) => {
    const results: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: redSetup,
      viaUi: (p) => toolDrag(p, 'brush', STROKE),
      viaApi: async (p) => { results.push(await stroke(p, { points: STROKE })); },
    });
    expect(api.history.undo).toEqual(['New Document', 'Brush']);
    expect(results).toEqual([{ tool: 'brush', layer: expect.any(String), line: false }]);
  });

  test('a single brush click', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: redSetup,
      viaUi: (p) => toolDrag(p, 'brush', [{ x: 70, y: 60 }]),
      viaApi: async (p) => { await stroke(p, { points: [{ x: 70, y: 60 }] }); },
    });
  });

  test('a Shift-click line after a stroke', async ({ page }) => {
    const results: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: redSetup,
      viaUi: async (p) => {
        await toolDrag(p, 'brush', STROKE.slice(0, 3));
        await mouseGesture(p, [{ x: 150, y: 120 }], ['Shift']);
      },
      viaApi: async (p) => {
        await stroke(p, { points: STROKE.slice(0, 3) });
        results.push(await stroke(p, { points: [{ x: 150, y: 120 }], line: true }));
      },
    });
    expect(api.history.undo).toEqual(['New Document', 'Brush', 'Brush']);
    expect(results).toEqual([{ tool: 'brush', layer: expect.any(String), line: true }]);
  });

  test('a stroke inside a marquee selection is clipped the same', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await redSetup(p);
        await dragMarquee(p, 50, 30, 120, 90);
      },
      viaUi: (p) => toolDrag(p, 'brush', STROKE),
      viaApi: async (p) => { await stroke(p, { points: STROKE }); },
    });
    expect(api.selection.active).toBe(true);
  });

  test('a stroke in mask edit mode paints the mask', async ({ page }) => {
    const masks: Array<string | null> = [];
    const { api, ui } = await compareUiAndApi(page, {
      setup: redSetup,
      viaUi: async (p) => {
        await p.locator('[aria-label="Add Mask"]').click();
        await settle(p);
        await toolDrag(p, 'brush', STROKE);
      },
      viaApi: async (p) => {
        await run(p, { op: 'mask.add' });
        const id = await activeLayerId(p);
        await settle(p);
        masks.push(await gpuMaskHash(p, id));
        await stroke(p, { points: STROKE });
        masks.push(await gpuMaskHash(p, id));
      },
    });
    expect(api.history.undo).toEqual(['New Document', 'Add Mask', 'Mask Paint']);
    expect(masks[1]).not.toBe(masks[0]);
    expect(ui.layers.find((l) => l.hasMask)?.mask).toBe(masks[1]);
  });

  test('a stroke in Quick Mask mode paints the quick mask, which becomes the selection', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await actualSize(p);
        await setForegroundColor(p, 255, 255, 255);
      },
      viaUi: async (p) => {
        await pressKey(p, 'q');
        await toolDrag(p, 'brush', STROKE);
        await pressKey(p, 'q');
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'quickmask.set', enabled: true });
        await stroke(p, { points: STROKE });
        await run(p, { op: 'quickmask.set', enabled: false });
      },
    });
    expect(api.history.undo).toContain('Quick Mask Paint');
    expect(api.selection.active).toBe(true);
  });

  test('a stroke with horizontal symmetry on', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => {
        await redSetup(p);
        await selectTool(p, 'brush');
        await p.getByRole('button', { name: 'Symmetry Horizontal' }).click();
        await settle(p);
      },
      viaUi: (p) => toolDrag(p, 'brush', STROKE),
      viaApi: async (p) => { await stroke(p, { points: STROKE }); },
    });
  });

  test('two strokes then one undo leave the same history', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: redSetup,
      viaUi: async (p) => {
        await toolDrag(p, 'brush', STROKE);
        await mouseGesture(p, [{ x: 40, y: 120 }, { x: 100, y: 130 }, { x: 170, y: 110 }]);
        await pressKey(p, 'Control+z');
      },
      viaApi: async (p) => {
        await stroke(p, { points: STROKE });
        await stroke(p, { points: [{ x: 40, y: 120 }, { x: 100, y: 130 }, { x: 170, y: 110 }] });
        await run(p, { op: 'history.undo' });
      },
    });
    expect(api.history).toEqual({ undo: ['New Document', 'Brush'], redo: ['Brush'] });
  });

  for (const tool of ['pencil', 'eraser'] as const) {
    test(`a ${tool} stroke`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: paintedSetup,
        viaUi: (p) => toolDrag(p, tool, STROKE),
        viaApi: async (p) => { await stroke(p, { tool, points: STROKE }); },
      });
      expect(api.history.undo.at(-1)).toBe(tool === 'pencil' ? 'Pencil' : 'Eraser');
    });
  }

  for (const tool of ['smudge', 'dodge', 'sponge'] as const) {
    test(`a ${tool} stroke over painted content`, async ({ page }) => {
      const composites: string[] = [];
      const { api } = await compareUiAndApi(page, {
        setup: paintedSetup,
        viaUi: (p) => toolDrag(p, tool, STROKE),
        viaApi: async (p) => {
          composites.push(await compositeHash(p));
          await stroke(p, { tool, points: STROKE });
          composites.push(await compositeHash(p));
        },
      });
      expect(api.history.undo).toHaveLength(4);
      expect(composites[1]).not.toBe(composites[0]);
    });
  }

  for (const tool of ['stamp', 'healing'] as const) {
    test(`${tool}: an Alt-click source, then a stroke`, async ({ page }) => {
      const source = { x: 60, y: 70 };
      const path = [{ x: 140, y: 60 }, { x: 150, y: 80 }, { x: 165, y: 100 }];
      const { api } = await compareUiAndApi(page, {
        setup: paintedSetup,
        viaUi: async (p) => {
          await toolDrag(p, tool, [source], ['Alt']);
          await mouseGesture(p, path);
        },
        viaApi: async (p) => { await stroke(p, { tool, points: path, source }); },
      });
      expect(api.history.undo.at(-1)).toBe(tool === 'stamp' ? 'Clone Stamp' : 'Healing Brush');
    });
  }

  test('a large soft translucent brush set with tool.set on both sides', async ({ page }) => {
    await compareUiAndApi(page, {
      setup: async (p) => {
        await redSetup(p);
        await run(p, { op: 'tool.set', tool: 'brush', options: { size: 45, hardness: 30, opacity: 55 } });
      },
      viaUi: (p) => toolDrag(p, 'brush', STROKE),
      viaApi: async (p) => { await stroke(p, { points: STROKE }); },
    });
  });
});

test.describe('paint.stroke refusals against the UI', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  test('on a locked layer the drag does nothing silently and paint.stroke is refused', async ({ page }) => {
    const said: string[][] = [];
    let refusal: unknown = null;
    await compareUiAndApi(page, {
      setup: async (p) => {
        await redSetup(p);
        await rowButton(p, await activeLayerId(p), 'Lock layer').click();
        await settle(p);
      },
      viaUi: async (p) => {
        await toolDrag(p, 'brush', STROKE);
        said.push(await toasts(p));
      },
      viaApi: async (p) => {
        refusal = await runError(p, { op: 'paint.stroke', points: STROKE });
        said.push(await toasts(p));
      },
    });
    expect(said).toEqual([[], []]);
    expect(refusal).toEqual({ code: 'refused', message: '"Layer 1" is locked: unlock it to use the Brush tool on it.' });
  });

  const TARGETS = [
    ['a text layer', async (p: Page) => {
      await startTextEditing(p, 100, 80, 'Hi');
      await p.keyboard.press('Shift+Enter');
      await settle(p);
    }, TEXT_REFUSAL],
    ['a group', async (p: Page) => { await p.locator('[aria-label="New Group"]').click(); await settle(p); }, GROUP_REFUSAL],
  ] as const;

  for (const [what, make, message] of TARGETS) {
    test(`on ${what} the drag toasts and paint.stroke is refused with the same text`, async ({ page }) => {
      const said: string[][] = [];
      let refusal: unknown = null;
      await compareUiAndApi(page, {
        setup: async (p) => {
          await redSetup(p);
          await make(p);
        },
        viaUi: async (p) => {
          await toolDrag(p, 'brush', STROKE);
          said.push(await toasts(p));
        },
        viaApi: async (p) => {
          refusal = await runError(p, { op: 'paint.stroke', points: STROKE });
          said.push(await toasts(p));
        },
      });
      expect(said[0]).toEqual([message]);
      expect(refusal).toEqual({ code: 'refused', message });
    });
  }
});

test.describe('paint.stroke on its own', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await page.waitForSelector('[data-testid="canvas-container"]');
    await settle(page, 300);
    await run(page, { op: 'color.set', foreground: '#ff0000' });
  });

  test('refuses stamp with no source set, and source on a tool without one', async ({ page }) => {
    expect(await runError(page, { op: 'paint.stroke', tool: 'stamp', points: STROKE })).toEqual({
      code: 'refused',
      message: 'No clone source is set for the stamp tool: pass source, the point to sample from, as an Alt-click sets it in the UI.',
    });
    expect(await runError(page, { op: 'paint.stroke', points: STROKE, source: { x: 1, y: 1 } })).toEqual({
      code: 'invalid',
      message: 'paint.stroke: source is only for the stamp and healing tools, not brush.',
    });
    expect(await runError(page, { op: 'paint.stroke', tool: 'airbrush', points: STROKE })).toMatchObject({ code: 'invalid' });
    expect(await runError(page, { op: 'paint.stroke', points: [] })).toMatchObject({ code: 'invalid' });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('line with no previous stroke on the layer is a plain dab, as a Shift-click is', async ({ page }) => {
    const before = await snapshot(page);
    expect(await stroke(page, { points: [{ x: 50, y: 50 }], line: true })).toEqual({ tool: 'brush', layer: expect.any(String), line: false });
    const after = await snapshot(page);
    expect(after.composite).not.toBe(before.composite);
  });

  test('leaves no hold-to-smooth timer running: nothing changes in the 2 s after it resolves', async ({ page }) => {
    await stroke(page, { points: STROKE });
    const before = await snapshot(page);
    await page.waitForTimeout(2000);
    const after = await snapshot(page);
    expect(after).toEqual(before);
    expect(after.history.undo).toEqual(['New Document', 'Brush']);
  });

  test('a 200-point stroke resolves as one history step', async ({ page }) => {
    const points = Array.from({ length: 200 }, (_, i) => ({ x: 10 + (i * 0.9), y: 75 + 40 * Math.sin(i / 12) }));
    const before = await snapshot(page);
    await stroke(page, { points });
    const after = await snapshot(page);
    expect(after.history.undo).toEqual(['New Document', 'Brush']);
    expect(after.composite).not.toBe(before.composite);
  });
});
