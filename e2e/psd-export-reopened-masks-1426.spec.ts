import { test, expect, type Page } from './fixtures';
import {
  addLayer, createDocument, docToScreen, selectTool, setActiveLayer, setForegroundColor,
  setToolOption, waitForStore,
} from './helpers';

// #1426: a project load gives every layer mask a view into the project's
// shared blob buffer. Export PSD packed `new Uint8Array(mask.data.buffer)`,
// i.e. the whole shared buffer from byte 0, so every exported mask started
// with the wrong bytes (and with several masks they all came out identical).

interface MaskSamples { width: number; height: number; values: number[] }

const SAMPLE_POINTS: Array<[number, number]> = [
  [100, 40], [300, 40], [100, 150], [300, 150], [100, 250], [300, 250], [200, 100], [200, 195],
];

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function fillLayer(page: Page, r: number, g: number, b: number): Promise<void> {
  await setForegroundColor(page, r, g, b);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
}

/** Paints a hard black stroke across the active layer's mask at doc row y. */
async function layerName(page: Page, layerId: string): Promise<string> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    return store.getState().document.layers.find((l) => l.id === lid)?.name ?? '';
  }, layerId);
}

async function hideRow(page: Page, layerName: string, layerId: string, y: number): Promise<void> {
  await page.locator('[aria-label="Add Mask"]').click();
  await page.locator(`[aria-label="Edit mask for ${layerName}"]`).click();
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'brush');
  await setToolOption(page, 'Size', 60);
  await setToolOption(page, 'Hardness', 100);
  await dragDoc(page, 20, y, 380, y);
  await page.locator(`[data-layer-id="${layerId}"]`).click();
  await page.waitForTimeout(200);
}

/** Mask values at SAMPLE_POINTS for the layer named `name`, keyed by layer name. */
async function maskSamples(page: Page, name: string): Promise<MaskSamples | null> {
  return page.evaluate(async ({ n, points }) => {
    const { materializeAllMaskData } = await import('/src/app/mask-data-sync.ts');
    materializeAllMaskData();
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{
        name: string; x: number; y: number;
        mask?: { data: Uint8ClampedArray; width: number; height: number } | null;
      }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.name === n);
    if (!layer?.mask) return null;
    const { data, width, height } = layer.mask;
    return {
      width,
      height,
      values: points.map(([x, y]) => data[y * width + x] ?? -1),
    };
  }, { n: name, points: SAMPLE_POINTS });
}

async function readDownload(page: Page, trigger: () => Promise<void>): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function reloadToNewDocumentDialog(page: Page): Promise<void> {
  await page.reload();
  await waitForStore(page);
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });
}

test.describe('Export PSD after reopening a .lopsy project (#1426)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('every exported mask keeps its own bytes', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const topId = await addLayer(page);
    const name1 = await layerName(page, topId);
    await fillLayer(page, 204, 34, 68);
    await hideRow(page, name1, topId, 40);

    const bottomId = await addLayer(page);
    const name2 = await layerName(page, bottomId);
    await setActiveLayer(page, bottomId);
    await fillLayer(page, 30, 90, 220);
    await hideRow(page, name2, bottomId, 250);

    const original1 = await maskSamples(page, name1);
    const original2 = await maskSamples(page, name2);
    expect(original1).not.toBeNull();
    expect(original2).not.toBeNull();
    // Each mask hides only its own stroke row.
    expect(original1!.values).toEqual([0, 0, 255, 255, 255, 255, 255, 255]);
    expect(original2!.values).toEqual([255, 255, 255, 255, 0, 0, 255, 255]);

    const lopsy = await readDownload(page, () => page.evaluate(async () => {
      const save = (window as unknown as Record<string, unknown>).__saveProject as () => Promise<void>;
      await save();
    }));

    await reloadToNewDocumentDialog(page);
    await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'masks-1426.lopsy', { type: 'application/octet-stream' });
      const load = (window as unknown as Record<string, unknown>).__loadProject as (f: File) => Promise<void>;
      await load(file);
    }, lopsy.toString('base64'));
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 20_000 });
    await page.waitForTimeout(500);

    expect((await maskSamples(page, name1))!.values).toEqual(original1!.values);
    expect((await maskSamples(page, name2))!.values).toEqual(original2!.values);

    await page.getByRole('button', { name: /^File$/ }).click();
    const psd = await readDownload(page, () =>
      page.getByRole('menuitem', { name: /^Export PSD/ }).click());
    expect(psd.subarray(0, 4).toString('ascii')).toBe('8BPS');

    await reloadToNewDocumentDialog(page);
    await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { importPsdFile } = await import('/src/io/psd.ts');
      await importPsdFile(bytes, 'masks-1426');
    }, psd.toString('base64'));
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/psd-export-reopened-masks-1426.png' });

    const reimported1 = await maskSamples(page, name1);
    const reimported2 = await maskSamples(page, name2);
    expect(reimported1).toEqual(original1);
    expect(reimported2).toEqual(original2);
  });
});
