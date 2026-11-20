/**
 * The `view` commands (src/commands/view/view.ts): renders of the document
 * and of one layer, and the Eyedropper's sample, all read-only and settled
 * before they read.
 *
 * Documents are 200x150 with a white Background, a red block on Layer 1 and
 * a blue block on a second layer, unless a test says otherwise.
 */
import { test, expect, run, runError, snapshot, type Page } from './harness';
import { docToScreen, selectTool } from '../helpers';
import { fillRect, settle } from '../surface-helpers';
import { decodeImageInPage, isDirty } from '../surface-helpers-file';
import { editorState } from './harness';
import { openMenuDialog, setFilterValue } from '../surface-helpers-filters';
import { pressKey } from '../surface-helpers-keys';

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

interface RenderResult {
  mime: string;
  width: number;
  height: number;
  base64: string;
}

interface LayerRenderResult extends RenderResult {
  x: number;
  y: number;
}

interface SampleResult {
  hex: string;
  alpha: number;
}

function bytesOf(result: { base64: string }): Buffer {
  return Buffer.from(result.base64, 'base64');
}

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

async function newDocument(page: Page, transparent = false): Promise<void> {
  await run(page, { op: 'doc.new', width: 200, height: 150, background: transparent ? 'transparent' : 'white' });
  await page.waitForSelector('[data-testid="canvas-container"]');
  await settle(page, 300);
}

async function paintTwoLayers(page: Page): Promise<string> {
  await fillRect(page, 20, 20, 120, 100, RED);
  await pressKey(page, 'ControlOrMeta+d');
  const { id } = await run<{ id: string }>(page, { op: 'layer.add' });
  await fillRect(page, 80, 50, 180, 130, BLUE);
  await pressKey(page, 'ControlOrMeta+d');
  await settle(page);
  return id;
}

async function dirtyFlagsAndHistory(page: Page): Promise<unknown> {
  const snap = await snapshot(page);
  return { dirty: await isDirty(page), history: snap.history, selection: snap.selection, layers: snap.layers, composite: snap.composite };
}

/** Clicks the Eyedropper at a document point and returns the foreground it set. */
async function eyedropperAt(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  await selectTool(page, 'eyedropper');
  const at = await docToScreen(page, x + 0.5, y + 0.5);
  await page.mouse.click(at.x, at.y);
  await settle(page, 200);
  return (await editorState(page)).foreground;
}

function hexOf(color: { r: number; g: number; b: number }): string {
  return `#${[color.r, color.g, color.b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

test.describe('the view commands', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'the menu bar needs the desktop layout');
  });

  test.describe('view.render', () => {
    test('renders the document at full size: the right pixels, the same as doc.export, and nothing changes', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      await run(page, { op: 'select.rect', x: 10, y: 10, width: 50, height: 40 });
      const before = await dirtyFlagsAndHistory(page);

      const render = await run<RenderResult>(page, { op: 'view.render' });
      expect({ mime: render.mime, width: render.width, height: render.height }).toEqual({ mime: 'image/png', width: 200, height: 150 });
      const decoded = await decodeImageInPage(page, bytesOf(render), [{ x: 50, y: 40 }, { x: 150, y: 120 }, { x: 100, y: 80 }, { x: 5, y: 5 }]);
      expect(decoded.probes).toEqual([{ ...RED, a: 255 }, { ...BLUE, a: 255 }, { ...BLUE, a: 255 }, WHITE]);
      const exported = await run<RenderResult>(page, { op: 'doc.export', format: 'png' });
      expect(await decodedHash(page, bytesOf(render))).toBe(await decodedHash(page, bytesOf(exported)));
      expect(await dirtyFlagsAndHistory(page)).toEqual(before);
    });

    test('respects maxSize, keeping the aspect ratio, and does not scale up', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const small = await run<RenderResult>(page, { op: 'view.render', maxSize: 100 });
      expect({ width: small.width, height: small.height }).toEqual({ width: 100, height: 75 });
      const decoded = await decodeImageInPage(page, bytesOf(small), [{ x: 25, y: 20 }, { x: 75, y: 60 }, { x: 2, y: 2 }]);
      expect({ w: decoded.width, h: decoded.height }).toEqual({ w: 100, h: 75 });
      expect(decoded.probes).toEqual([{ ...RED, a: 255 }, { ...BLUE, a: 255 }, WHITE]);
      const big = await run<RenderResult>(page, { op: 'view.render', maxSize: 1000 });
      expect({ width: big.width, height: big.height }).toEqual({ width: 200, height: 150 });
      expect((await runError(page, { op: 'view.render', maxSize: 4097 })).code).toBe('invalid');
      expect((await runError(page, { op: 'view.render', format: 'jpeg' })).code).toBe('invalid');
    });

    test('shows layer effects and adjustments, as the export composite does', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const plain = await run<RenderResult>(page, { op: 'view.render' });
      await run(page, { op: 'layer.effects', stroke: { enabled: true, width: 6, color: '#00ff00' } });
      const stroked = await run<RenderResult>(page, { op: 'view.render' });
      const edge = await decodeImageInPage(page, bytesOf(stroked), [{ x: 77, y: 90 }]);
      expect(edge.probes[0]).toEqual({ r: 0, g: 255, b: 0, a: 255 });

      const { id } = await run<{ id: string }>(page, { op: 'adjust.add', type: 'exposure' });
      await run(page, { op: 'adjust.set', node: id, params: { exposure: -1 } });
      const adjusted = await run<RenderResult>(page, { op: 'view.render' });
      const darker = await decodeImageInPage(page, bytesOf(adjusted), [{ x: 5, y: 5 }, { x: 77, y: 90 }]);
      expect(darker.probes[0]!.r).toBeLessThan(200);
      expect(darker.probes[1]!.g).toBeLessThan(200);
      const exported = await run<RenderResult>(page, { op: 'doc.export', format: 'png' });
      expect(await decodedHash(page, bytesOf(adjusted))).toBe(await decodedHash(page, bytesOf(exported)));
      expect(await decodedHash(page, bytesOf(plain))).not.toBe(await decodedHash(page, bytesOf(stroked)));
    });

    /**
     * Clicks `selector` and, in the same task, starts a raw export-composite
     * read (what a read that does not settle first sees) and view.render.
     */
    async function clickThenRead(page: Page, selector: string, text?: string): Promise<{ raw: string; render: string }> {
      return page.evaluate(async ({ sel, label }) => {
        const w = window as unknown as {
          __lopsyCommands: { run: (i: unknown) => Promise<{ base64: string }> };
          __engineState: { getEngine: () => unknown };
          __wasmBridge: { compositeForExport: (e: unknown) => Promise<Uint8Array> };
        };
        const target = [...document.querySelectorAll<HTMLElement>(sel)].find((el) => label === null || el.textContent === label);
        if (!target) throw new Error(`nothing matches ${sel}`);
        target.click();
        const rawRead = w.__wasmBridge.compositeForExport(w.__engineState.getEngine());
        const rendered = w.__lopsyCommands.run({ op: 'view.render' });
        const hash = (bytes: ArrayLike<number>): string => {
          let h = 0x811c9dc5;
          for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i]!;
            h = Math.imul(h, 0x01000193) >>> 0;
          }
          return h.toString(16);
        };
        const decode = async (base64: string): Promise<string> => {
          const binary = atob(base64);
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes]));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
          ctx.drawImage(bitmap, 0, 0);
          return hash(ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' }).data);
        };
        return { raw: hash(await rawRead), render: await decode((await rendered).base64) };
      }, { sel: selector, label: text ?? null });
    }

    async function settledHashes(page: Page): Promise<{ raw: string; render: string }> {
      await settle(page, 300);
      return clickThenRead(page, 'body');
    }

    test('issued in the same task as hiding a layer, it shows the layer hidden where an unsettled read does not', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const shown = await settledHashes(page);
      const seen = await clickThenRead(page, 'button[aria-label="Hide layer"]');
      const hidden = await settledHashes(page);
      expect(hidden.render).not.toBe(shown.render);
      expect(seen.render).toBe(hidden.render);
      // What 'before' buys: the same read without the settle still sees the layer.
      expect(seen.raw).toBe(shown.raw);
    });

    test('issued in the same task as a filter dialog\'s Apply, it shows the filtered document', async ({ page }) => {
      await newDocument(page);
      await paintTwoLayers(page);
      const unfiltered = await settledHashes(page);
      const dialog = await openMenuDialog(page, 'Filter', 'Gaussian Blur...', 'Gaussian Blur');
      await setFilterValue(dialog, 'Radius', 8);
      const seen = await clickThenRead(page, '[role="dialog"] button', 'Apply');
      const filtered = await settledHashes(page);
      expect(filtered.render).not.toBe(unfiltered.render);
      expect(seen.render).toBe(filtered.render);
    });

    test('needs a document', async ({ page }) => {
      expect((await runError(page, { op: 'view.render' })).code).toBe('unavailable');
    });
  });

  test.describe('view.render-layer', () => {
    test('shows only that layer\'s pixels, transparent where it is empty, at its place in the document', async ({ page }) => {
      await newDocument(page);
      const top = await paintTwoLayers(page);
      const render = await run<LayerRenderResult>(page, { op: 'view.render-layer', layer: top });
      const decoded = await decodeImageInPage(page, bytesOf(render), [
        { x: 150 - render.x, y: 120 - render.y },
        { x: 50 - render.x, y: 40 - render.y },
      ]);
      expect(decoded.probes[0]).toEqual({ ...BLUE, a: 255 });
      expect(decoded.probes[1]!.a).toBe(0);
      const below = await run<LayerRenderResult>(page, { op: 'view.render-layer', layer: 'Layer 1' });
      const under = await decodeImageInPage(page, bytesOf(below), [{ x: 100 - below.x, y: 80 - below.y }]);
      expect(under.probes[0]).toEqual({ ...RED, a: 255 });
      const small = await run<LayerRenderResult>(page, { op: 'view.render-layer', layer: top, maxSize: 50 });
      expect(Math.max(small.width, small.height)).toBe(50);
    });

    test('is refused for a group and needs a known layer', async ({ page }) => {
      await newDocument(page);
      expect(await runError(page, { op: 'view.render-layer', layer: 'Project' })).toEqual({
        code: 'refused',
        message: '"Project" is a group: it has no pixels of its own.',
      });
      expect((await runError(page, { op: 'view.render-layer', layer: 'Nope' })).code).toBe('not-found');
    });
  });

  test.describe('view.sample', () => {
    test('reads what the Eyedropper picks, opaque, semi-transparent and blended, without changing the foreground', async ({ page }) => {
      await newDocument(page, true);
      await fillRect(page, 20, 20, 120, 100, RED);
      await pressKey(page, 'ControlOrMeta+d');
      await run(page, { op: 'layer.add' });
      await fillRect(page, 80, 50, 180, 130, BLUE);
      await pressKey(page, 'ControlOrMeta+d');
      await run(page, { op: 'layer.set', opacity: 50 });
      await settle(page);

      const points = [
        { x: 40, y: 30, what: 'opaque red' },
        { x: 150, y: 120, what: 'half-transparent blue' },
        { x: 100, y: 80, what: 'blue at 50% over red' },
        { x: 5, y: 5, what: 'empty' },
      ];
      for (const point of points) {
        const foregroundBefore = (await editorState(page)).foreground;
        const sample = await run<SampleResult>(page, { op: 'view.sample', x: point.x, y: point.y });
        expect((await editorState(page)).foreground, point.what).toEqual(foregroundBefore);
        const picked = await eyedropperAt(page, point.x, point.y);
        expect({ hex: sample.hex, alpha: sample.alpha }, point.what).toEqual({ hex: hexOf(picked), alpha: picked.a });
      }
    });

    test('outside the canvas it reads transparent black, which the Eyedropper also picks', async ({ page }) => {
      await newDocument(page);
      const sample = await run<SampleResult>(page, { op: 'view.sample', x: -10, y: 160 });
      expect(sample).toEqual({ hex: '#000000', alpha: 0 });
      expect(await eyedropperAt(page, -10, 160)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    test('rejects a fractional point and needs a document', async ({ page }) => {
      expect((await runError(page, { op: 'view.sample', x: 1, y: 1 })).code).toBe('unavailable');
      await newDocument(page);
      expect((await runError(page, { op: 'view.sample', x: 1.5, y: 1 })).code).toBe('invalid');
    });
  });
});

