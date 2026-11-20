/**
 * layer.transform's handle drags against the same drags made with the
 * mouse. The UI side drags a real transform handle at View > Actual Size,
 * from the handle's own (whole-pixel) position to a whole document pixel in
 * one move, reads the angle or factors the drag gave from the editor, and
 * ends it with Cmd+D. The API side, on a second identical document, runs
 * layer.transform with that angle or those factors. The command presses the
 * same handle at the same pixel and picks the whole-pixel release that
 * reaches the request nearest, which for an angle or factors a whole-pixel
 * drag gave is that drag's own release point (or one on the same ray), so
 * the documents match exactly, pixels and history included.
 */
import { test, expect, run, compareUiAndApi, type Page } from './harness';
import { docToScreen } from '../helpers';
import { clickMenu, fillRect, settle, surfaceState } from '../surface-helpers';
import { clickLayerRow, layerByName, pressKey } from '../surface-helpers-keys';

interface Point {
  x: number;
  y: number;
}

interface Reached {
  rotation: number;
  scaleX: number;
  scaleY: number;
}

const ORANGE = { r: 224, g: 102, b: 42 };
const BLUE = { r: 42, g: 106, b: 224 };

/** Layer 1: an orange block (100, 70)-(160, 110), nothing selected. */
async function oneBlock(page: Page): Promise<void> {
  await clickMenu(page, 'View', 'Actual Size');
  await fillRect(page, 100, 70, 160, 110, ORANGE);
  await pressKey(page, 'ControlOrMeta+d');
}

/** oneBlock, then Layer 2 with a blue block (130, 100)-(170, 130); both selected, Layer 1 active. */
async function twoBlocks(page: Page): Promise<void> {
  await oneBlock(page);
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await fillRect(page, 130, 100, 170, 130, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
  const state = await surfaceState(page);
  await clickLayerRow(page, layerByName(state, 'Layer 1').id);
  await clickLayerRow(page, layerByName(state, 'Layer 2').id, ['ControlOrMeta']);
}

/** Cmd-click the active layer's thumbnail: its pixels become the selection, framed by handles. */
async function selectActiveLayerPixels(page: Page): Promise<void> {
  const id = (await surfaceState(page)).activeLayerId;
  await page.locator(`[data-layer-id="${id}"] div[class*="thumbnail"]`).first().click({ modifiers: ['ControlOrMeta'] });
  await settle(page, 300);
}

/** A mouse drag from `from` to `to` in one move, holding still after the press as a hand does. */
async function handleDrag(page: Page, from: Point, to: Point): Promise<void> {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.move(end.x, end.y, { steps: 1 });
  await page.mouse.up();
  await settle(page, 300);
}

/** The pending transform the drag left: the selection's, or the selected layers' shared box. */
async function reached(page: Page, box: 'selection' | 'layers'): Promise<Reached> {
  return page.evaluate((which) => {
    type T = { rotation: number; scaleX: number; scaleY: number };
    const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { transform: T | null; layerTransform: T | null } };
    const t = which === 'selection' ? ui.getState().transform : ui.getState().layerTransform;
    if (!t) throw new Error('no pending transform');
    return { rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY };
  }, box);
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

test.describe('layer.transform against a mouse drag of the Move tool\'s handles', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the Layers panel needs the desktop layout');
  });

  test('one layer: a rotate-handle drag after a Cmd-click on its thumbnail', async ({ page }) => {
    let ui: Reached | null = null;
    const results: unknown[] = [];
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: oneBlock,
      viaUi: async (p) => {
        await pressKey(p, 'v');
        await selectActiveLayerPixels(p);
        // The rotate handle sits 20 px out from the top-right corner (160, 70).
        await handleDrag(p, { x: 180, y: 50 }, { x: 190, y: 120 });
        ui = await reached(p, 'selection');
        await pressKey(p, 'ControlOrMeta+d', 300);
      },
      viaApi: async (p) => {
        results.push(await run(p, { op: 'layer.transform', rotate: degrees(ui!.rotation) }));
        await settle(p, 300);
      },
    });
    expect(Math.abs(degrees(ui!.rotation))).toBeGreaterThan(5);
    expect(results).toEqual([{ layers: [expect.any(String)], rotate: expect.any(Number) }]);
    expect(api.history.undo.at(-1)).toBe('Transform');
    expect(api.selection.active).toBe(false);
  });

  test('one layer: a corner drag after a Cmd-click on its thumbnail', async ({ page }) => {
    let ui: Reached | null = null;
    await compareUiAndApi(page, {
      withEditorState: true,
      setup: oneBlock,
      viaUi: async (p) => {
        await pressKey(p, 'v');
        await selectActiveLayerPixels(p);
        await handleDrag(p, { x: 160, y: 110 }, { x: 190, y: 125 });
        ui = await reached(p, 'selection');
        await pressKey(p, 'ControlOrMeta+d', 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.transform', scale: { x: ui!.scaleX, y: ui!.scaleY } });
        await settle(p, 300);
      },
    });
    expect(ui).toMatchObject({ scaleX: 1.5, scaleY: 1.375 });
  });

  test('two layers: a rotate-handle drag of their shared box', async ({ page }) => {
    let ui: Reached | null = null;
    const { api } = await compareUiAndApi(page, {
      withEditorState: true,
      setup: twoBlocks,
      viaUi: async (p) => {
        await pressKey(p, 'v');
        // The box is the union (100, 70)-(170, 130); its top-left rotate handle is at (80, 50).
        await handleDrag(p, { x: 80, y: 50 }, { x: 60, y: 110 });
        ui = await reached(p, 'layers');
        await pressKey(p, 'ControlOrMeta+d', 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.transform', layers: ['Layer 1', 'Layer 2'], rotate: degrees(ui!.rotation) });
        await settle(p, 300);
      },
    });
    expect(Math.abs(degrees(ui!.rotation))).toBeGreaterThan(5);
    expect(api.history.undo.at(-1)).toBe('Transform');
  });

  test('two layers: an edge drag of their shared box', async ({ page }) => {
    let ui: Reached | null = null;
    await compareUiAndApi(page, {
      withEditorState: true,
      setup: twoBlocks,
      viaUi: async (p) => {
        await pressKey(p, 'v');
        // The left edge's handle, at the middle of x = 100; the right edge stays.
        await handleDrag(p, { x: 100, y: 100 }, { x: 72, y: 100 });
        ui = await reached(p, 'layers');
        await pressKey(p, 'ControlOrMeta+d', 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'layer.transform', layers: ['Layer 1', 'Layer 2'], scale: { x: ui!.scaleX, y: 1 }, anchor: 'right' });
        await settle(p, 300);
      },
    });
    expect(ui).toMatchObject({ scaleX: 1.4, scaleY: 1 });
  });
});
