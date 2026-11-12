import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, addLayer, drawRect, selectTool } from './helpers';

/**
 * #1604 (#1291) — Align must not read every layer back from the GPU.
 *
 * Align only needs content bounds, which the engine reduces on the GPU and
 * reads back as a column strip and a row strip. Before the fix it read every
 * layer in the document as full RGBA (width × height pixels each) on every
 * click, for the single-layer and the multi-layer (#1517) paths alike. The test
 * counts the pixels requested by `readPixels` while each Align click is
 * dispatched, which is hardware-independent.
 */

const DOC_W = 1600;
const DOC_H = 1200;

async function installClickReadCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __readPx: number; __clickReadPx: number[] };
    w.__readPx = 0;
    w.__clickReadPx = [];
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      w.__readPx += Number(args[2]) * Number(args[3]);
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;
    let atStart = 0;
    window.addEventListener('click', () => { atStart = w.__readPx; }, { capture: true });
    window.addEventListener('click', () => { w.__clickReadPx.push(w.__readPx - atStart); });
  });
}

async function lastClickReadPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const list = (window as unknown as { __clickReadPx: number[] }).__clickReadPx;
    return list[list.length - 1] ?? -1;
  });
}

async function layerXs(page: Page, ids: string[]): Promise<number[]> {
  return page.evaluate((ids) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: { id: string; x: number }[] } };
    };
    const layers = store.getState().document.layers;
    return ids.map((id) => layers.find((l) => l.id === id)!.x);
  }, ids);
}

test.describe('Align reads content bounds on the GPU (#1604)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'Move options bar is desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);
  });

  test('single-layer and multi-layer Align click read far less than one layer', async ({ page }) => {
    const ids: string[] = [];
    const spots = [[300, 200], [700, 500], [1100, 800]] as const;
    for (const [x, y] of spots) {
      ids.push(await addLayer(page));
      await drawRect(page, x, y, 200, 200, { r: 200, g: 40, b: 40 });
    }
    await selectTool(page, 'move');
    await installClickReadCounter(page);

    await page.getByRole('button', { name: 'Align left', exact: true }).click();
    await page.waitForTimeout(200);
    const singleRead = await lastClickReadPx(page);
    expect(await layerXs(page, ids)).toEqual([300, 700, 0]);

    // Multi-select the other two layers in the Layers panel.
    await page.locator(`[data-layer-id="${ids[0]}"]`).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Align right', exact: true }).click();
    await page.waitForTimeout(200);
    const multiRead = await lastClickReadPx(page);

    expect(singleRead).toBeGreaterThanOrEqual(0);
    expect(multiRead).toBeGreaterThanOrEqual(0);
    // One full layer readback is DOC_W × DOC_H; the GPU reduce reads strips.
    expect(singleRead).toBeLessThan((DOC_W * DOC_H) / 10);
    expect(multiRead).toBeLessThan((DOC_W * DOC_H) / 10);

    // The three selected 200 px squares line up on their shared right edge
    // (x 900, the right edge of the middle square).
    expect(await layerXs(page, ids)).toEqual([700, 700, 700]);
  });
});
