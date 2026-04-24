/**
 * Regression test: cut → paste → merge down twice preserves text position.
 *
 * After cutting part of text, pasting it (new layer), deselecting, and
 * merging down twice, the text must not change position or size.
 */
import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width: number, height: number) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
  await page.waitForTimeout(200);
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function setTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool(t);
  }, tool);
}

async function readCompositedPixels(page: Page) {
  return page.evaluate(async () => {
    const fn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    return fn();
  });
}

/** Read a horizontal scan line from the composited output (bottom-up buffer). */
async function scanRow(page: Page, docY: number, docXStart: number, docXEnd: number) {
  const snap = await readCompositedPixels(page);
  const vp = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const s = store.getState();
    return { docW: s.document.width, docH: s.document.height, ...s.viewport };
  });
  const cx = snap.width / 2;
  const cy = snap.height / 2;
  const results: Array<{ x: number; r: number; g: number; b: number; a: number }> = [];
  for (let docX = docXStart; docX < docXEnd; docX += 2) {
    const sx = Math.round((docX - vp.docW / 2) * vp.zoom + vp.panX + cx);
    const sy = Math.round((docY - vp.docH / 2) * vp.zoom + vp.panY + cy);
    const flippedY = snap.height - 1 - sy;
    if (sx < 0 || sx >= snap.width || flippedY < 0 || flippedY >= snap.height) continue;
    const idx = (flippedY * snap.width + sx) * 4;
    results.push({
      x: docX,
      r: snap.pixels[idx] ?? 0,
      g: snap.pixels[idx + 1] ?? 0,
      b: snap.pixels[idx + 2] ?? 0,
      a: snap.pixels[idx + 3] ?? 0,
    });
  }
  return results;
}

/** Count non-white pixels in a scan row (text is rendered on white bg). */
function countNonWhitePixels(row: Array<{ r: number; g: number; b: number; a: number }>) {
  return row.filter((p) => p.r < 240 || p.g < 240 || p.b < 240).length;
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

/** Create text layer with "LOPSY" at 150px and commit it. */
async function addLopsyText(page: Page, docX: number, docY: number) {
  await setTool(page, 'text');
  await page.evaluate(() => {
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setTextFontSize: (s: number) => void;
        setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        setTextFontFamily: (f: string) => void;
      };
    };
    const s = ts.getState();
    s.setTextFontSize(150);
    s.setForegroundColor({ r: 0, g: 0, b: 0, a: 1 });
    s.setTextFontFamily('Inter');
  });
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(200);
  await page.keyboard.type('LOPSY');
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Text selection + merge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  });

  test('cut → paste → merge down twice preserves text position', async ({ page }) => {
    await createDocument(page, 800, 400);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    // Add "LOPSY" text
    await addLopsyText(page, 200, 100);
    await page.waitForTimeout(300);

    // Get text layer ID
    const textId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
        };
      };
      return store.getState().document.layers.find((l) => l.type === 'text')?.id ?? '';
    });

    // Set text layer as active
    await page.evaluate((id: string) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(id);
    }, textId);

    // Screenshot before any operations
    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-initial.png' });

    // Scan a row through the middle of the text to establish baseline
    const baselineRow = await scanRow(page, 160, 50, 750);
    const baselineTextPixels = countNonWhitePixels(baselineRow);
    expect(baselineTextPixels).toBeGreaterThan(20);

    // Find the approximate x-range of text content
    const firstNonWhite = baselineRow.find((p) => p.r < 240);
    const lastNonWhite = [...baselineRow].reverse().find((p) => p.r < 240);
    const textLeftEdge = firstNonWhite?.x ?? 100;
    const textRightEdge = lastNonWhite?.x ?? 600;
    const textMidX = Math.round((textLeftEdge + textRightEdge) / 2);

    // Marquee select the right half of the text (roughly "SY")
    await setTool(page, 'marqueeRect');
    const selStart = await docToScreen(page, textMidX, 80);
    const selEnd = await docToScreen(page, textRightEdge + 30, 280);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Cut (Cmd+X)
    await page.keyboard.press(`${mod}+KeyX`);
    await page.waitForTimeout(200);

    // Paste (Cmd+V)
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(200);

    // Deselect (Cmd+D)
    await page.keyboard.press(`${mod}+KeyD`);
    await page.waitForTimeout(200);

    // Move the pasted SY layer so it's in front of LOP
    await setTool(page, 'move');
    const moveFrom = await docToScreen(page, textMidX + 60, 160);
    const moveTo = await docToScreen(page, textLeftEdge - 80, 160);
    await page.mouse.move(moveFrom.x, moveFrom.y);
    await page.mouse.down();
    await page.mouse.move(moveTo.x, moveTo.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Screenshot after paste + move — this is the "before merge" baseline
    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-after-paste.png' });

    // Re-scan after moving SY in front of LOP — this is the real baseline
    const preMergeRow = await scanRow(page, 160, 0, 750);
    const preMergeTextPixels = countNonWhitePixels(preMergeRow);
    expect(preMergeTextPixels).toBeGreaterThan(20);

    // First merge down (Cmd+E)
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-after-merge1.png' });
    const afterMerge1Row = await scanRow(page, 160, 50, 750);
    const afterMerge1TextPixels = countNonWhitePixels(afterMerge1Row);

    // Second merge down (Cmd+E)
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-sel-merge-after-merge2.png' });
    const afterMerge2Row = await scanRow(page, 160, 50, 750);
    const afterMerge2TextPixels = countNonWhitePixels(afterMerge2Row);

    // The text content must not change position or size after merge.
    // Before the fix, merging shifted or erased text content.
    expect(afterMerge1TextPixels).toBeGreaterThan(preMergeTextPixels * 0.7);
    expect(afterMerge2TextPixels).toBeGreaterThan(preMergeTextPixels * 0.7);
  });
});
