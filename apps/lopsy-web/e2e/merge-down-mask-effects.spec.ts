import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  closeEffectsPanel,
  createDocument,
  docToScreen,
  enableEffect,
  getEditorState,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';

// An upper layer with both a layer mask and effects lost its mask on Merge
// Down: the effect bake ran without the mask and the baked layer entered the
// merge with no mask, so the hidden pixels came back and the stroke traced
// the unmasked shape. The merge must look exactly like the live composite,
// where the mask hides the content and the effects follow the masked
// silhouette (#977).

interface Rgb { r: number; g: number; b: number }

const ROW_Y = 150;
const ROW_XS = Array.from({ length: 41 }, (_, i) => 100 + i * 5);

async function readCompositedRow(page: Page, docY: number, docXs: number[]): Promise<Rgb[]> {
  return page.evaluate(async ({ y, xs }) => {
    const w = window as unknown as Record<string, unknown>;
    const readFn = w.__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const snap = await readFn();
    if (!snap) return [];
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
    return xs.map((x) => {
      const sx = Math.floor(((x + 0.5 - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cssW / 2) * ratio);
      const sy = Math.floor(((y + 0.5 - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cssH / 2) * ratio);
      const idx = ((snap.height - 1 - sy) * snap.width + sx) * 4;
      return { r: snap.pixels[idx] ?? 0, g: snap.pixels[idx + 1] ?? 0, b: snap.pixels[idx + 2] ?? 0 };
    });
  }, { y: docY, xs: docXs });
}

// Edit → Fill keeps the active layer document-sized, as a user's fill does.
async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, color: Rgb): Promise<void> {
  await setForegroundColor(page, color.r, color.g, color.b);
  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function maskStroke(page: Page, x: number, y0: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x, y0);
  const b = await docToScreen(page, x, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

function maxChannelDiff(a: Rgb[], b: Rgb[]): { max: number; at: number } {
  let max = 0;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    const d = Math.max(Math.abs(pa.r - pb.r), Math.abs(pa.g - pb.g), Math.abs(pa.b - pb.b));
    if (d > max) { max = d; at = i; }
  }
  return { max, at };
}

test.describe('Merge Down — upper layer with a mask and effects', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('the merged result keeps the mask on the content and on the stroke', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    const topId = await addLayer(page);
    await fillRect(page, 120, 80, 280, 220, { r: 255, g: 0, b: 0 });

    // Hide the square's left half (x 120–200) in the mask.
    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 90);
    await maskStroke(page, 140, 60, 240);
    await maskStroke(page, 175, 60, 240);
    await page.locator(`[data-layer-id="${topId}"]`).click();
    await page.waitForTimeout(150);

    await enableEffect(page, 'Stroke');
    await closeEffectsPanel(page);

    const before = await readCompositedRow(page, ROW_Y, ROW_XS);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-mask-effects-before.png' });
    // Masked half shows the white background, visible half is red, and the
    // black outside stroke sits just past the square's right edge.
    expect(maxChannelDiff([before[ROW_XS.indexOf(140)]!], [{ r: 255, g: 255, b: 255 }]).max).toBeLessThanOrEqual(3);
    expect(maxChannelDiff([before[ROW_XS.indexOf(250)]!], [{ r: 255, g: 0, b: 0 }]).max).toBeLessThanOrEqual(3);
    const strokeBefore = await readCompositedRow(page, ROW_Y, [280, 281]);
    expect(Math.max(...strokeBefore.map((p) => p.r))).toBeLessThan(80);

    await page.getByRole('button', { name: 'Layer', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Merge Down' }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-mask-effects-after.png' });

    const state = await getEditorState(page);
    expect(state.document.layers.some((l) => l.id === topId)).toBe(false);

    const after = await readCompositedRow(page, ROW_Y, ROW_XS);
    const diff = maxChannelDiff(before, after);
    expect(diff.max, `at x=${ROW_XS[diff.at]}: ${JSON.stringify(before[diff.at])} → ${JSON.stringify(after[diff.at])}`).toBeLessThanOrEqual(3);
    const strokeAfter = await readCompositedRow(page, ROW_Y, [280, 281]);
    expect(maxChannelDiff(strokeBefore, strokeAfter).max).toBeLessThanOrEqual(3);
  });
});
