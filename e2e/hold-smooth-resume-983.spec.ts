import { test, expect, type Page } from './fixtures';
import {
  closeBrushModal, createDocument, docToScreen, setBrushModalOption, setForegroundColor,
  setToolOption, waitForStore,
} from './helpers';

// #983: hold-to-smooth fired while the button was still down and reset the
// interaction, so everything dragged after the pause was silently dropped.

interface Composite { width: number; height: number; pixels: number[] }

async function readComposite(page: Page): Promise<Composite> {
  return page.evaluate(async () => {
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<Composite | null>;
    return (await read()) ?? { width: 0, height: 0, pixels: [] };
  });
}

/** Doc-space columns that contain a dark (painted) pixel in the composite. */
async function paintedColumns(page: Page): Promise<boolean[]> {
  const comp = await readComposite(page);
  const probe = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } };
    };
    const s = store.getState();
    const container = document.querySelector('[data-testid="canvas-container"]')!;
    const rect = container.getBoundingClientRect();
    const canvas = container.querySelector('canvas')!;
    return {
      docW: s.document.width, docH: s.document.height, zoom: s.viewport.zoom,
      panX: s.viewport.panX, panY: s.viewport.panY,
      cx: rect.width / 2, cy: rect.height / 2, canvasH: canvas.height,
      dpr: canvas.width / rect.width,
    };
  });
  const columns: boolean[] = new Array<boolean>(probe.docW).fill(false);
  for (let dy = 0; dy < probe.docH; dy += 2) {
    for (let dx = 0; dx < probe.docW; dx++) {
      const sx = Math.round(((dx - probe.docW / 2) * probe.zoom + probe.panX + probe.cx) * probe.dpr);
      const syTop = Math.round(((dy - probe.docH / 2) * probe.zoom + probe.panY + probe.cy) * probe.dpr);
      const sy = probe.canvasH - 1 - syTop;
      if (sx < 0 || sy < 0 || sx >= comp.width || sy >= comp.height) continue;
      const i = (sy * comp.width + sx) * 4;
      if (comp.pixels[i]! < 100 && comp.pixels[i + 1]! < 100 && comp.pixels[i + 2]! < 100) {
        columns[dx] = true;
      }
    }
  }
  return columns;
}

async function zigzag(page: Page, fromX: number, toX: number): Promise<void> {
  let isLow = true;
  for (let x = fromX; x < toX; x += 16) {
    const p = await docToScreen(page, Math.min(toX, x + 16), isLow ? 120 : 80);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    isLow = !isLow;
  }
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((h) => h.label);
  });
}

test.describe('Hold-to-smooth keeps painting when the drag continues (#983)', () => {
  test('pausing mid-stroke then dragging on paints the whole drag', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 8);
    await setToolOption(page, 'Opacity', 100);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 0);
    await setBrushModalOption(page, 'Scatter', 0);
    await closeBrushModal(page);
    await setForegroundColor(page, 0, 0, 0);

    const before = await historyLabels(page);
    const start = await docToScreen(page, 40, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await zigzag(page, 40, 140);

    // Hold still with the button down long enough for hold-to-smooth.
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/hold-smooth-resume-983-paused.png' });

    await zigzag(page, 140, 360);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/hold-smooth-resume-983-after.png' });

    // Stroke start, the freehand snapshot hold-to-smooth pushes, then the
    // resumed stroke: the smoothing fired and the drag carried on after it.
    expect(await historyLabels(page)).toEqual([...before, 'Brush', 'Brush', 'Brush']);

    const columns = await paintedColumns(page);
    const minX = columns.indexOf(true);
    const maxX = columns.lastIndexOf(true);
    // Before the fix the paint stopped at the pause (x ≈ 140).
    expect(minX).toBeLessThan(45);
    expect(maxX).toBeGreaterThan(350);
    // The drag after the pause is painted continuously, not just its end.
    const gaps = [];
    for (let x = 140; x <= 350; x++) if (!columns[x]) gaps.push(x);
    expect(gaps).toEqual([]);
  });
});
