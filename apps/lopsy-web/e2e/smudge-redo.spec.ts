import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setToolOption,
  setForegroundColor,
  getEditorState,
} from './helpers';

/**
 * Regression test for #939: redo after undoing a smudge restored the
 * PRE-smudge pixels. Smudge writes the layer texture directly and never
 * marked the layer dirty, so the redo snapshot captured on undo reused the
 * pre-smudge texture handle and the smear was lost on redo.
 */

interface Region { width: number; height: number; pixels: number[] }

const REGION = { x: 270, y: 170, w: 260, h: 230 };

/** Read a doc-space region of the active layer's GPU texture (outside → transparent). */
async function readActiveLayerRegion(page: Page): Promise<Region> {
  return page.evaluate(async ({ rx, ry, rw, rh }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const src = await read(layer.id);
    const out: number[] = new Array(rw * rh * 4).fill(0);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const lx = rx + x - layer.x;
        const ly = ry + y - layer.y;
        if (lx < 0 || ly < 0 || lx >= src.width || ly >= src.height) continue;
        const si = (ly * src.width + lx) * 4;
        const di = (y * rw + x) * 4;
        for (let c = 0; c < 4; c++) out[di + c] = src.pixels[si + c] ?? 0;
      }
    }
    return { width: rw, height: rh, pixels: out };
  }, { rx: REGION.x, ry: REGION.y, rw: REGION.w, rh: REGION.h });
}

function channelsDiffering(a: Region, b: Region, tolerance = 2): number {
  let n = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    if (Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0)) > tolerance) n++;
  }
  return n;
}

/**
 * Pixels in the given region rows carrying paint. Layer 1 is transparent
 * (the white is a separate Background layer), so paint = alpha.
 */
function paintedPixelsInRows(r: Region, fromRow: number, toRow: number, minAlpha = 40): number {
  let n = 0;
  for (let y = fromRow; y < toRow; y++) {
    for (let x = 0; x < r.width; x++) {
      if ((r.pixels[(y * r.width + x) * 4 + 3] ?? 0) > minAlpha) n++;
    }
  }
  return n;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps: number) {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test.describe('#939 smudge survives undo/redo', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'desktop-only tool options');
  });

  test('redo restores the smudged pixels, not the pre-smudge pixels', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // Paint a thick black horizontal line across the (transparent) Layer 1 at y=200.
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 60);
    await setForegroundColor(page, 0, 0, 0);
    await drag(page, { x: 100, y: 200 }, { x: 700, y: 200 }, 20);

    // Smudge straight down through the line, pulling a black smear toward y=380.
    await page.keyboard.press('r');
    await setToolOption(page, 'Size', 60);
    await setToolOption(page, 'Strength', 90);
    await drag(page, { x: 400, y: 190 }, { x: 400, y: 380 }, 25);

    const afterSmudge = await readActiveLayerRegion(page);
    await page.screenshot({ path: 'e2e/screenshots/smudge-redo-after-smudge.png' });
    const undoDepthAfterSmudge = (await getEditorState(page)).undoStackLength;

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const afterUndo = await readActiveLayerRegion(page);
    await page.screenshot({ path: 'e2e/screenshots/smudge-redo-after-undo.png' });
    expect((await getEditorState(page)).undoStackLength).toBe(undoDepthAfterSmudge - 1);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(250);
    const afterRedo = await readActiveLayerRegion(page);
    await page.screenshot({ path: 'e2e/screenshots/smudge-redo-after-redo.png' });

    // Region rows: doc y 170..400 → rows 0..230. The line sits at doc y
    // 170..230 (rows 0..60); the smear lives below it, doc y 245..380
    // (rows 75..210).
    // Undo keeps the brushed line but removes the smear below it.
    expect(paintedPixelsInRows(afterUndo, 20, 40, 200)).toBeGreaterThan(260 * 20 * 0.9);
    expect(paintedPixelsInRows(afterUndo, 75, 210)).toBe(0);
    // The smudge pulled a real smear down below the line.
    expect(paintedPixelsInRows(afterSmudge, 75, 210)).toBeGreaterThan(800);
    expect(channelsDiffering(afterSmudge, afterUndo)).toBeGreaterThan(3000);

    // Redo must bring back exactly the smudged pixels (old bug: identical
    // to the pre-smudge readout, i.e. no smear).
    expect(channelsDiffering(afterRedo, afterSmudge)).toBeLessThan(50);
    expect(paintedPixelsInRows(afterRedo, 75, 210)).toBeGreaterThan(800);
    expect(channelsDiffering(afterRedo, afterUndo)).toBeGreaterThan(3000);
  });
});
