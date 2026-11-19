/**
 * The `image` commands and `doc.color-mode` (src/commands/image/image.ts,
 * src/commands/document/color-mode.ts): each against the Image menu item,
 * dialog, Edit > Crop or Crop-tool drag it stands for, then on its own for
 * every refusal. Snapshots carry paths and guides, so a comparison fails when
 * an operation leaves them somewhere the UI does not.
 *
 * The rich document is 200x150: red and blue blocks on Layer 1, a green block
 * on Layer 2 moved to an offset, a mask on Layer 2 revealing part of it, a
 * vertical and a horizontal guide, and a two-anchor pen path.
 */
import type { Locator } from '@playwright/test';
import { test, expect, run, runError, compareUiAndApi, snapshot, type Page } from './harness';
import { docToScreen, selectTool } from '../helpers';
import {
  clickMenu,
  dragMarquee,
  dragOnCanvas,
  fillRect,
  historyLabels,
  menuItem,
  settle,
  startTextEditing,
  surfaceState,
  toasts,
} from '../surface-helpers';
import { docPixel, openMenuDialog, type Rgba } from '../surface-helpers-filters';
import { pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const GREEN = { r: 0, g: 200, b: 0 };
const TEXT_FLIP_REFUSAL = 'Rasterize this text layer to flip it.';
const GROUP_FLIP_REFUSAL = 'Rasterize the text layers in this group before flipping it.';

interface Size {
  width: number;
  height: number;
}

async function clickDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await settle(page, 120);
}

async function paintLayer1(page: Page): Promise<void> {
  await fillRect(page, 10, 10, 60, 40, RED);
  await pressKey(page, 'ControlOrMeta+d');
  await fillRect(page, 40, 30, 100, 70, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
  await settle(page);
}

async function addGuides(page: Page): Promise<void> {
  const rect = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  await page.mouse.click((await docToScreen(page, 70, 0)).x, rect.top + 6);
  await settle(page);
  await page.mouse.click(rect.left + 6, (await docToScreen(page, 0, 50)).y);
  await settle(page);
}

async function addPath(page: Page): Promise<void> {
  await selectTool(page, 'path');
  await clickDoc(page, 30, 120);
  await clickDoc(page, 170, 100);
  await page.locator('[aria-label="Commit path"]').click();
  await settle(page, 200);
}

/** Everything a canvas-wide operation has to carry along: see the file comment. */
async function richDocument(page: Page): Promise<void> {
  await paintLayer1(page);
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await fillRect(page, 110, 40, 170, 100, GREEN);
  await pressKey(page, 'ControlOrMeta+d');
  await selectTool(page, 'move');
  await dragOnCanvas(page, { x: 140, y: 70 }, { x: 150, y: 80 });
  await dragMarquee(page, 120, 60, 200, 150);
  await page.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name: 'Add Mask', exact: true }).click();
  await settle(page);
  await addGuides(page);
  await addPath(page);
  await selectTool(page, 'marquee-rect');
  const snap = await snapshot(page);
  expect(snap.layers.find((l) => l.name === 'Layer 2')!.hasMask).toBe(true);
  expect(snap.guides).toHaveLength(2);
  expect(snap.paths).toHaveLength(1);
}

async function commitText(page: Page, x: number, y: number, text: string): Promise<void> {
  await startTextEditing(page, x, y, text);
  await page.keyboard.press('Shift+Enter');
  await settle(page, 400);
}

/** Layer "Border"'s pixel near the top-left of the frame. */
async function borderPixel(page: Page): Promise<Rgba> {
  const id = (await surfaceState(page)).layers.find((l) => l.name === 'Border')?.id;
  if (!id) throw new Error('no Border layer');
  return docPixel(page, 3, 3, id);
}

function numberInputs(dialog: Locator): Locator {
  return dialog.locator('input[type="number"]');
}

async function colorMode(page: Page): Promise<string> {
  return (await snapshot(page)).document.colorMode;
}

async function pathTextLayer(page: Page): Promise<void> {
  await selectTool(page, 'path');
  await clickDoc(page, 20, 100);
  await clickDoc(page, 180, 100);
  await page.locator('[aria-label="Commit path"]').click();
  await settle(page, 200);
  const pathId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { paths: Array<{ id: string }> } };
    return store.getState().paths[0]!.id;
  });
  await startTextEditing(page, 40, 40, 'Path');
  await page.keyboard.press('Tab');
  await settle(page, 300);
  await page.locator('[aria-label="Text path"]').selectOption(pathId);
  await expect.poll(() => page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; pathId?: string }> } };
    };
    const doc = store.getState().document;
    return doc.layers.find((l) => l.id === doc.activeLayerId)?.pathId ?? null;
  }), { timeout: 15_000 }).toBe(pathId);
  await settle(page, 400);
}

async function groupWithText(page: Page): Promise<void> {
  await page.locator('[aria-label="New Group"]').click();
  await settle(page);
  const group = (await surfaceState(page)).activeLayerId!;
  await page.locator('[aria-label="Add Layer"]').click();
  await settle(page);
  await fillRect(page, 10, 10, 60, 40, RED);
  await pressKey(page, 'ControlOrMeta+d');
  await commitText(page, 120, 100, 'Hi');
  await selectTool(page, 'move');
  await page.locator(`[data-layer-id="${group}"]`).click();
  await settle(page);
}

test.describe('the Image menu and the image commands', () => {
  test.describe.configure({ timeout: 150_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar and rulers need the desktop layout');
  });

  for (const c of [
    { what: 'enlarging about the top-left', width: 260, height: 190, anchor: 'left-top', button: 'Anchor left top' },
    { what: 'shrinking about the bottom-right', width: 150, height: 110, anchor: 'right-bottom', button: 'Anchor right bottom' },
  ]) {
    test(`image.canvas-size matches the Canvas Size dialog ${c.what}`, async ({ page }) => {
      let result: Size | null = null;
      const { api } = await compareUiAndApi(page, {
        setup: richDocument,
        viaUi: async (p) => {
          const dialog = await openMenuDialog(p, 'Image', 'Canvas Size...', 'Canvas Size');
          await numberInputs(dialog).nth(0).fill(String(c.width));
          await numberInputs(dialog).nth(1).fill(String(c.height));
          await dialog.getByRole('button', { name: c.button, exact: true }).click();
          await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await settle(p, 300);
        },
        viaApi: async (p) => {
          result = await run<Size>(p, { op: 'image.canvas-size', width: c.width, height: c.height, anchor: c.anchor });
        },
      });
      expect(result).toEqual({ width: c.width, height: c.height });
      expect(api.document).toMatchObject({ width: c.width, height: c.height });
      expect(api.history.undo.at(-1)).toBe('Resize Canvas');
    });
  }

  test('image.size matches the Image Size dialog with proportions kept', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: richDocument,
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Image', 'Image Size...', 'Image Size');
        await numberInputs(dialog).nth(0).fill('100');
        await expect(numberInputs(dialog).nth(1)).toHaveValue('75');
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
      },
      viaApi: async (p) => {
        expect(await run<Size>(p, { op: 'image.size', width: 100, height: 75 })).toEqual({ width: 100, height: 75 });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Resize Image');
  });

  test('image.border matches the Border dialog expanding by 10 px', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: richDocument,
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Image', 'Border...', 'Border');
        await dialog.getByLabel('Border width (px)').fill('10');
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
      },
      viaApi: async (p) => {
        const result = await run<Size & { layer: string }>(p, { op: 'image.border', width: 10 });
        expect(result).toMatchObject({ width: 220, height: 170 });
      },
    });
    expect(api.document).toMatchObject({ width: 220, height: 170 });
    expect(api.history.undo.at(-1)).toBe('Border');
  });

  test('image.border matches the Border dialog: asymmetric overlay with rounded corners', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer1,
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Image', 'Border...', 'Border');
        await dialog.getByLabel('Asymmetric').check();
        await dialog.getByLabel('Top (px)').fill('5');
        await dialog.getByLabel('Bottom (px)').fill('15');
        await dialog.getByLabel('Left (px)').fill('0');
        await dialog.getByLabel('Right (px)').fill('25');
        await dialog.getByLabel('Overlay').check();
        await dialog.getByLabel('Inner radius (px)').fill('6');
        await dialog.getByLabel('Outer radius (px)').fill('12');
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, {
          op: 'image.border',
          widths: { top: 5, bottom: 15, left: 0, right: 25 },
          placement: 'overlay',
          innerRadius: 6,
          outerRadius: 12,
        });
      },
    });
    expect(api.document).toMatchObject({ width: 200, height: 150 });
  });

  test('in a Grayscale document, image.border passes a saturated colour on as the dialog\'s hex field does', async ({ page }) => {
    const borderPixels: Rgba[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer1(p);
        await clickMenu(p, 'Image', 'Mode', 'Grayscale');
        await expect.poll(() => colorMode(p)).toBe('grayscale');
      },
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Image', 'Border...', 'Border');
        await dialog.getByLabel('Border width (px)').fill('10');
        const hex = dialog.getByLabel('Hex color');
        await hex.fill('ff0000');
        await hex.press('Tab');
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
        borderPixels.push(await borderPixel(p));
      },
      viaApi: async (p) => {
        await run(p, { op: 'image.border', width: 10, color: '#ff0000' });
        borderPixels.push(await borderPixel(p));
      },
    });
    expect(api.document.colorMode).toBe('grayscale');
    expect(borderPixels[1]).toEqual(borderPixels[0]);
    // Pinned as-is: neither the dialog nor addBorder converts the colour to the document's mode.
    expect(borderPixels[0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  test('image.border is refused as the dialog disables Apply', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'image.border', width: 0 })).toEqual({ code: 'refused', message: 'Enter a border width.' });
    const error = await runError(page, { op: 'image.border', width: 20_000 });
    expect(error.code).toBe('refused');
    expect(error.message).toMatch(/^Too large: the canvas can be at most \d+ px on a side\.$/);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  test('image.crop matches a Crop-tool drag, which keeps the selection', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await richDocument(p);
        await dragMarquee(p, 50, 50, 90, 90);
      },
      viaUi: async (p) => {
        await selectTool(p, 'crop');
        await dragOnCanvas(p, { x: 30, y: 20 }, { x: 150, y: 110 });
        await settle(p, 300);
      },
      viaApi: async (p) => {
        expect(await run<Size>(p, { op: 'image.crop', x: 30, y: 20, width: 120, height: 90 })).toEqual({ width: 120, height: 90 });
      },
      // The UI side switched to the Crop tool to drag; editor state is not compared by default.
    });
    expect(api.document).toMatchObject({ width: 120, height: 90 });
    expect(api.selection.active).toBe(true);
    expect(api.history.undo.at(-1)).toBe('Crop Canvas');
  });

  test('image.crop-to-selection matches Edit > Crop, which drops the selection', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await richDocument(p);
        await dragMarquee(p, 30, 20, 150, 110);
      },
      viaUi: (p) => clickMenu(p, 'Edit', 'Crop'),
      viaApi: async (p) => {
        expect(await run<Size>(p, { op: 'image.crop-to-selection' })).toEqual({ width: 120, height: 90 });
      },
    });
    expect(api.selection.active).toBe(false);
    expect(api.history.undo.at(-1)).toBe('Crop Canvas');
  });

  test('image.crop-to-selection is refused with nothing selected, as Edit > Crop is disabled; image.crop outside the canvas is refused', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    expect(await runError(page, { op: 'image.crop-to-selection' })).toEqual({ code: 'refused', message: 'Nothing is selected to crop to.' });
    expect(await runError(page, { op: 'image.crop', x: 300, y: 0, width: 20, height: 20 })).toEqual({
      code: 'refused',
      message: 'The crop rectangle lies outside the 200x150 canvas.',
    });
    expect(await historyLabels(page)).toEqual(['New Document']);
  });

  for (const [direction, item] of [['cw', 'Rotate 90° CW'], ['ccw', 'Rotate 90° CCW']] as const) {
    test(`image.rotate ${direction} matches Image > ${item}`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: richDocument,
        viaUi: (p) => clickMenu(p, 'Image', item),
        viaApi: async (p) => {
          expect(await run<Size>(p, { op: 'image.rotate', direction })).toEqual({ width: 150, height: 200 });
        },
      });
      expect(api.history.undo.at(-1)).toBe(direction === 'cw' ? 'Rotate Image 90° CW' : 'Rotate Image 90° CCW');
    });
  }

  for (const [axis, item] of [['horizontal', 'Flip Horizontal'], ['vertical', 'Flip Vertical']] as const) {
    test(`image.flip-layer ${axis} matches Image > ${item} on a raster layer at an offset with a mask`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: richDocument,
        viaUi: async (p) => {
          await clickMenu(p, 'Image', item);
          await expect.poll(() => historyLabels(p)).toContain(item);
        },
        viaApi: async (p) => {
          await run(p, { op: 'image.flip-layer', axis });
        },
      });
      expect(api.history.undo.at(-1)).toBe(item);
    });

    test(`image.flip-layer ${axis} matches Image > ${item} on an upright text layer`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: async (p) => {
          await paintLayer1(p);
          await commitText(p, 120, 100, 'Lp');
        },
        viaUi: async (p) => {
          await clickMenu(p, 'Image', item);
          await expect.poll(() => historyLabels(p)).toContain(item);
        },
        viaApi: async (p) => {
          await run(p, { op: 'image.flip-layer', axis });
        },
      });
      expect(api.layers.filter((l) => l.type === 'text')).toHaveLength(1);
      expect(api.history.undo.at(-1)).toBe(item);
    });
  }

  test('image.flip-layer flips a layer named by its name, making it active as a row click does', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await paintLayer1(page);
    await run(page, { op: 'layer.select', layer: 'Background' });
    const result = await run<{ layer: string }>(page, { op: 'image.flip-layer', layer: 'Layer 1', axis: 'horizontal' });
    const s = await surfaceState(page);
    expect(s.activeLayerId).toBe(result.layer);
    expect(s.layers.find((l) => l.id === result.layer)?.name).toBe('Layer 1');
    expect((await historyLabels(page)).at(-1)).toBe('Flip Horizontal');
  });

  for (const [what, setup, text] of [
    ['text bound to a path', pathTextLayer, TEXT_FLIP_REFUSAL],
    ['a group holding live text', groupWithText, GROUP_FLIP_REFUSAL],
  ] as const) {
    test(`on ${what}, Image > Flip Horizontal toasts and image.flip-layer is refused with the same text`, async ({ page }) => {
      const said: string[][] = [];
      let refusal = { code: '', message: '' };
      await compareUiAndApi(page, {
        setup,
        viaUi: async (p) => {
          await clickMenu(p, 'Image', 'Flip Horizontal');
          await settle(p, 300);
          said.push(await toasts(p));
        },
        viaApi: async (p) => {
          refusal = await runError(p, { op: 'image.flip-layer', axis: 'horizontal' });
          said.push(await toasts(p));
        },
      });
      expect(said).toEqual([[text], []]);
      expect(refusal).toEqual({ code: 'refused', message: text });
    });
  }

  for (const [kind, item] of [['tone', 'Auto Tone'], ['contrast', 'Auto Contrast'], ['color', 'Auto Color']] as const) {
    test(`image.auto ${kind} matches Image > ${item}`, async ({ page }) => {
      let result: { node: string; group: string } | null = null;
      const { api } = await compareUiAndApi(page, {
        setup: paintLayer1,
        viaUi: async (p) => {
          await clickMenu(p, 'Image', item);
          await expect.poll(() => historyLabels(p)).toContain(item);
        },
        viaApi: async (p) => {
          result = await run(p, { op: 'image.auto', kind });
        },
      });
      expect(api.history.undo.at(-1)).toBe(item);
      const root = api.layers.at(-1)!.adjustments!;
      expect(root.nodes.at(-1)!.type).toBe(kind === 'color' ? 'curves' : 'levels');
      expect(result).toMatchObject({ node: expect.any(String), group: expect.any(String) });
    });
  }

  for (const [mode, item, label] of [
    ['grayscale', 'Grayscale', 'Convert to Grayscale'],
    ['cmyk', 'CMYK Color', 'Convert to CMYK'],
    ['lab', 'Lab Color', 'Convert to Lab'],
  ] as const) {
    test(`doc.color-mode ${mode} and back to rgb matches Image > Mode > ${item} then RGB Color`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: paintLayer1,
        viaUi: async (p) => {
          await clickMenu(p, 'Image', 'Mode', item);
          await expect.poll(() => historyLabels(p)).toContain(label);
          await clickMenu(p, 'Image', 'Mode', 'RGB Color');
          await expect.poll(() => historyLabels(p)).toContain('Convert to RGB');
        },
        viaApi: async (p) => {
          expect(await run(p, { op: 'doc.color-mode', mode })).toEqual({ colorMode: mode });
          expect(await run(p, { op: 'doc.color-mode', mode: 'rgb' })).toEqual({ colorMode: 'rgb' });
        },
      });
      expect(api.history.undo.slice(-2)).toEqual([label, 'Convert to RGB']);
    });
  }

  test('doc.color-mode indexed matches the Indexed Color dialog with 4 colours and dithering', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer1(p);
        await p.locator('[aria-label="Add Layer"]').click();
        await settle(p);
      },
      viaUi: async (p) => {
        const parent = await menuItem(p, 'Image', 'Mode');
        await parent.hover();
        await p.locator('[role="menu"][aria-label="Mode"]').getByRole('menuitem', { name: 'Indexed Color...', exact: true }).click();
        const dialog = p.getByRole('dialog', { name: 'Indexed Color', exact: true });
        await dialog.getByLabel('Colors').fill('4');
        await dialog.getByLabel('Dither (Floyd–Steinberg)').check();
        await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => colorMode(p)).toBe('indexed');
      },
      viaApi: async (p) => {
        expect(await run(p, { op: 'doc.color-mode', mode: 'indexed', maxColors: 4, dither: true })).toEqual({ colorMode: 'indexed' });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Convert to Indexed');
    expect(api.layers.filter((l) => l.type !== 'group')).toHaveLength(1);
  });

  test('doc.color-mode refuses the current mode silently and indexed options with another mode', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 60, height: 40 });
    expect(await runError(page, { op: 'doc.color-mode', mode: 'rgb' })).toEqual({
      code: 'refused',
      message: 'The document is already in RGB mode.',
    });
    expect((await runError(page, { op: 'doc.color-mode', mode: 'grayscale', maxColors: 8 })).code).toBe('invalid');
    expect(await toasts(page)).toEqual([]);
    expect(await historyLabels(page)).toEqual(['New Document']);
  });
});
