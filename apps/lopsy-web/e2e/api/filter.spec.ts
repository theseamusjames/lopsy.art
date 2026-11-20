/**
 * The `filter` commands (src/commands/filter/filter.ts): each family of the
 * Filter menu against its dialog (Preview off, values typed in) or its
 * instant menu item, then the selection, mask edit mode and refusals the
 * shared filter path gives every command, the randomized filters, and a sweep
 * of every `filter.*` command describe() lists.
 *
 * Documents are 200x150, white background, with a red block at x 20..120,
 * y 20..100 and a dark-blue block over it at x 80..180, y 50..130 on Layer 1,
 * as in the Filter menu characterization spec.
 */
import type { Locator } from '@playwright/test';
import { test, expect, run, runError, compareUiAndApi, describe, snapshot, type Page } from './harness';
import { clickMenu, dragMarquee, fillRect, historyLabels, settle, startTextEditing, toasts } from '../surface-helpers';
import { docPixel, docPixelHash, openMenuDialog, setFilterValue } from '../surface-helpers-filters';
import { pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 160 };
const TEXT_REFUSAL = 'Text layers must be rasterized before they can be painted on.';
const GROUP_REFUSAL = "Groups can't be painted on. Select a layer inside the group.";

interface FilterResult {
  layer: string;
  target: 'pixels' | 'mask';
}

/** The history label each command pushes: the registry title its dialog shows. */
const LABELS: Record<string, string> = {
  'filter.add-noise': 'Add Noise',
  'filter.gaussian-blur': 'Gaussian Blur',
  'filter.box-blur': 'Box Blur',
  'filter.unsharp-mask': 'Unsharp Mask',
  'filter.brightness-contrast': 'Brightness/Contrast',
  'filter.hue-saturation': 'Hue/Saturation',
  'filter.posterize': 'Posterize',
  'filter.threshold': 'Threshold',
  'filter.motion-blur': 'Motion Blur',
  'filter.radial-blur': 'Radial Blur',
  'filter.find-edges': 'Find Edges',
  'filter.cel-shading': 'Cel Shading',
  'filter.clouds': 'Clouds',
  'filter.smoke': 'Smoke',
  'filter.pixelate': 'Pixelate',
  'filter.halftone': 'Halftone',
  'filter.solarize': 'Solarize',
  'filter.kaleidoscope': 'Kaleidoscope',
  'filter.oil-paint': 'Oil Paint',
  'filter.chromatic-aberration': 'Chromatic Aberration',
  'filter.pixel-stretch': 'Pixel Stretch',
  'filter.lens-distortion': 'Lens Distortion',
  'filter.bloom': 'Bloom',
  'filter.emboss': 'Emboss',
  'filter.voronoi': 'Voronoi',
  'filter.surface-blur': 'Surface Blur',
  'filter.fibers': 'Fibers',
  'filter.sunburst': 'Sunburst',
  'filter.texture': 'Texture',
  'filter.invert': 'Invert',
  'filter.desaturate': 'Desaturate',
  'filter.color-lut': 'Color LUT',
  'filter.pattern-fill': 'Pattern Fill',
  'filter.mesh-warp': 'Mesh Warp',
  'filter.tilt-shift': 'Tilt-Shift Blur',
};

async function paintLayer(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 120, 100, RED);
  await pressKey(page, 'ControlOrMeta+d');
  await fillRect(page, 80, 50, 180, 130, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
  await settle(page);
}

/** A dialog control: a number types into the slider's box, a string clicks the toggle button of that label. */
async function setControl(dialog: Locator, label: string, value: number | string): Promise<void> {
  if (typeof value === 'number') {
    await setFilterValue(dialog, label, value);
    return;
  }
  const row = dialog.locator('div[class*="paramRow"]', { hasText: label });
  await row.getByRole('button', { name: value, exact: true }).click();
}

async function applyDialog(page: Page, menuItem: string, title: string, values: Record<string, number | string>): Promise<void> {
  const dialog = await openMenuDialog(page, 'Filter', menuItem, title);
  for (const [label, value] of Object.entries(values)) await setControl(dialog, label, value);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page, 300);
}

interface DialogCase {
  op: string;
  item: string;
  title: string;
  ui: Record<string, number | string>;
  api: Record<string, number | string>;
}

/** Non-random dialog filters from every family the menu has, some at their defaults and some with typed values. */
const DIALOG_CASES: DialogCase[] = [
  { op: 'filter.gaussian-blur', item: 'Gaussian Blur...', title: 'Gaussian Blur', ui: { Radius: 4 }, api: { radius: 4 } },
  { op: 'filter.box-blur', item: 'Box Blur...', title: 'Box Blur', ui: { Radius: 3 }, api: { radius: 3 } },
  { op: 'filter.surface-blur', item: 'Surface Blur...', title: 'Surface Blur', ui: {}, api: {} },
  { op: 'filter.motion-blur', item: 'Motion Blur...', title: 'Motion Blur', ui: { Angle: 30, Distance: 12 }, api: { angle: 30, distance: 12 } },
  { op: 'filter.radial-blur', item: 'Radial Blur...', title: 'Radial Blur', ui: {}, api: {} },
  { op: 'filter.unsharp-mask', item: 'Unsharp Mask...', title: 'Unsharp Mask', ui: { Amount: 2.5 }, api: { amount: 2.5 } },
  { op: 'filter.cel-shading', item: 'Cel Shading...', title: 'Cel Shading', ui: {}, api: {} },
  { op: 'filter.pixelate', item: 'Pixelate...', title: 'Pixelate', ui: { 'Block Size': 16 }, api: { blockSize: 16 } },
  { op: 'filter.halftone', item: 'Halftone...', title: 'Halftone', ui: {}, api: {} },
  { op: 'filter.kaleidoscope', item: 'Kaleidoscope...', title: 'Kaleidoscope', ui: { Segments: 4 }, api: { segments: 4 } },
  { op: 'filter.oil-paint', item: 'Oil Paint...', title: 'Oil Paint', ui: {}, api: {} },
  { op: 'filter.lens-distortion', item: 'Lens Distortion...', title: 'Lens Distortion', ui: { Strength: 60 }, api: { strength: 60 } },
  { op: 'filter.pixel-stretch', item: 'Pixel Stretch...', title: 'Pixel Stretch', ui: { Seed: 7 }, api: { seed: 7 } },
  { op: 'filter.emboss', item: 'Emboss...', title: 'Emboss', ui: { Type: 'Pillow Emboss' }, api: { type: 'Pillow Emboss' } },
  { op: 'filter.texture', item: 'Texture...', title: 'Texture', ui: { Type: 'Canvas' }, api: { kind: 'Canvas' } },
  { op: 'filter.brightness-contrast', item: 'Brightness/Contrast...', title: 'Brightness/Contrast', ui: { Brightness: 30, Contrast: 20 }, api: { brightness: 30, contrast: 20 } },
  { op: 'filter.hue-saturation', item: 'Hue/Saturation...', title: 'Hue/Saturation', ui: { Hue: 40, Saturation: -30 }, api: { hue: 40, saturation: -30 } },
  { op: 'filter.posterize', item: 'Posterize...', title: 'Posterize', ui: { Levels: 3 }, api: { levels: 3 } },
  { op: 'filter.threshold', item: 'Threshold...', title: 'Threshold', ui: { Level: 40 }, api: { level: 40 } },
  { op: 'filter.solarize', item: 'Solarize...', title: 'Solarize', ui: {}, api: {} },
];

const RANDOM_CASES = [
  { op: 'filter.add-noise', item: 'Add Noise...', title: 'Add Noise' },
  { op: 'filter.clouds', item: 'Clouds...', title: 'Clouds' },
  { op: 'filter.smoke', item: 'Smoke...', title: 'Smoke' },
  { op: 'filter.fibers', item: 'Fibers...', title: 'Fibers' },
] as const;

async function addTextLayer(page: Page): Promise<void> {
  await startTextEditing(page, 30, 60, 'Hi');
  await page.keyboard.press('Shift+Enter');
  await settle(page, 400);
}

async function addGroup(page: Page): Promise<void> {
  await page.locator('[aria-label="New Group"]').click();
  await settle(page);
}

test.describe('the Filter menu and the filter commands', () => {
  test.describe.configure({ timeout: 150_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
  });

  for (const c of DIALOG_CASES) {
    test(`${c.op} matches ${c.title}'s Apply with Preview off`, async ({ page }) => {
      let result: FilterResult | null = null;
      const { ui, api } = await compareUiAndApi(page, {
        setup: paintLayer,
        viaUi: (p) => applyDialog(p, c.item, c.title, c.ui),
        viaApi: async (p) => {
          result = await run<FilterResult>(p, { op: c.op, ...c.api });
        },
      });
      expect(api.history.undo.at(-1)).toBe(c.title);
      expect(result).toMatchObject({ target: 'pixels' });
      expect(ui.layers[1]!.pixels).not.toBeNull();
    });
  }

  for (const [op, item] of [['filter.invert', 'Invert'], ['filter.desaturate', 'Desaturate'], ['filter.find-edges', 'Find Edges']] as const) {
    test(`${op} matches Filter > ${item}`, async ({ page }) => {
      const { api } = await compareUiAndApi(page, {
        setup: paintLayer,
        viaUi: (p) => clickMenu(p, 'Filter', item),
        viaApi: async (p) => {
          await run(p, { op });
        },
      });
      expect(api.history.undo.at(-1)).toBe(item);
    });
  }

  test('with a marquee, filter.gaussian-blur matches the dialog and keeps the selection', async ({ page }) => {
    const before: string[] = [];
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer(p);
        await dragMarquee(p, 0, 0, 100, 150);
        before.push(await docPixelHash(p));
      },
      viaUi: (p) => applyDialog(p, 'Gaussian Blur...', 'Gaussian Blur', { Radius: 6 }),
      viaApi: async (p) => {
        await run(p, { op: 'filter.gaussian-blur', radius: 6 });
        expect(await docPixel(p, 150, 110)).toEqual({ ...BLUE, a: 255 });
        expect(await docPixel(p, 110, 30)).toEqual({ ...RED, a: 255 });
      },
    });
    expect(api.selection.bounds).toEqual({ x: 0, y: 0, width: 100, height: 150 });
    expect(api.layers[1]!.pixels).not.toBe(before[0]);
  });

  test('in layer-mask edit mode, filter.gaussian-blur blurs the mask as the dialog does', async ({ page }) => {
    let result: FilterResult | null = null;
    const pixels: Array<string | null> = [];
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer(p);
        await dragMarquee(p, 40, 30, 120, 90);
        await p.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name: 'Add Mask', exact: true }).click();
        await settle(p);
        pixels.push((await snapshot(p)).layers[1]!.pixels);
      },
      viaUi: (p) => applyDialog(p, 'Gaussian Blur...', 'Gaussian Blur', { Radius: 8 }),
      viaApi: async (p) => {
        result = await run<FilterResult>(p, { op: 'filter.gaussian-blur', radius: 8 });
      },
    });
    expect(result).toMatchObject({ target: 'mask' });
    expect(api.history.undo.at(-1)).toBe('Gaussian Blur');
    expect(api.layers[1]!.pixels).toBe(pixels[0]);
  });

  test('filter.invert in mask edit mode writes the mask as the menu item does', async ({ page }) => {
    let result: FilterResult | null = null;
    await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer(p);
        await p.getByRole('toolbar', { name: 'Layer actions' }).getByRole('button', { name: 'Add Mask', exact: true }).click();
        await settle(p);
      },
      viaUi: (p) => clickMenu(p, 'Filter', 'Invert'),
      viaApi: async (p) => {
        result = await run<FilterResult>(p, { op: 'filter.invert' });
      },
    });
    expect(result).toMatchObject({ target: 'mask' });
  });

  for (const [what, setup, text] of [
    ['a text layer', addTextLayer, TEXT_REFUSAL],
    ['a group', addGroup, GROUP_REFUSAL],
  ] as const) {
    test(`on ${what}, the dialog's Apply toasts and filter.gaussian-blur and filter.invert are refused with the same text`, async ({ page }) => {
      const said: string[][] = [];
      const errors: Array<{ code: string; message: string }> = [];
      await compareUiAndApi(page, {
        setup: async (p) => {
          await paintLayer(p);
          await setup(p);
        },
        viaUi: async (p) => {
          await applyDialog(p, 'Gaussian Blur...', 'Gaussian Blur', {});
          await clickMenu(p, 'Filter', 'Invert');
          said.push(await toasts(p));
        },
        viaApi: async (p) => {
          errors.push(await runError(p, { op: 'filter.gaussian-blur' }));
          errors.push(await runError(p, { op: 'filter.invert' }));
          said.push(await toasts(p));
        },
      });
      // The toast list may fold a repeated message into one.
      expect(said[0]!.length).toBeGreaterThanOrEqual(1);
      expect(new Set(said[0])).toEqual(new Set([text]));
      expect(said[1]).toEqual([]);
      expect(errors).toEqual([{ code: 'refused', message: text }, { code: 'refused', message: text }]);
    });
  }

  test('filter.gaussian-blur matches the dialog\'s preview-then-commit path too', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer,
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
        await setFilterValue(dialog, 'Radius', 6);
        await dialog.getByRole('checkbox', { name: 'Preview' }).check();
        await settle(p, 500);
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'filter.gaussian-blur', radius: 6 });
      },
    });
    expect(api.history.undo.filter((label) => label === 'Gaussian Blur')).toHaveLength(1);
  });

  test('filter.color-lut matches the Color LUT dialog with a preset and intensity', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: paintLayer,
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Filter', 'Color LUT...', 'Color LUT');
        await dialog.getByRole('button', { name: 'Noir', exact: true }).click();
        await setFilterValue(dialog, 'Intensity', 60);
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'filter.color-lut', preset: 'noir', intensity: 60 });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Color LUT');
  });

  test('filter.pattern-fill matches Edit > Fill with Pattern... on a new layer', async ({ page }) => {
    const { api } = await compareUiAndApi(page, {
      setup: async (p) => {
        await paintLayer(p);
        await dragMarquee(p, 60, 40, 100, 70);
        await clickMenu(p, 'Edit', 'Define Pattern');
        await settle(p, 300);
        await pressKey(p, 'ControlOrMeta+d');
        await p.locator('[aria-label="Add Layer"]').click();
        await settle(p);
      },
      viaUi: async (p) => {
        const dialog = await openMenuDialog(p, 'Edit', 'Fill with Pattern...', 'Pattern Fill');
        await setFilterValue(dialog, 'Scale', 50);
        await setFilterValue(dialog, 'Row Stagger', 50);
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await settle(p, 300);
      },
      viaApi: async (p) => {
        await run(p, { op: 'filter.pattern-fill', scale: 50, rowStagger: 50 });
      },
    });
    expect(api.history.undo.at(-1)).toBe('Pattern Fill');
    expect(api.layers.at(-1)!.pixels).not.toBe(api.layers[1]!.pixels);
  });

  test('filter.pattern-fill is refused before any pattern is defined', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 60, height: 40 });
    expect(await runError(page, { op: 'filter.pattern-fill' })).toEqual({
      code: 'refused',
      message: 'No patterns defined. Use Edit > Define Pattern to capture the active layer as a pattern.',
    });
  });

  for (const c of RANDOM_CASES) {
    test(`${c.op} changes the selected pixels only and pushes "${c.title}" as the dialog does`, async ({ page }) => {
      await run(page, { op: 'doc.new', width: 200, height: 150 });
      await settle(page, 300);
      await paintLayer(page);
      await dragMarquee(page, 0, 0, 100, 150);
      const before = await docPixelHash(page);
      const outside = await docPixel(page, 150, 110);

      await applyDialog(page, c.item, c.title, {});
      const uiLabel = (await historyLabels(page)).at(-1);
      await run(page, { op: 'history.undo' });
      expect(await docPixelHash(page)).toBe(before);

      const result = await run<FilterResult>(page, { op: c.op });
      expect(result.target).toBe('pixels');
      expect((await historyLabels(page)).at(-1)).toBe(uiLabel);
      expect(uiLabel).toBe(c.title);
      expect(await docPixelHash(page)).not.toBe(before);
      expect(await docPixel(page, 150, 110)).toEqual(outside);
    });
  }

  test('filter.box-blur refuses a radius over the document\'s slider maximum', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 60, height: 40 });
    const error = await runError(page, { op: 'filter.box-blur', radius: 101 });
    expect(error).toEqual({
      code: 'invalid',
      message: "filter.box-blur: radius must be at most 100 on this 60x40 document, as the dialog's slider is, got 101",
    });
  });

  test('every filter command runs with its defaults and pushes one entry with its dialog\'s title', async ({ page }) => {
    test.setTimeout(300_000);
    await run(page, { op: 'doc.new', width: 200, height: 150 });
    await settle(page, 300);
    await paintLayer(page);
    await dragMarquee(page, 60, 40, 100, 70);
    await clickMenu(page, 'Edit', 'Define Pattern');
    await settle(page, 300);
    await pressKey(page, 'ControlOrMeta+d');
    const base = await historyLabels(page);

    const ids = (await describe(page)).map((c) => c.id).filter((id) => id.startsWith('filter.'));
    expect(ids.sort()).toEqual(Object.keys(LABELS).sort());
    for (const op of ids) {
      const result = await run<FilterResult>(page, { op });
      expect(result.target, op).toBe('pixels');
      expect(await historyLabels(page), op).toEqual([...base, LABELS[op]]);
      await run(page, { op: 'history.undo' });
    }
  });
});
