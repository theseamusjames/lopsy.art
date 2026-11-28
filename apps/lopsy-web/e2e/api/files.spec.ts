/**
 * The file commands (src/commands/document/files.ts, src/commands/layer/add-image.ts):
 * doc.export, doc.save, doc.export-psd and doc.open against the File menu's
 * downloads and file choosers, layer.add-image against dropping an image on
 * the canvas, and every error path.
 *
 * Documents are 200x150 with a white Background, a red block on Layer 1 and
 * a blue block on a second layer, unless a test says otherwise.
 */
import { test, expect, run, runError, compareUiAndApi, snapshot, type Page } from './harness';
import { clickMenu, fillRect, historyLabels, settle, startTextEditing, toasts } from '../surface-helpers';
import { captureDownload, decodeImageInPage, isDirty, makePngInPage, watchDialogs } from '../surface-helpers-file';
import { pressKey } from '../surface-helpers-keys';
import { serveFontsOffline } from '../font-fixtures';

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const FAMILY = 'IM Fell English';

interface ExportResult {
  mime: string;
  ext: string;
  width: number;
  height: number;
  base64: string;
}

interface FileResult {
  mime: string;
  ext: string;
  base64: string;
}

interface OpenResult {
  width: number;
  height: number;
  colorMode: string;
  layers: Array<{ id: string; name: string; type: string }>;
  activeLayer: string | null;
}

function bytesOf(result: { base64: string }): Buffer {
  return Buffer.from(result.base64, 'base64');
}

/** Width, height and an FNV hash of every RGBA byte, decoded by the browser into an sRGB canvas. */
async function decodedHash(page: Page, bytes: Buffer): Promise<string> {
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' }).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < pixels.length; i++) {
      h ^= pixels[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${bitmap.width}x${bitmap.height}:${h.toString(16)}`;
  }, Array.from(bytes));
}

async function newDocument(page: Page): Promise<void> {
  await run(page, { op: 'doc.new', width: 200, height: 150 });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

async function paintTwoLayers(page: Page): Promise<void> {
  await fillRect(page, 20, 20, 120, 100, RED);
  await pressKey(page, 'ControlOrMeta+d');
  await run(page, { op: 'layer.add' });
  await fillRect(page, 80, 50, 180, 130, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
  await settle(page);
}

async function documentName(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __editorStore: { getState: () => { document: { name: string } } } }).__editorStore.getState().document.name,
  );
}

async function documentVersion(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { __editorStore: { getState: () => { documentVersion: number } } }).__editorStore.getState().documentVersion,
  );
}

async function isFontLoaded(page: Page, family: string): Promise<boolean> {
  return page.evaluate((f) => {
    const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((name: string) => boolean) | undefined;
    return fn ? fn(f) : false;
  }, family);
}

/** File > Open... (accepting the unsaved-changes confirm), answering the chooser with `bytes`. */
async function openThroughMenu(page: Page, item: 'Open...' | 'Open Project...', name: string, bytes: Buffer): Promise<void> {
  watchDialogs(page, true);
  const version = await documentVersion(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickMenu(page, 'File', item)]);
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  await page.waitForFunction((v) => {
    const s = (window as unknown as {
      __editorStore: { getState: () => { documentVersion: number; undoStack: unknown[] } };
    }).__editorStore.getState();
    return s.documentVersion !== v && s.undoStack.length > 0;
  }, version, { timeout: 20_000 });
  await expect(page.locator('[role="dialog"]', { hasText: 'Opening' })).toHaveCount(0);
  await settle(page, 400);
}

/** Opens the Export dialog, picks `format` (and the PNG High option or a typed quality), and captures the download. */
async function exportThroughDialog(page: Page, format: string, options: { quality?: number; high?: boolean } = {}): Promise<Buffer> {
  await clickMenu(page, 'File', 'Export…');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog.getByRole('img', { name: 'Export preview' })).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: format, exact: true }).click();
  if (options.high) await dialog.getByRole('button', { name: 'High', exact: true }).click();
  if (options.quality !== undefined) {
    const input = dialog.locator('input[aria-label="Quality value"]');
    await input.fill(String(options.quality));
    await input.press('Tab');
  }
  const out = await captureDownload(page, () => dialog.getByRole('button', { name: 'Export', exact: true }).click());
  return out.bytes;
}

/** A PNG's IHDR: width, height, bit depth and colour type. */
function pngHeader(bytes: Buffer): { width: number; height: number; bitDepth: number; colorType: number } {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24]!, colorType: bytes[25]! };
}

/** Drops `bytes` as a file on the canvas, as a user dragging it from the desktop does. */
async function dropFile(page: Page, name: string, type: string, bytes: Buffer): Promise<void> {
  await page.evaluate(({ data, fileName, mime }) => {
    const file = new File([new Uint8Array(data)], fileName, { type: mime });
    const target = document.querySelector('[data-testid="canvas-container"]');
    if (!target) throw new Error('no canvas container');
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, { data: Array.from(bytes), fileName: name, mime: type });
}

test.describe('the file commands', () => {
  test.describe.configure({ timeout: 150_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
  });

  test.describe('doc.export', () => {
    test('PNG: the same bytes as File > Quick Export PNG; the command leaves the document dirty, the menu marks it clean', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      expect(await isDirty(page)).toBe(true);

      const api = await run<ExportResult>(page, { op: 'doc.export', format: 'png' });
      expect(await isDirty(page)).toBe(true);
      const ui = await captureDownload(page, () => clickMenu(page, 'File', 'Quick Export PNG'));
      expect(await isDirty(page)).toBe(false);

      expect(ui.filename).toBe('lopsy.png');
      expect({ mime: api.mime, ext: api.ext, width: api.width, height: api.height }).toEqual({ mime: 'image/png', ext: 'png', width: 200, height: 150 });
      expect(bytesOf(api).equals(ui.bytes)).toBe(true);
      const decoded = await decodeImageInPage(page, bytesOf(api), [{ x: 50, y: 40 }, { x: 150, y: 120 }, { x: 5, y: 5 }]);
      expect(decoded.probes).toEqual([{ ...RED, a: 255 }, { ...BLUE, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }]);
      expect(await historyLabels(page)).toEqual(['New Document', 'Fill', 'Add Layer', 'Fill']);
    });

    const DIALOG_CASES = [
      { label: 'JPEG at a typed quality of 40', button: 'JPEG', params: { format: 'jpeg', quality: 40 }, ui: { quality: 40 }, mime: 'image/jpeg', ext: 'jpg' },
      { label: 'WebP at the default quality', button: 'WebP', params: { format: 'webp' }, ui: {}, mime: 'image/webp', ext: 'webp' },
      { label: 'BMP', button: 'BMP', params: { format: 'bmp' }, ui: {}, mime: 'image/bmp', ext: 'bmp' },
    ] as const;

    for (const c of DIALOG_CASES) {
      test(`${c.label}: the same bytes and pixels as the Export dialog's`, async ({ page }) => {
        await newDocument(page);
        await paintTwoLayers(page);
        const api = await run<ExportResult>(page, { op: 'doc.export', ...c.params });
        const ui = await exportThroughDialog(page, c.button, c.ui);
        expect({ mime: api.mime, ext: api.ext, width: api.width, height: api.height }).toEqual({ mime: c.mime, ext: c.ext, width: 200, height: 150 });
        expect(bytesOf(api).equals(ui)).toBe(true);
        expect(await decodedHash(page, bytesOf(api))).toBe(await decodedHash(page, ui));
      });
    }

    test('16-bit PNG: the Export dialog\'s High PNG, 16 bits a channel at the document size', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const api = await run<ExportResult>(page, { op: 'doc.export', format: 'png', highQuality: true });
      const ui = await exportThroughDialog(page, 'PNG', { high: true });
      const header = pngHeader(bytesOf(api));
      expect(header).toEqual(pngHeader(ui));
      expect({ width: header.width, height: header.height, bitDepth: header.bitDepth }).toEqual({ width: 200, height: 150, bitDepth: 16 });
      expect(bytesOf(api).equals(ui)).toBe(true);
      expect(await decodedHash(page, bytesOf(api))).toBe(await decodedHash(page, ui));
    });

    test('rejects options the dialog does not offer for the format, and needs a document', async ({ page }) => {
      expect((await runError(page, { op: 'doc.export', format: 'png' })).code).toBe('unavailable');
      await newDocument(page);
      expect(await runError(page, { op: 'doc.export', format: 'png', quality: 50 })).toEqual({
        code: 'invalid',
        message: 'doc.export: quality applies to jpeg and webp only, not png',
      });
      expect(await runError(page, { op: 'doc.export', format: 'jpeg', highQuality: true })).toEqual({
        code: 'invalid',
        message: 'doc.export: highQuality applies to png only, not jpeg',
      });
      expect((await runError(page, { op: 'doc.export', format: 'jpeg', quality: 0 })).code).toBe('invalid');
      expect((await runError(page, { op: 'doc.export', format: 'gif' })).code).toBe('invalid');
    });
  });

  test.describe('doc.save and doc.export-psd', () => {
    test('doc.save: the bytes File > Save Project downloads, reopening to the same document; only the menu marks it clean', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const before = await snapshot(page);

      const api = await run<FileResult>(page, { op: 'doc.save' });
      expect(await isDirty(page)).toBe(true);
      expect(await snapshot(page)).toEqual(before);
      const ui = await captureDownload(page, () => clickMenu(page, 'File', 'Save Project'));
      expect(await isDirty(page)).toBe(false);
      expect(ui.filename).toBe('lopsy.lopsy');
      expect({ mime: api.mime, ext: api.ext }).toEqual({ mime: 'application/octet-stream', ext: 'lopsy' });
      expect(bytesOf(api).equals(ui.bytes)).toBe(true);

      await run(page, { op: 'doc.open', base64: ui.bytes.toString('base64'), name: 'menu.lopsy' });
      const fromMenu = await snapshot(page);
      await run(page, { op: 'doc.open', base64: api.base64, name: 'api.lopsy' });
      const fromApi = await snapshot(page);
      expect(fromApi).toEqual(fromMenu);
      expect(fromApi.layers.map((l) => l.pixels)).toEqual(before.layers.map((l) => l.pixels));
      expect(fromApi.composite).toBe(before.composite);
    });

    test('doc.export-psd: the bytes File > Export PSD downloads; both reopen to the same document', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      await run(page, { op: 'mask.add' });

      const api = await run<FileResult>(page, { op: 'doc.export-psd' });
      expect(await isDirty(page)).toBe(true);
      const ui = await captureDownload(page, () => clickMenu(page, 'File', 'Export PSD'));
      expect(await isDirty(page)).toBe(false);
      expect(ui.filename).toBe('lopsy.psd');
      expect(api.ext).toBe('psd');
      expect(bytesOf(api).subarray(0, 4).toString('latin1')).toBe('8BPS');
      expect(bytesOf(api).equals(ui.bytes)).toBe(true);

      await run(page, { op: 'doc.open', base64: ui.bytes.toString('base64'), name: 'menu.psd' });
      const fromMenu = await snapshot(page);
      await run(page, { op: 'doc.open', base64: api.base64, name: 'api.psd' });
      const fromApi = await snapshot(page);
      expect(fromApi).toEqual(fromMenu);
      expect(fromApi.document).toEqual({ width: 200, height: 150, colorMode: 'rgb' });
      expect(fromApi.layers.some((l) => l.hasMask)).toBe(true);
    });

    test('doc.export-psd writes 8-bit when asked and rejects other depths', async ({ page }) => {
      await newDocument(page);
      const eight = bytesOf(await run<FileResult>(page, { op: 'doc.export-psd', depth: 8 }));
      const sixteen = bytesOf(await run<FileResult>(page, { op: 'doc.export-psd' }));
      expect(eight.readUInt16BE(22)).toBe(8);
      expect(sixteen.readUInt16BE(22)).toBe(16);
      expect(await runError(page, { op: 'doc.export-psd', depth: 12 })).toEqual({ code: 'invalid', message: 'doc.export-psd: depth must be 8 or 16, got 12' });
    });

    test('doc.save and doc.export-psd need a document', async ({ page }) => {
      expect((await runError(page, { op: 'doc.save' })).code).toBe('unavailable');
      expect((await runError(page, { op: 'doc.export-psd' })).code).toBe('unavailable');
    });
  });

  test.describe('doc.open', () => {
    // The offline font fixture answers jsDelivr with 404s, and a failed image decode logs one.
    test.use({ allowConsoleErrors: [/Failed to load resource/] });

    test('a PNG: the same document as File > Open... with the same file', async ({ page }) => {
      const png = await makePngInPage(page, 64, 48, [{ x: 10, y: 8, width: 20, height: 12, rgb: BLUE }]);
      const { api } = await compareUiAndApi(page, {
        viaUi: (p) => openThroughMenu(p, 'Open...', 'probe.png', png),
        viaApi: async (p) => {
          const result = await run<OpenResult>(p, { op: 'doc.open', base64: png.toString('base64'), name: 'probe.png' });
          expect({ width: result.width, height: result.height }).toEqual({ width: 64, height: 48 });
          expect(result.layers.map((l) => l.name)).toEqual(['Background', 'Project']);
          expect(await documentName(p)).toBe('probe');
        },
      });
      expect(api.history).toEqual({ undo: ['New Document'], redo: [] });
    });

    test('a .lopsy with text, a mask, effects, an adjustment and a path: the same document as File > Open Project..., fonts loaded on return', async ({ page }) => {
      await serveFontsOffline(page);
      await page.reload();
      await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__lopsyCommands);
      await newDocument(page);
      await paintTwoLayers(page);
      await run(page, { op: 'mask.add' });
      await run(page, { op: 'layer.effects', stroke: { enabled: true, width: 3 } });
      await run(page, { op: 'adjust.add', type: 'exposure' });
      await run(page, { op: 'select.rect', x: 30, y: 30, width: 40, height: 30 });
      await run(page, { op: 'select.to-path' });
      await run(page, { op: 'select.none' });
      await startTextEditing(page, 30, 120, 'Hamburg');
      await page.locator('button[aria-haspopup="listbox"]').click();
      await page.locator('input[aria-label="Search fonts"]').fill(FAMILY);
      const option = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${FAMILY}$`) }).first();
      await option.click();
      await page.keyboard.press('Shift+Enter');
      await expect.poll(() => isFontLoaded(page, FAMILY), { timeout: 20_000 }).toBe(true);
      await settle(page, 400);
      const saved = bytesOf(await run<FileResult>(page, { op: 'doc.save' }));
      const original = await snapshot(page);

      const { api } = await compareUiAndApi(page, {
        viaUi: (p) => openThroughMenu(p, 'Open Project...', 'rich.lopsy', saved),
        viaApi: async (p) => {
          expect(await isFontLoaded(p, FAMILY)).toBe(false);
          await run(p, { op: 'doc.open', base64: saved.toString('base64'), name: 'rich.lopsy' });
          expect(await isFontLoaded(p, FAMILY)).toBe(true);
        },
      });
      const types = api.layers.map((l) => l.type);
      expect(types).toContain('text');
      expect(api.layers.some((l) => l.hasMask)).toBe(true);
      expect(api.paths.length).toBeGreaterThan(0);
      expect(JSON.stringify(api.layers.map((l) => l.effects))).toContain('"stroke"');
      expect(api.layers.find((l) => l.type === 'group')!.adjustments!.nodes.map((n) => n.type)).toContain('exposure');
      expect(api.composite).toBe(original.composite);
    });

    test('an unchanged document after every error: corrupt PNG, truncated .lopsy, unsupported type, malformed base64', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const saved = bytesOf(await run<FileResult>(page, { op: 'doc.save' }));
      const before = await snapshot(page);
      const garbage = Buffer.from('this is not an image at all').toString('base64');

      const corrupt = await runError(page, { op: 'doc.open', base64: garbage, name: 'broken.png' });
      expect(corrupt).toEqual({ code: 'invalid', message: 'doc.open: could not open "broken.png": the browser could not decode it as an image' });
      const truncated = await runError(page, { op: 'doc.open', base64: saved.subarray(0, saved.length - 200).toString('base64'), name: 'cut.lopsy' });
      expect(truncated.code).toBe('invalid');
      expect(truncated.message).toMatch(/^doc\.open: could not open "cut\.lopsy": /);
      const notLopsy = await runError(page, { op: 'doc.open', base64: garbage, name: 'fake.lopsy' });
      expect(notLopsy).toEqual({ code: 'invalid', message: 'doc.open: could not open "fake.lopsy": Not a valid .lopsy file — missing magic bytes.' });
      const unsupported = await runError(page, { op: 'doc.open', base64: garbage, name: 'notes.txt' });
      expect(unsupported.code).toBe('invalid');
      expect(unsupported.message).toContain('"notes.txt" is not a type File > Open... opens');
      expect(await runError(page, { op: 'doc.open', base64: 'not*base64!', name: 'x.png' })).toEqual({
        code: 'invalid',
        message: 'doc.open: base64 is not valid base64',
      });

      expect(await snapshot(page)).toEqual(before);
      expect(await toasts(page)).toEqual([]);
    });

    test('File > Open... still toasts a corrupt image and a truncated project exactly once', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const saved = bytesOf(await run<FileResult>(page, { op: 'doc.save' }));
      watchDialogs(page, true);

      const [imageChooser] = await Promise.all([page.waitForEvent('filechooser'), clickMenu(page, 'File', 'Open...')]);
      await imageChooser.setFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('nope') });
      await expect.poll(() => toasts(page)).toEqual(['Failed to open image: broken.png']);

      const [projectChooser] = await Promise.all([page.waitForEvent('filechooser'), clickMenu(page, 'File', 'Open...')]);
      await projectChooser.setFiles({ name: 'cut.lopsy', mimeType: 'application/octet-stream', buffer: saved.subarray(0, 40) });
      await expect.poll(async () => (await toasts(page)).length).toBe(2);
      const list = await toasts(page);
      expect(list[1]).toMatch(/^Failed to load project: /);
    });
  });

  test.describe('layer.add-image', () => {
    test('matches dropping the image file on the canvas', async ({ page }) => {
      const png = await makePngInPage(page, 60, 40, [{ x: 0, y: 0, width: 30, height: 40, rgb: RED }]);
      const { api } = await compareUiAndApi(page, {
        setup: async (p) => {
          await fillRect(p, 10, 10, 50, 50, BLUE);
          await pressKey(p, 'ControlOrMeta+d');
          await settle(p);
        },
        viaUi: async (p) => {
          await dropFile(p, 'drop.png', 'image/png', png);
          await p.waitForFunction(() => {
            const s = (window as unknown as {
              __editorStore: { getState: () => { selection: { active: boolean }; undoStack: Array<{ label: string }> } };
            }).__editorStore.getState();
            return s.selection.active && s.undoStack.some((e) => e.label === 'Paste');
          });
        },
        viaApi: async (p) => {
          const { id } = await run<{ id: string }>(p, { op: 'layer.add-image', base64: png.toString('base64'), name: 'drop.png' });
          const active = await p.evaluate(() =>
            (window as unknown as { __editorStore: { getState: () => { document: { activeLayerId: string } } } }).__editorStore.getState().document.activeLayerId,
          );
          expect(active).toBe(id);
        },
        withEditorState: true,
      });
      expect(api.editor.tool).toBe('move');
      expect(api.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Pasted Layer', 'Project']);
      expect(api.selection.active).toBe(true);
      expect(api.history.undo.at(-1)).toBe('Paste');
    });

    test('shrinks an image larger than the canvas to fit, as a drop does', async ({ page }) => {
      await newDocument(page);
      const png = await makePngInPage(page, 400, 150, []);
      await run(page, { op: 'layer.add-image', base64: png.toString('base64'), name: 'wide.png' });
      // The selection of the pasted pixels shows the fitted size (the selection floats the layer to the document's size).
      const info = await run<{ selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null } }>(page, { op: 'doc.info' });
      expect(info.selection.active).toBe(true);
      expect(info.selection.bounds).toEqual({ x: 0, y: 38, width: 200, height: 75 });
    });

    test('rejects an undecodable file and malformed base64, leaving the document, and needs a document', async ({ page }) => {
      const garbage = Buffer.from('definitely not pixels').toString('base64');
      expect((await runError(page, { op: 'layer.add-image', base64: garbage, name: 'x.png' })).code).toBe('unavailable');
      await newDocument(page);
      await paintTwoLayers(page);
      const before = await snapshot(page);
      const bad = await runError(page, { op: 'layer.add-image', base64: garbage, name: 'x.png' });
      expect(bad.code).toBe('invalid');
      expect(bad.message).toMatch(/^layer\.add-image: could not decode "x\.png" as an image: /);
      expect(await runError(page, { op: 'layer.add-image', base64: '@@@', name: 'x.png' })).toEqual({
        code: 'invalid',
        message: 'layer.add-image: base64 is not valid base64',
      });
      expect(await snapshot(page)).toEqual(before);
    });
  });

  test.describe('an image too large for this device', () => {
    /** The largest document side here: the GPU's largest texture (8,192 on SwiftShader), at most 16,384. */
    async function documentLimit(page: Page): Promise<number> {
      const gpu = await page.evaluate(async (wgpu) => {
        if (wgpu) {
          const nav = navigator as unknown as { gpu: { requestAdapter: () => Promise<{ limits: { maxTextureDimension2D: number } } | null> } };
          return (await nav.gpu.requestAdapter())?.limits.maxTextureDimension2D ?? 0;
        }
        const gl = document.createElement('canvas').getContext('webgl2');
        return (gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined) ?? 0;
      }, process.env.LOPSY_RENDERER === 'wgpu');
      expect(gpu).toBeGreaterThan(0);
      return Math.min(gpu, 16384);
    }

    const reason = (name: string, width: number, height: number, limit: number) =>
      `${name} is ${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} pixels. Lopsy keeps each layer as one image in this device's graphics memory, ` +
      `and the largest this device allows is ${limit.toLocaleString('en-US')} pixels on a side. Make the image smaller and open it again.`;

    test('doc.open and layer.add-image refuse it with the reason, change nothing and show nothing', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const limit = await documentLimit(page);
      const before = await snapshot(page);
      const png = (await makePngInPage(page, limit + 8, 16, [])).toString('base64');

      expect(await runError(page, { op: 'doc.open', base64: png, name: 'wide.png' })).toEqual({
        code: 'refused',
        message: `doc.open: This image is too large to open: ${reason('wide.png', limit + 8, 16, limit)}`,
      });
      expect(await runError(page, { op: 'layer.add-image', base64: png, name: 'wide.png' })).toEqual({
        code: 'refused',
        message: `layer.add-image: This image is too large to open: ${reason('wide.png', limit + 8, 16, limit)}`,
      });

      expect(await snapshot(page)).toEqual(before);
      expect(await toasts(page)).toEqual([]);
      // The API caller has the reason; the canvas shows no message for it.
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });
  });
});

