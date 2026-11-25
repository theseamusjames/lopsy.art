/**
 * `paint.fill`, `color.*` and `tool.*` (src/commands/paint/fill.ts,
 * src/commands/color/color.ts, src/commands/tool/tool.ts): each against the
 * menu item, panel field, key, toolbox button or options-bar control it
 * stands for, then on its own for every refusal. Colours and tool options are
 * ambient editor state, so the comparisons also run the same Fill, brush
 * stroke or gradient drag on both sides and compare the pixels it leaves.
 */
import { test, expect, run, runError, compareUiAndApi, editorState, snapshot, type Page } from './harness';
import { createDocument, selectTool, setForegroundColor, setToolOption } from '../helpers';
import {
  brushStroke,
  clickMenu,
  dragMarquee,
  dragOnCanvas,
  historyLabels,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
} from '../surface-helpers';
import { pressKey, rowButton } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

interface FillResult {
  layer: string;
  target: 'pixels' | 'mask';
}

interface ToolOptions {
  tool: string;
  options: Record<string, unknown>;
}

async function editFill(page: Page): Promise<void> {
  await clickMenu(page, 'Edit', 'Fill');
  await settle(page);
}

async function activeLayerId(page: Page): Promise<string> {
  const id = (await surfaceState(page)).activeLayerId;
  if (!id) throw new Error('no active layer');
  return id;
}

async function toolOptions(page: Page, tool: string): Promise<Record<string, unknown>> {
  return (await run<ToolOptions>(page, { op: 'tool.options', tool })).options;
}

/** Commit a text layer through the UI. */
async function addTextLayer(page: Page): Promise<void> {
  await startTextEditing(page, 100, 80, 'Hi');
  await page.keyboard.press('Shift+Enter');
  await settle(page);
}

function addMaskButton(page: Page) {
  return page.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name: 'Add Mask', exact: true });
}

async function redForeground(page: Page): Promise<void> {
  await setForegroundColor(page, RED.r, RED.g, RED.b);
}

test.describe('Edit > Fill and paint.fill', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and Layers panel need the desktop layout');
  });

  test('paint.fill matches Edit > Fill with no selection', async ({ page }) => {
    const results: FillResult[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: redForeground,
      viaUi: editFill,
      viaApi: async (p) => {
        results.push(await run<FillResult>(p, { op: 'paint.fill' }));
      },
    });
    expect(results[0]?.target).toBe('pixels');
    expect(api.history.undo).toEqual(['New Document', 'Fill']);
    expect(api.layers[1]!.pixels).not.toEqual((await freshBlankHash(page)));
  });

  test('paint.fill matches Edit > Fill inside a marquee selection', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await redForeground(p);
        await dragMarquee(p, 40, 30, 120, 90);
      },
      viaUi: editFill,
      viaApi: async (p) => {
        await run(p, { op: 'paint.fill' });
      },
    });
    expect(api.selection.active).toBe(true);
    expect(api.history.undo).toEqual(['New Document', 'Fill']);
  });

  test('paint.fill matches Edit > Fill in mask edit mode: the mask is filled', async ({ page }) => {
    const results: FillResult[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await dragMarquee(p, 40, 30, 120, 90);
        await addMaskButton(p).click();
        await settle(p);
        await setForegroundColor(p, 0, 0, 0);
        await dragMarquee(p, 20, 20, 60, 60);
      },
      viaUi: editFill,
      viaApi: async (p) => {
        results.push(await run<FillResult>(p, { op: 'paint.fill' }));
      },
    });
    expect(results[0]?.target).toBe('mask');
    expect(api.history.undo.at(-1)).toBe('Mask Fill');
    expect(api.layers[1]!.mask).not.toBeNull();
  });

  test('on a locked layer the menu does nothing silently and paint.fill is refused', async ({ page }) => {
    const said: string[][] = [];
    let refusal = { code: '', message: '' };
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await redForeground(p);
        await rowButton(p, await activeLayerId(p), 'Lock layer').click();
        await settle(p);
      },
      viaUi: async (p) => {
        await editFill(p);
        said.push(await toasts(p));
      },
      viaApi: async (p) => {
        refusal = await runError(p, { op: 'paint.fill' });
        said.push(await toasts(p));
      },
    });
    expect(said).toEqual([[], []]);
    expect(refusal).toEqual({ code: 'refused', message: '"Layer 1" is locked: unlock it to fill it.' });
    expect(api.history.undo).toEqual(['New Document', 'Lock Layer']);
  });

  for (const [what, setup, text] of [
    ['a text layer', addTextLayer, TEXT_REFUSAL],
    ['a group', async (p: Page) => { await p.locator('[aria-label="New Group"]').click(); await settle(p); }, GROUP_REFUSAL],
  ] as const) {
    test(`on ${what} the menu toasts and paint.fill is refused with the same text`, async ({ page }) => {
      const said: string[][] = [];
      let refusal = { code: '', message: '' };
      await compareUiAndApi(page, {
        setup,
        viaUi: async (p) => {
          await editFill(p);
          said.push(await toasts(p));
        },
        viaApi: async (p) => {
          refusal = await runError(p, { op: 'paint.fill' });
          said.push(await toasts(p));
        },
      });
      expect(said).toEqual([[text], []]);
      expect(refusal).toEqual({ code: 'refused', message: text });
    });
  }
});

/** The hash a blank Layer 1 has in a 200x150 document. */
async function freshBlankHash(page: Page): Promise<string | null> {
  await createDocument(page, 200, 150, false);
  await settle(page, 300);
  return (await snapshot(page)).layers[1]!.pixels;
}

test.describe('the Color panel and keys, and the color commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the Color panel needs the desktop layout');
  });

  test('color.set matches typing a hex into the Color panel, and the same Fill lands identically', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      viaUi: async (p) => {
        await setForegroundColor(p, 0x12, 0x34, 0x56);
        await editFill(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'color.set', foreground: '#123456' })).toEqual({ foreground: '#123456', background: '#ffffff' });
        await editFill(p);
      },
    });
    expect(api.editor.foreground).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
    expect(api.history.undo).toEqual(['New Document', 'Fill']);
  });

  test('color.swap and color.reset match the X and D keys', async ({ page }) => {
    const seen: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: (p) => setForegroundColor(p, 0x12, 0x34, 0x56),
      viaUi: async (p) => {
        await pressKey(p, 'x');
        seen.push(await editorState(p));
        await editFill(p);
        await pressKey(p, 'd');
      },
      viaApi: async (p) => {
        await run(p, { op: 'color.swap' });
        seen.push(await editorState(p));
        await editFill(p);
        expect(await run(p, { op: 'color.reset' })).toEqual({ foreground: '#000000', background: '#ffffff' });
      },
    });
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[0]).toMatchObject({ foreground: { r: 255, g: 255, b: 255 }, background: { r: 0x12, g: 0x34, b: 0x56 } });
    expect(api.editor).toMatchObject({ foreground: { r: 0, g: 0, b: 0 }, background: { r: 255, g: 255, b: 255 } });
  });

  test('the color commands push no history', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    await run(page, [{ op: 'color.set', foreground: '#ff0000', background: '#00ff00' }, { op: 'color.swap' }]);
    expect(await editorState(page)).toMatchObject({ foreground: { r: 0, g: 255, b: 0 }, background: { r: 255, g: 0, b: 0 } });
    await run(page, { op: 'color.reset' });
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect((await runError(page, { op: 'color.set' })).code).toBe('invalid');
  });
});

test.describe('the toolbox and options bar, and the tool commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the toolbox and options bar need the desktop layout');
  });

  test('tool.select matches a toolbox click', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      viaUi: async (p) => {
        await p.locator('[data-tool-id="wand"]').click();
        await settle(p);
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'tool.select', tool: 'wand' })).toEqual({ tool: 'wand' });
      },
    });
    expect(api.editor.tool).toBe('wand');
  });

  test('tool.select commits text being edited, as a toolbox click does', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: (p) => startTextEditing(p, 60, 60, 'Hi'),
      viaUi: async (p) => {
        await p.locator('[data-tool-id="brush"]').click();
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'tool.select', tool: 'brush' });
        await settle(p, 300);
      },
    });
    expect((await surfaceState(page)).textEditing).toBe(false);
    expect(api.layers.some((l) => l.type === 'text')).toBe(true);
    expect(api.editor.tool).toBe('brush');
  });

  test('tool.set brush size and hardness match the options bar, and the same stroke lands identically', async ({ page }) => {
    const options: unknown[] = [];
    const stroke = [{ x: 30, y: 40 }, { x: 100, y: 80 }, { x: 170, y: 60 }];
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: async (p) => {
        await redForeground(p);
        await selectTool(p, 'brush');
      },
      viaUi: async (p) => {
        await setToolOption(p, 'Size', 40);
        await setToolOption(p, 'Hardness', 50);
        options.push(await toolOptions(p, 'brush'));
        await brushStroke(p, stroke);
      },
      viaApi: async (p) => {
        await run(p, { op: 'tool.set', tool: 'brush', options: { size: 40, hardness: 50 } });
        options.push(await toolOptions(p, 'brush'));
        await brushStroke(p, stroke);
      },
    });
    expect(options[1]).toEqual(options[0]);
    expect(options[0]).toMatchObject({ size: 40, hardness: 50 });
    expect(api.history.undo).toEqual(['New Document', 'Brush']);
  });

  test('tool.set marquee feather matches the options bar, and the same select.rect + Fill lands identically', async ({ page }) => {
    const options: unknown[] = [];
    const selectAndFill = async (p: Page): Promise<void> => {
      await run(p, { op: 'select.rect', x: 50, y: 40, width: 100, height: 70 });
      await editFill(p);
    };
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await redForeground(p);
        await selectTool(p, 'marquee-rect');
      },
      viaUi: async (p) => {
        await setToolOption(p, 'Feather', 6);
        options.push(await toolOptions(p, 'marquee-rect'));
        await selectAndFill(p);
      },
      viaApi: async (p) => {
        await run(p, { op: 'tool.set', tool: 'marquee-rect', options: { feather: 6 } });
        options.push(await toolOptions(p, 'marquee-rect'));
        await selectAndFill(p);
      },
    });
    expect(options[1]).toEqual(options[0]);
    expect(options[0]).toMatchObject({ feather: 6 });
    expect(api.selection.bounds).not.toEqual({ x: 50, y: 40, width: 100, height: 70 });
  });

  test('tool.set gradient stops match the Gradient Editor, and the same gradient drag lands identically', async ({ page }) => {
    const options: Array<Record<string, unknown>> = [];
    const drag = async (p: Page): Promise<void> => {
      await dragOnCanvas(p, { x: 20, y: 75 }, { x: 180, y: 75 });
    };
    const { api } = await compareUiAndApi(page, {
      setup: (p) => selectTool(p, 'gradient'),
      viaUi: async (p) => {
        await p.getByTestId('gradient-swatch').click();
        const dialog = p.getByRole('dialog', { name: 'Gradient Editor' });
        const bar = dialog.getByTestId('gradient-bar');
        const box = await bar.boundingBox();
        if (!box) throw new Error('no gradient bar');
        await bar.click({ position: { x: box.width * 0.4, y: box.height / 2 } });
        const hex = dialog.locator('[aria-label="Hex color"]');
        await hex.fill('00ff00');
        await hex.press('Enter');
        await dialog.getByTestId('gradient-stop-0').click();
        await hex.fill('ff0000');
        await hex.press('Enter');
        await dialog.getByRole('button', { name: 'Done' }).click();
        await settle(p);
        options.push(await toolOptions(p, 'gradient'));
        await drag(p);
      },
      viaApi: async (p) => {
        const stops = options[0]?.stops;
        await run(p, { op: 'tool.set', tool: 'gradient', options: { stops } });
        options.push(await toolOptions(p, 'gradient'));
        await drag(p);
      },
    });
    expect(options[1]).toEqual(options[0]);
    const stops = options[0]!.stops as Array<{ position: number; color: string }>;
    expect(stops.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#ffffff']);
    expect(stops[1]!.position).toBeGreaterThan(0.3);
    expect(stops[1]!.position).toBeLessThan(0.5);
    expect(api.history.undo.at(-1)).toBe('Linear Gradient');
  });

  test('the tool commands read, describe and refuse, and push no history', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    const described = await run<{ tools: Record<string, Record<string, { type: string; min?: number; max?: number; value: unknown }>> }>(
      page, { op: 'tool.describe', tool: 'brush' },
    );
    expect(described.tools.brush!.size).toMatchObject({ type: 'number', min: 1, max: 300, value: 10 });
    const before = await toolOptions(page, 'shape');
    const after = await run<ToolOptions>(page, { op: 'tool.set', tool: 'shape', options: { mode: 'polygon', polygonSides: 7, strokeColor: '#00ff00' } });
    expect(after.options).toMatchObject({ mode: 'polygon', polygonSides: 7, strokeColor: '#00ff00' });
    expect(after.options).not.toEqual(before);
    expect(await runError(page, { op: 'tool.set', tool: 'brush', options: { feather: 2 } })).toEqual({
      code: 'invalid',
      message: 'tool.set: unknown option "feather"; valid options for brush: size, opacity, hardness, fade, symmetryHorizontal, symmetryVertical, symmetryRadialSegments',
    });
    expect((await runError(page, { op: 'tool.set', tool: 'brush', options: { size: 301 } })).message).toBe(
      'tool.set: options.size must be from 1 to 300 in this document, got 301',
    );
    await run(page, { op: 'tool.select', tool: 'eraser' });
    expect(await run(page, { op: 'tool.options' })).toEqual({ tool: 'eraser', options: { size: 10, opacity: 100 } });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('tool.set refuses text options while a text layer is active', async ({ page }) => {
    await createDocument(page, 200, 150, false);
    await settle(page, 300);
    await addTextLayer(page);
    const error = await runError(page, { op: 'tool.set', tool: 'text', options: { fontSize: 40 } });
    expect(error.code).toBe('refused');
    expect(error.message).toMatch(/^The active layer ".*" is a text layer: the text options would restyle it\. Restyle it with text\.style, or select another layer first\.$/);
    expect((await toolOptions(page, 'text')).fontSize).toBe(24);
  });
});
