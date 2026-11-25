/**
 * The `doc` commands (src/commands/document/document.ts), and the parts of
 * the command API every family shares: describe, unknown ids and batches.
 */
import { test, expect, run, runError, describe, snapshot, compareUiAndApi, type Page } from './harness';
import { addLayer } from '../helpers';
import { clickMenu, fillRect, historyLabels, redoLabels } from '../surface-helpers';
import { docPixel } from '../surface-helpers-filters';
import { watchDialogs } from '../surface-helpers-file';

interface LayerSummary {
  id: string;
  name: string;
  type: string;
}

interface NewDocumentResult {
  width: number;
  height: number;
  colorMode: string;
  layers: LayerSummary[];
  activeLayer: string | null;
}

interface DocumentInfo {
  name: string;
  width: number;
  height: number;
  colorMode: string;
  dpi: number;
  layers: Array<LayerSummary & {
    visible: boolean; locked: boolean; opacity: number; blendMode: string; x: number; y: number;
    width: number | null; height: number | null; hasMask: boolean; parent: string | null;
    isActive: boolean; isSelected: boolean;
  }>;
  selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
  history: { undo: string[]; redo: string[] };
  foregroundColor: string;
  backgroundColor: string;
  activeTool: string;
}

const RED = { r: 255, g: 0, b: 0 };
const WHITE_PIXEL = { r: 255, g: 255, b: 255, a: 255 };

/** File > New, then type the size into the New Document dialog and click Create. */
async function createViaModal(page: Page, width: number, height: number, background: 'White' | 'Transparent'): Promise<void> {
  watchDialogs(page, true);
  const oldId = await page.evaluate(() =>
    (window as unknown as { __editorStore: { getState: () => { document: { id: string } } } }).__editorStore.getState().document.id,
  );
  await clickMenu(page, 'File', 'New');
  const modal = page.getByRole('dialog', { name: 'New Document' });
  const sizes = modal.locator('input[type="number"]');
  await sizes.nth(0).fill(String(width));
  await sizes.nth(1).fill(String(height));
  await modal.getByLabel(background).check();
  await modal.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.waitForFunction((id) => {
    const state = (window as unknown as {
      __editorStore: { getState: () => { document: { id: string }; undoStack: unknown[] } };
    }).__editorStore.getState();
    return state.document.id !== id && state.undoStack.length > 0;
  }, oldId);
}

test.describe('doc.new', () => {
  for (const background of ['white', 'transparent'] as const) {
    test(`matches the New Document dialog's Create (${background} background)`, async ({ page }) => {
      const label = background === 'white' ? 'White' : 'Transparent';
      const { api } = await compareUiAndApi(page, {
        viaUi: (p) => createViaModal(p, 320, 240, label),
        viaApi: async (p) => {
          await run(p, { op: 'doc.new', width: 320, height: 240, background });
        },
      });
      expect(api.document).toEqual({ width: 320, height: 240, colorMode: 'rgb' });
      expect(api.history).toEqual({ undo: ['New Document'], redo: [] });
      const names = api.layers.map((l) => l.name);
      expect(names).toEqual(background === 'white' ? ['Background', 'Layer 1', 'Project'] : ['Background', 'Project']);
    });
  }

  test('on a page with no document, creates one whose history is exactly ["New Document"]', async ({ page }) => {
    const result = await run<NewDocumentResult>(page, { op: 'doc.new', width: 160, height: 90 });

    expect(result.width).toBe(160);
    expect(result.height).toBe(90);
    expect(result.colorMode).toBe('rgb');
    expect(result.layers.map((l) => [l.name, l.type])).toEqual([['Background', 'raster'], ['Layer 1', 'raster'], ['Project', 'group']]);
    expect(result.activeLayer).toBe(result.layers[1]!.id);
    expect(await historyLabels(page)).toEqual(['New Document']);
    expect(await redoLabels(page)).toEqual([]);
    await expect(page.locator('[data-testid="canvas-container"]')).toBeVisible();
    expect(await docPixel(page, 80, 45, result.layers[0]!.id)).toEqual(WHITE_PIXEL);
  });

  test('a transparent document has only a clear Background, active', async ({ page }) => {
    const result = await run<NewDocumentResult>(page, { op: 'doc.new', width: 50, height: 40, background: 'transparent', colorMode: 'grayscale', dpi: 300 });
    expect(result.layers.map((l) => l.name)).toEqual(['Background', 'Project']);
    expect(result.activeLayer).toBe(result.layers[0]!.id);
    expect(await docPixel(page, 25, 20, result.layers[0]!.id)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    const info = await run<DocumentInfo>(page, { op: 'doc.info' });
    expect({ colorMode: info.colorMode, dpi: info.dpi }).toEqual({ colorMode: 'grayscale', dpi: 300 });
  });

  test('run twice in a row, the second document replaces the first', async ({ page }) => {
    const first = await run<NewDocumentResult>(page, { op: 'doc.new', width: 100, height: 80 });
    const second = await run<NewDocumentResult>(page, { op: 'doc.new', width: 60, height: 30, background: 'transparent' });

    const info = await run<DocumentInfo>(page, { op: 'doc.info' });
    expect({ width: info.width, height: info.height }).toEqual({ width: 60, height: 30 });
    expect(info.layers.map((l) => l.id)).toEqual(second.layers.map((l) => l.id));
    const firstIds = new Set(first.layers.map((l) => l.id));
    expect(info.layers.some((l) => firstIds.has(l.id))).toBe(false);
    expect(info.history).toEqual({ undo: ['New Document'], redo: [] });
  });

  test('settles: as soon as it resolves the background reads white and history holds "New Document"', async ({ page }) => {
    const result = await run<NewDocumentResult>(page, { op: 'doc.new', width: 64, height: 64 });
    const seen = await page.evaluate(async (bgId) => {
      const w = window as unknown as {
        __editorStore: { getState: () => { undoStack: Array<{ label: string }> } };
        __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      };
      const history = w.__editorStore.getState().undoStack.map((e) => e.label);
      const layer = await w.__readLayerPixels(bgId);
      const at = layer ? (32 * layer.width + 32) * 4 : -1;
      return { history, size: layer ? [layer.width, layer.height] : null, pixel: layer ? layer.pixels.slice(at, at + 4) : null };
    }, result.layers[0]!.id);
    expect(seen.history).toEqual(['New Document']);
    expect(seen.size).toEqual([64, 64]);
    expect(seen.pixel).toEqual([255, 255, 255, 255]);
  });

  test('rejects invalid params', async ({ page }) => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ height: 10 }, /^doc\.new: width is required/],
      [{ width: 0, height: 10 }, /^doc\.new: width must be an integer from 1 to 16384, got 0$/],
      [{ width: 16385, height: 10 }, /^doc\.new: width must be an integer from 1 to 16384, got 16385$/],
      [{ width: 12.5, height: 10 }, /^doc\.new: width must be an integer/],
      [{ width: 10, height: 10, background: 'black' }, /^doc\.new: background must be one of "white", "transparent"/],
      [{ width: 10, height: 10, colorMode: 'indexed' }, /^doc\.new: colorMode must be one of "rgb", "grayscale", "cmyk", "lab"/],
      [{ width: 10, height: 10, dpi: 0 }, /^doc\.new: dpi must be an integer from 1 to 1200/],
      [{ width: 10, height: 10, name: 'x' }, /^doc\.new: unknown param "name"/],
    ];
    for (const [params, message] of cases) {
      const error = await runError(page, { op: 'doc.new', ...params });
      expect(error.code, JSON.stringify(params)).toBe('invalid');
      expect(error.message).toMatch(message);
    }
    expect(await page.locator('[data-testid="canvas-container"]').count()).toBe(0);
  });

  test('refuses a side beyond what this GPU can hold', async ({ page }) => {
    const gpuMax = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0;
    });
    test.skip(gpuMax === 0 || gpuMax >= 16384, `this GPU allows ${gpuMax}, the hard cap's limit`);
    const error = await runError(page, { op: 'doc.new', width: gpuMax + 1, height: 10 });
    expect(error).toEqual({
      code: 'invalid',
      message: `doc.new: width and height must be at most ${gpuMax} pixels on this device (its GPU's largest texture), got ${gpuMax + 1}x10`,
    });
  });
});

test.describe('doc.info', () => {
  test('is unavailable before any document is open', async ({ page }) => {
    const error = await runError(page, { op: 'doc.info' });
    expect(error.code).toBe('unavailable');
    expect(error.message).toMatch(/No document is open/);
  });

  test('reflects a layer added and painted through the UI', async ({ page }) => {
    const created = await run<NewDocumentResult>(page, { op: 'doc.new', width: 200, height: 150 });
    await addLayer(page);
    await fillRect(page, 20, 30, 80, 90, RED);

    const info = await run<DocumentInfo>(page, { op: 'doc.info' });

    expect(info.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Layer 2', 'Project']);
    const added = info.layers[2]!;
    const root = info.layers[3]!;
    expect(created.layers.some((l) => l.id === added.id)).toBe(false);
    expect(added).toMatchObject({ type: 'raster', visible: true, locked: false, opacity: 100, blendMode: 'normal', parent: root.id, isActive: true, isSelected: true });
    expect(info.layers.filter((l) => l.isActive).map((l) => l.name)).toEqual(['Layer 2']);
    expect(info.history.undo[0]).toBe('New Document');
    expect(info.history.undo.length).toBeGreaterThanOrEqual(3);
    expect(info.history.undo).toEqual(await historyLabels(page));
    expect(info.selection.active).toBe(true);
    expect(info.selection.bounds).not.toBeNull();
    expect(info.foregroundColor).toBe('#ff0000');
    expect(info.activeTool).toBe('marquee-rect');
    expect(await docPixel(page, 50, 60, added.id)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });

  test('rejects params', async ({ page }) => {
    await run(page, { op: 'doc.new', width: 20, height: 20 });
    const error = await runError(page, { op: 'doc.info', layer: 'Background' });
    expect(error.code).toBe('invalid');
    expect(error.message).toBe('doc.info: unknown param "layer"; it takes none');
  });
});

test.describe('the command API', () => {
  test('an unknown command id is not-found with a suggestion', async ({ page }) => {
    const error = await runError(page, { op: 'doc.nwe' });
    expect(error.code).toBe('not-found');
    expect(error.message).toMatch(/^Unknown command "doc\.nwe"\. Did you mean: .*doc\.new/);
  });

  test('describe lists exactly the commands defined so far, with JSON-round-trippable schemas', async ({ page }) => {
    const all = await describe(page, 'document');
    expect(all.map((c) => c.id)).toEqual([
      'adjust.add', 'adjust.list', 'adjust.remove', 'adjust.reorder', 'adjust.set', 'adjust.set-enabled', 'adjust.set-node-enabled',
      'brush.define',
      'clipboard.copy', 'clipboard.copy-merged', 'clipboard.cut', 'clipboard.paste',
      'color.reset', 'color.set', 'color.swap',
      'doc.color-mode', 'doc.export', 'doc.export-psd', 'doc.info', 'doc.new', 'doc.open', 'doc.save',
      'filter.add-noise', 'filter.bloom', 'filter.box-blur', 'filter.brightness-contrast', 'filter.cel-shading',
      'filter.chromatic-aberration', 'filter.clouds', 'filter.color-lut', 'filter.desaturate', 'filter.emboss',
      'filter.fibers', 'filter.find-edges', 'filter.gaussian-blur', 'filter.halftone', 'filter.hue-saturation',
      'filter.invert', 'filter.kaleidoscope', 'filter.lens-distortion', 'filter.liquify', 'filter.mesh-warp', 'filter.motion-blur', 'filter.oil-paint',
      'filter.pattern-fill', 'filter.pixel-stretch', 'filter.pixelate', 'filter.posterize', 'filter.radial-blur',
      'filter.smoke', 'filter.solarize', 'filter.sunburst', 'filter.surface-blur', 'filter.texture',
      'filter.threshold', 'filter.tilt-shift', 'filter.unsharp-mask', 'filter.voronoi',
      'guestbook.sign',
      'guide.add', 'guide.clear', 'guide.list', 'guide.remove',
      'history.redo', 'history.undo',
      'image.auto', 'image.border', 'image.canvas-size', 'image.crop', 'image.crop-to-selection', 'image.flip-layer', 'image.rotate',
      'image.size',
      'layer.add', 'layer.add-group', 'layer.add-image', 'layer.duplicate', 'layer.effects', 'layer.flatten', 'layer.group', 'layer.merge-down',
      'layer.move', 'layer.nudge', 'layer.rasterize', 'layer.rasterize-style', 'layer.remove', 'layer.remove-selected', 'layer.reorder', 'layer.select', 'layer.set',
      'layer.transform',
      'mask.add', 'mask.clear', 'mask.edit', 'mask.remove', 'mask.set-enabled', 'mask.to-selection',
      'paint.bucket', 'paint.clear', 'paint.fill', 'paint.gradient', 'paint.shape', 'paint.stroke',
      'path.add', 'path.exclude', 'path.intersect', 'path.list', 'path.remove', 'path.rename', 'path.select', 'path.stroke',
      'path.subtract', 'path.to-selection', 'path.unite',
      'pattern.define',
      'quickmask.set',
      'select.all', 'select.ellipse', 'select.from-layer', 'select.invert', 'select.modify', 'select.none', 'select.nudge', 'select.polygon',
      'select.quick', 'select.rect', 'select.to-path', 'select.wand',
      'text.add', 'text.edit', 'text.fonts', 'text.set-color', 'text.set-font', 'text.style',
      'tool.describe', 'tool.gesture', 'tool.options', 'tool.select', 'tool.set',
      'view.render', 'view.render-layer', 'view.sample',
    ]);
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
    for (const command of all) {
      expect(command.surface).toBe('document');
      expect(command.summary.length).toBeGreaterThan(20);
    }
    const docNew = all.find((c) => c.id === 'doc.new')!;
    expect(docNew.params.width).toMatchObject({ type: 'number', integer: true, min: 1, max: 16384 });
    expect(docNew.params.background).toMatchObject({ type: 'string', enum: ['white', 'transparent'], default: 'white' });

    const ui = await describe(page, 'ui');
    expect(ui.map((c) => c.id)).toEqual([
      'ui.dialog.export', 'ui.dialog.filter', 'ui.dialog.help', 'ui.dialog.image', 'ui.dialog.select',
      'ui.edit.define-brush',
      'ui.file.export-psd', 'ui.file.new', 'ui.file.open', 'ui.file.open-project', 'ui.file.quick-export-png', 'ui.file.save-project',
      'ui.filter.liquify', 'ui.filter.tilt-shift',
      'ui.help.agents',
      'ui.image.indexed-color',
      'ui.layer.adjustment-layer', 'ui.layer.duplicate',
      'ui.quick-mask.toggle',
      'ui.view.actual-size', 'ui.view.fit', 'ui.view.grid', 'ui.view.guides', 'ui.view.pixel-grid', 'ui.view.renderer',
      'ui.view.ruler-unit', 'ui.view.rulers', 'ui.view.seamless-pattern', 'ui.view.snap-to-grid', 'ui.view.snap-to-guides',
      'ui.view.snap-to-layers', 'ui.view.zoom-in', 'ui.view.zoom-out',
    ]);
    expect(JSON.parse(JSON.stringify(ui))).toEqual(ui);
    for (const command of ui) {
      expect(command.surface).toBe('ui');
      expect(command.summary.length).toBeGreaterThan(20);
    }
    expect((await describe(page)).map((c) => c.id).sort()).toEqual([...all, ...ui].map((c) => c.id).sort());
  });

  test('window.lopsy.describe() is exactly the registry\'s document commands', async ({ page }) => {
    const registry = await describe(page, 'document');
    const offered = await page.evaluate(() =>
      (window as unknown as { lopsy?: { describe: () => unknown } }).lopsy!.describe(),
    );
    expect(offered).toEqual(registry);
  });

  test('a batch runs in order and returns each result', async ({ page }) => {
    const results = await run<unknown[]>(page, [
      { op: 'doc.new', width: 30, height: 20 },
      { op: 'history.undo' },
      { op: 'history.redo' },
      { op: 'doc.info' },
    ]);
    expect(results).toHaveLength(4);
    expect(results[1]).toEqual({ undo: [], redo: ['New Document'] });
    expect(results[2]).toEqual({ undo: ['New Document'], redo: [] });
    expect((results[3] as DocumentInfo).width).toBe(30);
  });

  test('a failing middle step rejects with its index and leaves earlier steps applied', async ({ page }) => {
    const error = await runError(page, [
      { op: 'doc.new', width: 120, height: 90 },
      { op: 'history.undo' },
      { op: 'history.undo' },
      { op: 'doc.new', width: 10, height: 10 },
    ]);
    expect(error).toEqual({ code: 'refused', message: '[2] history.undo: Nothing to undo.' });
    const snap = await snapshot(page);
    expect(snap.document).toEqual({ width: 120, height: 90, colorMode: 'rgb' });
    expect(snap.history).toEqual({ undo: [], redo: ['New Document'] });
  });
});
