/**
 * #1443 — Undo then Redo of a Merge Down on a dropped image brought the
 * merged layer back without the image. mergeLayers rewrote the lower layer's
 * texture after the history snapshot without marking it dirty, so when its
 * bounds didn't change the redo entry reused its pre-merge snapshot.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, getEditorState, waitForStore } from './helpers';

interface Rgb { r: number; g: number; b: number }

const ORANGE: Rgb = { r: 255, g: 205, b: 107 };

async function readComposited(page: Page, x: number, y: number): Promise<Rgb> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as Record<string, unknown>;
    const readFn = w.__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const snap = await readFn();
    if (!snap) throw new Error('no composited pixels');
    const state = (w.__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    }).getState();
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const ratio = snap.width / container.clientWidth;
    const cssW = snap.width / ratio;
    const cssH = snap.height / ratio;
    const sx = Math.floor(((x + 0.5 - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cssW / 2) * ratio);
    const sy = Math.floor(((y + 0.5 - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cssH / 2) * ratio);
    const idx = ((snap.height - 1 - sy) * snap.width + sx) * 4;
    return { r: snap.pixels[idx] ?? 0, g: snap.pixels[idx + 1] ?? 0, b: snap.pixels[idx + 2] ?? 0 };
  }, { x, y });
}

function expectClose(actual: Rgb, expected: Rgb, tolerance = 3): void {
  expect(Math.abs(actual.r - expected.r), `r of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g), `g of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b), `b of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
}

async function dropImage(page: Page, width: number, height: number, color: Rgb): Promise<void> {
  await page.evaluate(async ({ w, h, color }) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    ctx.fillRect(0, 0, w, h);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const file = new File([blob], 'photo.png', { type: 'image/png' });
    const target = document.querySelector('[data-testid="canvas-container"]');
    if (!target) throw new Error('No drop target found');
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, { w: width, h: height, color });
}

async function mergeDownFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Merge Down' }).click();
  await page.waitForTimeout(200);
}

test.describe('Merge Down redo keeps a dropped image (#1443)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer menu requires desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(200);
  });

  test('undo then redo restores the merged image', async ({ page }) => {
    const layersBefore = (await getEditorState(page)).document.layers.length;
    await dropImage(page, 200, 200, ORANGE);
    await expect.poll(async () => (await getEditorState(page)).document.layers.length).toBe(layersBefore + 1);
    await page.waitForTimeout(300);
    expectClose(await readComposited(page, 100, 100), ORANGE);

    await mergeDownFromMenu(page);
    expect((await getEditorState(page)).document.layers.length).toBe(layersBefore);
    expectClose(await readComposited(page, 100, 100), ORANGE);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.layers.length).toBe(layersBefore + 1);
    expectClose(await readComposited(page, 100, 100), ORANGE);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(200);
    expect((await getEditorState(page)).document.layers.length).toBe(layersBefore);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-redo-dropped-image.png' });
    expectClose(await readComposited(page, 100, 100), ORANGE);
  });
});
