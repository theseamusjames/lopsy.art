/**
 * #1748 — shrinking pixels to about a third with the Move handles took one
 * bilinear tap per output pixel, so whole source rows and columns were
 * skipped and a thin slanted line broke up into dashes. The affine float
 * transform now averages the whole footprint of each output pixel.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, getEditorState } from './helpers';
import { findTransformHandle } from './text-edit-helpers';

async function rowSums(page: Page, layerId: string, y0: number, y1: number): Promise<number[]> {
  return page.evaluate(async ({ id, from, to }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    const sums: number[] = [];
    for (let y = from; y <= to; y++) {
      const ly = y - layer.y;
      let sum = 0;
      if (ly >= 0 && ly < height) {
        for (let x = 0; x < width; x++) sum += pixels[(ly * width + x) * 4 + 3] ?? 0;
      }
      sums.push(sum);
    }
    return sums;
  }, { id: layerId, from: y0, to: y1 });
}

test.describe('Move-handle downscale filters thin lines (#1748)', () => {
  test('a 3 px slanted line scaled to a third stays continuous', async ({ page, isMobile }) => {
    test.skip(isMobile, 'handle drags need a desktop pointer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(200);
    const layerId = (await getEditorState(page)).document.activeLayerId;
    if (!layerId) throw new Error('no active layer');

    // A 3 px hard line from (120, 100) to (360, 520), drawn click + Shift-click.
    await setForegroundColor(page, 0x3a, 0x2a, 0x1c);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 3);
    await setToolOption(page, 'Hardness', 100);
    const p0 = await docToScreen(page, 120, 100);
    const p1 = await docToScreen(page, 360, 520);
    await page.mouse.click(p0.x, p0.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(p1.x, p1.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);

    // Select (90, 90)-(390, 540) and drag its bottom-right handle in so the
    // box becomes (90, 90)-(190, 240): a third of its size.
    await selectTool(page, 'marquee-rect');
    const m0 = await docToScreen(page, 90, 90);
    const m1 = await docToScreen(page, 390, 540);
    await page.mouse.move(m0.x, m0.y);
    await page.mouse.down();
    await page.mouse.move(m1.x, m1.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await selectTool(page, 'move');
    const handle = await findTransformHandle(page, 'bottom-right', { x: 390, y: 540 }, 12);
    const target = await docToScreen(page, 190, 240);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    // The shrunk line runs from about (100, 93) to (180, 233). Each row it
    // crosses should hold about the same amount of ink; where taps skipped
    // the line, rows came out near empty (the dashes).
    const sums = await rowSums(page, layerId, 105, 220);
    const mean = sums.reduce((s, v) => s + v, 0) / sums.length;
    const min = Math.min(...sums);
    console.log('row ink: mean', mean.toFixed(1), 'min', min, 'rows', sums.join(','));
    expect(mean).toBeGreaterThan(100);
    expect(min / mean).toBeGreaterThan(0.6);
  });
});
