/**
 * layer.transform (src/commands/layer/transform.ts) against the Move tool's
 * options-bar buttons (Rotate 90° CW / CCW, Flip Horizontal / Vertical)
 * followed by Cmd+D, for one layer with off-centre content and a mask, for
 * two layers selected together, and for a live text layer; then the
 * refusals.
 */
import { test, expect, run, runError, compareUiAndApi, type Page } from './harness';
import { docToScreen } from '../helpers';
import { clickMenu, dragMarquee, fillRect, historyLabels, settle, surfaceState } from '../surface-helpers';
import { clickLayerRow, layerByName, pressKey } from '../surface-helpers-keys';

type Invocation = { op: string; [key: string]: unknown };

const ORANGE = { r: 240, g: 140, b: 20 };
const BLUE = { r: 30, g: 60, b: 220 };

async function addLayer(page: Page): Promise<void> {
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
}

/** Layer 2: an orange block left of centre, masked to a smaller square; active, nothing selected. */
async function maskedLayer(page: Page): Promise<void> {
  await clickMenu(page, 'View', 'Actual Size');
  await addLayer(page);
  await fillRect(page, 20, 20, 90, 70, ORANGE);
  await dragMarquee(page, 30, 25, 70, 60);
  await page.locator('[aria-label="Add Mask"]').click();
  await settle(page);
  await pressKey(page, 'ControlOrMeta+d');
}

/** maskedLayer, then Layer 3 with a blue block lower right; Layer 2 and Layer 3 both selected, Layer 2 active. */
async function twoLayers(page: Page): Promise<void> {
  await maskedLayer(page);
  await addLayer(page);
  await fillRect(page, 120, 80, 170, 130, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
  const state = await surfaceState(page);
  await clickLayerRow(page, layerByName(state, 'Layer 2').id);
  await clickLayerRow(page, layerByName(state, 'Layer 3').id, ['ControlOrMeta']);
}

async function pressButton(page: Page, name: string): Promise<void> {
  await pressKey(page, 'v');
  await settle(page, 300);
  await page.getByRole('button', { name, exact: true }).click();
  await settle(page, 300);
  await pressKey(page, 'ControlOrMeta+d', 300);
}

async function api(page: Page, invocation: Invocation): Promise<unknown> {
  const result = await run(page, invocation);
  await settle(page, 300);
  return result;
}

interface TextShape {
  text: string;
  x: number;
  y: number;
  transform: unknown;
}

async function textShape(page: Page): Promise<TextShape[]> {
  return page.evaluate(() => {
    type T = { type: string; text: string; x: number; y: number; transform?: unknown };
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { document: { layers: T[] } } };
    return store.getState().document.layers
      .filter((l) => l.type === 'text')
      .map((l) => ({ text: l.text, x: l.x, y: l.y, transform: l.transform ?? null }));
  });
}

const BUTTONS: ReadonlyArray<readonly [string, Invocation, string]> = [
  ['Rotate 90° CW', { op: 'layer.transform', rotate: 90 }, 'Rotate Layer 90° CW'],
  ['Rotate 90° CCW', { op: 'layer.transform', rotate: -90 }, 'Rotate Layer 90° CCW'],
  ['Flip Horizontal', { op: 'layer.transform', flip: 'horizontal' }, 'Transform'],
  ['Flip Vertical', { op: 'layer.transform', flip: 'vertical' }, 'Transform'],
];

test.describe('layer.transform against the Move options buttons', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the options bar and Layers panel need the desktop layout');
  });

  for (const [button, invocation, label] of BUTTONS.slice(0, 2)) {
    test(`one masked layer: ${button}`, async ({ page }) => {
      const results: unknown[] = [];
      const { ui, api: after } = await compareUiAndApi(page, {
        withEditorState: true,
        setup: maskedLayer,
        viaUi: (p) => pressButton(p, button),
        viaApi: async (p) => { results.push(await api(p, invocation)); },
      });
      expect(results).toEqual([{ layers: [expect.any(String)] }]);
      expect(after.history.undo.at(-1)).toBe(label);
      expect(ui.layers.find((l) => l.name === 'Layer 2')?.mask).not.toBeNull();
    });
  }

  for (const [button, invocation] of BUTTONS) {
    test(`two layers selected: ${button}`, async ({ page }) => {
      const results: unknown[] = [];
      const { api: after } = await compareUiAndApi(page, {
        withEditorState: true,
        setup: twoLayers,
        viaUi: (p) => pressButton(p, button),
        viaApi: async (p) => { results.push(await api(p, { ...invocation, layers: ['Layer 2', 'Layer 3'] })); },
      });
      expect(results).toEqual([{ layers: [expect.any(String), expect.any(String)] }]);
      expect(after.history.undo.at(-1)).toBe('Transform');
    });
  }

  for (const [button, invocation, label] of [BUTTONS[0]!, BUTTONS[2]!]) {
    test(`a text layer stays live: ${button}`, async ({ page }) => {
      const shapes: TextShape[][] = [];
      const { api: after } = await compareUiAndApi(page, {
        withEditorState: true,
        width: 300,
        height: 200,
        setup: async (p) => {
          await clickMenu(p, 'View', 'Actual Size');
          await pressKey(p, 't');
          const at = await docToScreen(p, 60, 80);
          await p.mouse.click(at.x, at.y);
          await p.keyboard.type('Turn me');
          await p.keyboard.press('Tab');
          await settle(p, 300);
        },
        viaUi: async (p) => {
          await pressButton(p, button);
          shapes.push(await textShape(p));
        },
        viaApi: async (p) => {
          await api(p, invocation);
          shapes.push(await textShape(p));
        },
      });
      expect(shapes[1]).toEqual(shapes[0]);
      expect(shapes[1]?.[0]?.transform).not.toBeNull();
      expect(after.layers.find((l) => l.type === 'text')?.type).toBe('text');
      expect(after.history.undo.at(-1)).toBe(label);
    });
  }
});

test.describe('layer.transform on its own', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the Layers panel needs the desktop layout');
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await page.waitForSelector('[data-testid="canvas-container"]');
    await settle(page, 300);
  });

  test('refusals', async ({ page }) => {
    expect(await runError(page, { op: 'layer.transform' })).toEqual({ code: 'invalid', message: 'layer.transform: pass exactly one of rotate or flip.' });
    expect(await runError(page, { op: 'layer.transform', rotate: 90, flip: 'vertical' })).toEqual({ code: 'invalid', message: 'layer.transform: pass exactly one of rotate or flip.' });
    expect(await runError(page, { op: 'layer.transform', rotate: 45 })).toMatchObject({ code: 'invalid' });
    expect(await runError(page, { op: 'layer.transform', layer: 'Layer 1', layers: ['Layer 1', 'Layer 1'], rotate: 90 })).toMatchObject({ code: 'invalid' });
    expect(await runError(page, { op: 'layer.transform', flip: 'horizontal' })).toEqual({
      code: 'refused',
      message: 'The Move tool shows its flip buttons for a selection, several layers, a group or a text layer, not for the single layer "Layer 1": image.flip-layer flips it (Image > Flip).',
    });
    await run(page, { op: 'select.rect', x: 10, y: 10, width: 40, height: 40 });
    expect((await runError(page, { op: 'layer.transform', rotate: 90 })).code).toBe('refused');
    expect(await historyLabels(page)).toEqual(['New Document']);
  });
});
