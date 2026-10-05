/**
 * #1200: with the Move tool, a small point-text label (13px) could barely
 * be dragged. At the ~69% fit zoom of a 1600x1200 document the top and
 * bottom edge scale handles covered all but ~5 doc px of its 18px line box,
 * so pressing on the capitals and dragging stretched the text ("Transform")
 * instead of moving it. Handles on a small box are now grabbed from just
 * outside its outline; most of the interior is a move zone.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';

interface TextSnapshot {
  x: number;
  y: number;
  transform: { a: number; b: number; c: number; d: number } | null;
}

async function textLayer(page: Page): Promise<TextSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ type: string; x: number; y: number; transform?: TextSnapshot['transform'] }> } };
    };
    const l = store.getState().document.layers.find((layer) => layer.type === 'text')!;
    return { x: l.x, y: l.y, transform: l.transform ?? null };
  });
}

async function lastHistoryLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label ?? null;
  });
}

async function hoveredHandle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTransformHandle: string | null };
    };
    return ui.getState().activeTransformHandle;
  });
}

/** Horizontal centre (doc px) of the text layer's opaque pixels — under its top and bottom edge handles. */
async function inkCentreX(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; x: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.type === 'text')!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layer.id);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 128) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    return layer.x + (minX + maxX) / 2;
  });
}

async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number } };
    };
    return store.getState().viewport.zoom;
  });
}

const TEXT_X = 600;
const TEXT_Y = 500;
const LINE_BOX_H = 13 * 1.4;

test.describe('Move tool on small point text (#1200)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'options bar needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1600, 1200, false);
    await page.waitForTimeout(300);

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 13);
    const at = await docToScreen(page, TEXT_X, TEXT_Y);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('PALETTE');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await selectTool(page, 'move');
  });

  test('most of the line box shows the move cursor, not a scale handle', async ({ page }) => {
    // Fit zoom: 8 screen px is more than half the 18px line box.
    expect(8 / (await zoom(page))).toBeGreaterThan(LINE_BOX_H / 2);

    // Probe whole screen rows from above the label to below it. Firefox
    // truncates fractional mouse coordinates (the click that placed the
    // label too), so doc-space steps would hover different points per
    // browser.
    const cx = await inkCentreX(page);
    const from = await docToScreen(page, cx, TEXT_Y - 6);
    const to = await docToScreen(page, cx, TEXT_Y + LINE_BOX_H + 6);
    const x = Math.round(from.x);
    let rows = '';
    for (let y = Math.ceil(from.y); y <= Math.floor(to.y); y++) {
      await page.mouse.move(x, y);
      const handle = await hoveredHandle(page);
      rows += handle === null ? 'm' : handle === 'top' ? 't' : handle === 'bottom' ? 'b' : '?';
    }
    // The edge handles are still there, just outside the outline, with one
    // move zone between them.
    expect(rows).toMatch(/^t+m+b+$/);
    // Inside bands of a quarter of the half-height leave 75% of the line
    // box to move; before #1200 the edge handles left about a quarter.
    const moveRows = rows.split('m').length - 1;
    expect(moveRows).toBeGreaterThanOrEqual(0.55 * LINE_BOX_H * (await zoom(page)));
  });

  test('pressing on the upper half of the capitals moves the label', async ({ page }) => {
    const before = await textLayer(page);
    expect(before.transform).toBeNull();

    // 5 doc px below the top of the line box, under the top edge handle.
    const start = await docToScreen(page, await inkCentreX(page), TEXT_Y + 5);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/move-small-text-1200.png' });

    const after = await textLayer(page);
    const t = after.transform;
    // Not stretched: no transform, or an identity one.
    if (t) {
      expect(t.a).toBeCloseTo(1, 3);
      expect(t.d).toBeCloseTo(1, 3);
      expect(t.b).toBeCloseTo(0, 3);
      expect(t.c).toBeCloseTo(0, 3);
    }
    expect(await lastHistoryLabel(page)).toBe('Move');
    // 40 screen px is well over 40 doc px below 100% zoom, up and to the right.
    expect(after.x - before.x).toBeGreaterThan(40);
    expect(before.y - after.y).toBeGreaterThan(40);
  });
});
