import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  drawRect,
  setActiveLayer,
  undo,
  redo,
} from './helpers';

// #910 — Move a path-bound text layer, Undo, Redo: the redo left the text at
// its pre-move (path-anchored) position. undoBy/redoBy reset the engine's
// tracked sync state, which dropped the path-text render cache, so the next
// frame re-rendered the text from the path geometry and wrote the
// path-derived x/y back over the snapshot's moved position. Undo only looked
// right because its target position IS the path-anchored one.

const DOC_W = 1000;
const DOC_H = 1400;
const CIRCLE = { cx: 500, cy: 700, r: 200 };
const MOVE = { dx: 120, dy: 80 };

interface LayerInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  pathId?: string;
}

async function getLayers(page: Page): Promise<LayerInfo[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: LayerInfo[] } };
    };
    return store.getState().document.layers.map((l) => ({
      id: l.id, type: l.type, x: l.x, y: l.y, pathId: l.pathId,
    }));
  });
}

async function getLayer(page: Page, id: string): Promise<LayerInfo> {
  const layer = (await getLayers(page)).find((l) => l.id === id);
  expect(layer, `layer ${id} should exist`).toBeTruthy();
  return layer!;
}

async function getActiveLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function getPathIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ id: string }> };
    };
    return store.getState().paths.map((p) => p.id);
  });
}

/** Capture the composited WebGL canvas in-page under `key` for later diffing. */
async function captureComposite(page: Page, key: string): Promise<void> {
  await page.evaluate(async (k) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const shots = (w.__e2eComposites ??= {}) as Record<string, number[]>;
    shots[k] = (await read()).pixels;
  }, key);
}

/** Number of pixels whose RGBA differs by more than 16 in any channel. */
async function compositeDiff(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(({ a, b }) => {
    const shots = (window as unknown as Record<string, unknown>).__e2eComposites as
      Record<string, number[]>;
    const pa = shots[a]!;
    const pb = shots[b]!;
    let diff = 0;
    for (let i = 0; i < pa.length; i += 4) {
      for (let c = 0; c < 4; c++) {
        if (Math.abs((pa[i + c] ?? 0) - (pb[i + c] ?? 0)) > 16) {
          diff++;
          break;
        }
      }
    }
    return diff;
  }, { a, b });
}

async function drawCirclePath(page: Page): Promise<string> {
  await page.keyboard.press('u');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
  await page.locator('[aria-labelledby="shape-output-label"]').selectOption('path');
  // The shape tool drags out from the centre.
  const start = await docToScreen(page, CIRCLE.cx, CIRCLE.cy);
  const end = await docToScreen(page, CIRCLE.cx + CIRCLE.r, CIRCLE.cy + CIRCLE.r);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const ids = await getPathIds(page);
  expect(ids, 'the ellipse should have produced one path').toHaveLength(1);
  return ids[0]!;
}

/** Type a text layer with the Text tool, commit it, and bind it to `pathId`. */
async function createPathText(page: Page, pathId: string): Promise<string> {
  await page.keyboard.press('t');
  const at = await docToScreen(page, 100, 100);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(100);
  await page.keyboard.type('AROUND THE CIRCLE WE GO');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);

  const textLayer = (await getLayers(page)).find((l) => l.type === 'text');
  expect(textLayer, 'the text should have committed as a text layer').toBeTruthy();

  await page.locator('[aria-label="Text path"]').selectOption(pathId);
  await page.screenshot({ path: 'e2e/screenshots/text-on-path-move-redo-bound.png' });
  // The render loop lays the glyphs out along the path on its next frame and
  // re-anchors the layer's x/y to the rendered bounds — wait for that to land.
  await expect
    .poll(async () => {
      const l = await getLayer(page, textLayer!.id);
      return l.pathId === pathId && (l.x !== textLayer!.x || l.y !== textLayer!.y);
    }, { timeout: 15000 })
    .toBe(true);
  await page.waitForTimeout(300);
  return textLayer!.id;
}

/** Drag the active layer with the Move tool by (dx, dy) document pixels. */
async function dragActiveLayer(page: Page, dx: number, dy: number): Promise<void> {
  await page.keyboard.press('v');
  const zoom = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number } };
    };
    return store.getState().viewport.zoom;
  });
  const start = await docToScreen(page, CIRCLE.cx, CIRCLE.cy);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx * zoom, start.y + dy * zoom, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function settle(page: Page): Promise<void> {
  // A few frames so the render loop's path-text sync runs after a restore.
  await page.waitForTimeout(400);
}

test.describe('#910 — redo re-applies a Move on a path-bound text layer', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options bar and layers panel require desktop viewport');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForTimeout(300);
  });

  test('standalone path text: Move → Undo → Redo lands on the moved position', async ({ page }) => {
    const pathId = await drawCirclePath(page);
    const textId = await createPathText(page, pathId);
    const anchored = await getLayer(page, textId);
    await captureComposite(page, 'anchored');

    await dragActiveLayer(page, MOVE.dx, MOVE.dy);
    const moved = await getLayer(page, textId);
    expect(moved.x - anchored.x).toBeCloseTo(MOVE.dx, -1);
    expect(moved.y - anchored.y).toBeCloseTo(MOVE.dy, -1);
    await captureComposite(page, 'moved');
    await page.screenshot({ path: 'e2e/screenshots/text-on-path-move-redo-moved.png' });
    // Sanity: the move visibly changed the composite, so the diff below can fail.
    expect(await compositeDiff(page, 'anchored', 'moved')).toBeGreaterThan(200);

    await undo(page);
    await settle(page);
    const undone = await getLayer(page, textId);
    expect(undone.x).toBe(anchored.x);
    expect(undone.y).toBe(anchored.y);

    await redo(page);
    await settle(page);
    await page.screenshot({ path: 'e2e/screenshots/text-on-path-move-redo-redone.png' });

    const redone = await getLayer(page, textId);
    expect(redone.pathId).toBe(pathId);
    expect(redone.x, 'redo must restore the moved x, not re-anchor to the path').toBe(moved.x);
    expect(redone.y, 'redo must restore the moved y, not re-anchor to the path').toBe(moved.y);

    // What's on screen matches the post-move frame, glyph for glyph (the
    // pre-fix redo drew the text back at its anchored spot).
    await captureComposite(page, 'redone');
    expect(await compositeDiff(page, 'moved', 'redone')).toBeLessThan(20);
  });

  test('group with raster sibling: Move → Undo → Redo keeps path text in sync', async ({ page }) => {
    // Raster sibling first, on the default layer.
    const rasterId = await getActiveLayerId(page);
    await drawRect(page, 80, 80, 120, 90, { r: 255, g: 0, b: 0 });
    const pathId = await drawCirclePath(page);
    const textId = await createPathText(page, pathId);

    await setActiveLayer(page, textId);
    await page
      .locator(`[data-layer-id="${rasterId}"] span[class*="name"]`)
      .first()
      .click({ modifiers: ['Meta'] });
    await page.waitForTimeout(100);
    await page.locator('[aria-label="Group Layers"]').click();
    await page.waitForTimeout(300);

    const groupId = await getActiveLayerId(page);
    const group = await getLayer(page, groupId);
    expect(group.type).toBe('group');

    const rasterBefore = await getLayer(page, rasterId);
    const textBefore = await getLayer(page, textId);

    await dragActiveLayer(page, MOVE.dx, MOVE.dy);
    const rasterMoved = await getLayer(page, rasterId);
    const textMoved = await getLayer(page, textId);
    expect(rasterMoved.x - rasterBefore.x).toBeCloseTo(MOVE.dx, -1);
    expect(rasterMoved.y - rasterBefore.y).toBeCloseTo(MOVE.dy, -1);
    expect(textMoved.x - textBefore.x).toBe(rasterMoved.x - rasterBefore.x);
    expect(textMoved.y - textBefore.y).toBe(rasterMoved.y - rasterBefore.y);
    await captureComposite(page, 'group-moved');

    await undo(page);
    await settle(page);
    expect((await getLayer(page, rasterId)).x).toBe(rasterBefore.x);
    expect((await getLayer(page, textId)).x).toBe(textBefore.x);
    expect((await getLayer(page, textId)).y).toBe(textBefore.y);

    await redo(page);
    await settle(page);
    await page.screenshot({ path: 'e2e/screenshots/text-on-path-move-redo-group.png' });

    const rasterRedone = await getLayer(page, rasterId);
    const textRedone = await getLayer(page, textId);
    expect(rasterRedone.x).toBe(rasterMoved.x);
    expect(rasterRedone.y).toBe(rasterMoved.y);
    expect(textRedone.x, 'path text must move back with its group on redo').toBe(textMoved.x);
    expect(textRedone.y, 'path text must move back with its group on redo').toBe(textMoved.y);

    await captureComposite(page, 'group-redone');
    expect(await compositeDiff(page, 'group-moved', 'group-redone')).toBeLessThan(20);
  });
});
