import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  drawRect,
  getEditorState,
} from './helpers';

// Layers panel drag-and-drop through the row grip:
// - #814: a drop in the gap below a group's last child must land where the
//   indicator is drawn — never at the TOP of the group — and a drop back
//   into the layer's own slot must not record history.
// - #824: group rows move as a whole block, and nested groups can be
//   dragged outward to the root.

interface LayerInfo {
  id: string;
  name: string;
  type: string;
  children?: string[];
}

async function layersById(page: Page): Promise<Map<string, LayerInfo>> {
  const state = await getEditorState(page);
  const layers = state.document.layers as unknown as LayerInfo[];
  return new Map(layers.map((l) => [l.id, l]));
}

async function parentOf(page: Page, id: string): Promise<string | null> {
  const map = await layersById(page);
  for (const l of map.values()) {
    if (l.type === 'group' && l.children?.includes(id)) return l.id;
  }
  return null;
}

/** Panel rows top→bottom, as layer ids in DOM order. */
async function panelIds(page: Page): Promise<string[]> {
  return page.locator('[data-layer-id]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-layer-id') ?? ''),
  );
}

async function undoLength(page: Page): Promise<number> {
  return (await getEditorState(page)).undoStackLength;
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

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function newGroup(page: Page): Promise<string> {
  await page.locator('[aria-label="New Group"]').click();
  await page.waitForTimeout(150);
  return activeLayerId(page);
}

async function clickRow(page: Page, id: string): Promise<void> {
  await page.locator(`[data-layer-id="${id}"]`).click();
  await page.waitForTimeout(100);
}

/**
 * Press the grip of `draggedId`, move to `fraction` of the height of the
 * `targetId` row (optionally shifted horizontally), and optionally
 * release. Returns the indicator depth shown just before release.
 */
async function dragRowGrip(
  page: Page,
  draggedId: string,
  targetId: string,
  fraction: number,
  opts: { dx?: number } = {},
): Promise<string | null> {
  const grip = page.locator(`[data-layer-id="${draggedId}"] [aria-label^="Drag to reorder"]`);
  const gripBox = (await grip.boundingBox())!;
  const targetBox = (await page.locator(`[data-layer-id="${targetId}"]`).boundingBox())!;
  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;
  const endY = targetBox.y + targetBox.height * fraction;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + (opts.dx ?? 0), endY, { steps: 8 });
  await page.waitForTimeout(100);
  const indicator = await page.locator('[data-drop-depth]').first().getAttribute('data-drop-depth', { timeout: 200 })
    .catch(() => null);
  await page.mouse.up();
  await page.waitForTimeout(200);
  return indicator;
}

/** Read the composited screen pixel under a document coordinate. */
async function compositeAt(page: Page, docX: number, docY: number): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(async ({ docX, docY }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } };
    };
    const read = w.__readCompositedPixels as () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const s = store.getState();
    const container = document.querySelector('[data-testid="canvas-container"]')!;
    const rect = container.getBoundingClientRect();
    const canvas = container.querySelector('canvas')!;
    const canvasRect = canvas.getBoundingClientRect();
    const sx = rect.left + (docX - s.document.width / 2) * s.viewport.zoom + s.viewport.panX + rect.width / 2;
    const sy = rect.top + (docY - s.document.height / 2) * s.viewport.zoom + s.viewport.panY + rect.height / 2;
    const p = await read();
    if (!p) return { r: -1, g: -1, b: -1 };
    const px = Math.round((sx - canvasRect.left) * (p.width / canvasRect.width));
    const py = Math.round((sy - canvasRect.top) * (p.height / canvasRect.height));
    const i = ((p.height - 1 - py) * p.width + px) * 4;
    return { r: p.pixels[i] ?? 0, g: p.pixels[i + 1] ?? 0, b: p.pixels[i + 2] ?? 0 };
  }, { docX, docY });
}

test.describe('Layers panel drop into a group gap (#814)', () => {
  let root = '';
  let layer1 = '';
  let x = '';
  let g2 = '';
  let b = '';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);

    const ids = await panelIds(page);
    root = ids[0]!;
    const map = await layersById(page);
    layer1 = [...map.values()].find((l) => l.name === 'Layer 1')!.id;

    // Panel: Project, G2, B, X, Layer 1, Background
    await clickRow(page, layer1);
    x = await addLayer(page);
    g2 = await newGroup(page);
    b = await addLayer(page);
    expect(await parentOf(page, b)).toBe(g2);
    expect((await panelIds(page)).slice(0, 5)).toEqual([root, g2, b, x, layer1]);

    // B blue, Layer 1 green over the same area — B is on top, canvas is blue.
    await drawRect(page, 200, 150, 200, 100, { r: 0, g: 0, b: 255 });
    await clickRow(page, layer1);
    await drawRect(page, 200, 150, 200, 100, { r: 0, g: 255, b: 0 });
    const before = await compositeAt(page, 300, 200);
    expect(before.b).toBeGreaterThan(200);
    expect(before.g).toBeLessThan(50);
  });

  test('dropping Layer 1 between B and X lands at root above X, below B', async ({ page }) => {
    const undoBefore = await undoLength(page);

    // Straight vertical drag to the top ~20% of the X row.
    const depth = await dragRowGrip(page, layer1, x, 0.2);
    expect(depth).toBe('1');

    await page.screenshot({ path: 'e2e/screenshots/layer-dnd-814-root-above-x.png' });

    expect(await parentOf(page, layer1)).toBe(root);
    expect(await parentOf(page, b)).toBe(g2);
    expect((await panelIds(page)).slice(0, 5)).toEqual([root, g2, b, layer1, x]);
    // B stays above Layer 1: the overlap is still blue.
    const after = await compositeAt(page, 300, 200);
    expect(after.b).toBeGreaterThan(200);
    expect(after.g).toBeLessThan(50);
    expect(await undoLength(page)).toBe(undoBefore + 1);
    expect(await lastHistoryLabel(page)).toBe('Reorder Layer');
  });

  test('dragging right in the same gap drops at the BOTTOM of G2, not the top', async ({ page }) => {
    const depth = await dragRowGrip(page, layer1, x, 0.2, { dx: 20 });
    expect(depth).toBe('2');

    expect(await parentOf(page, layer1)).toBe(g2);
    expect((await panelIds(page)).slice(0, 5)).toEqual([root, g2, b, layer1, x]);
    // Still below B inside the group — canvas stays blue.
    const after = await compositeAt(page, 300, 200);
    expect(after.b).toBeGreaterThan(200);
    expect(after.g).toBeLessThan(50);
  });

  test('a group child dragged under its last sibling moves to the group bottom', async ({ page }) => {
    // Add C on top of B inside G2: Project, G2, C, B, X, ...
    await clickRow(page, b);
    const c = await addLayer(page);
    expect(await parentOf(page, c)).toBe(g2);
    expect((await panelIds(page)).slice(0, 4)).toEqual([root, g2, c, b]);

    await dragRowGrip(page, c, x, 0.2);
    expect(await parentOf(page, c)).toBe(g2);
    expect((await panelIds(page)).slice(0, 5)).toEqual([root, g2, b, c, x]);
  });

  test('dropping the last child back into its own slot is a no-op without history', async ({ page }) => {
    const undoBefore = await undoLength(page);
    const orderBefore = await panelIds(page);

    const depth = await dragRowGrip(page, b, x, 0.2);
    expect(depth).toBeNull();

    expect(await panelIds(page)).toEqual(orderBefore);
    expect(await parentOf(page, b)).toBe(g2);
    expect(await undoLength(page)).toBe(undoBefore);
  });
});

test.describe('Layers panel group drags (#824)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('dragging a group row onto the top half of a layer moves the whole group', async ({ page }) => {
    const ids = await panelIds(page);
    const root = ids[0]!;
    const map = await layersById(page);
    const layer1 = [...map.values()].find((l) => l.name === 'Layer 1')!.id;

    await clickRow(page, layer1);
    const la = await addLayer(page);
    const lb = await addLayer(page);
    // Select both and group them.
    await clickRow(page, lb);
    await page.locator(`[data-layer-id="${la}"]`).click({ modifiers: ['Shift'] });
    await page.locator('[aria-label="Group Layers"]').click();
    await page.waitForTimeout(150);
    const group = await activeLayerId(page);
    expect(await parentOf(page, la)).toBe(group);
    expect(await parentOf(page, lb)).toBe(group);

    await clickRow(page, layer1);
    const l7 = await addLayer(page);
    const l8 = await addLayer(page);
    expect((await panelIds(page)).slice(0, 7)).toEqual([root, group, lb, la, l8, l7, layer1]);

    await dragRowGrip(page, group, layer1, 0.3);

    await page.screenshot({ path: 'e2e/screenshots/layer-dnd-824-group-block.png' });

    expect((await panelIds(page)).slice(0, 7)).toEqual([root, l8, l7, group, lb, la, layer1]);
    expect(await parentOf(page, la)).toBe(group);
    expect(await parentOf(page, lb)).toBe(group);
    expect(await parentOf(page, group)).toBe(root);
  });

  test('a nested group can be dragged out to the root', async ({ page }) => {
    const ids = await panelIds(page);
    const root = ids[0]!;
    const map = await layersById(page);
    const layer1 = [...map.values()].find((l) => l.name === 'Layer 1')!.id;

    await clickRow(page, layer1);
    const trench = await newGroup(page);
    const type = await newGroup(page);
    expect(await parentOf(page, type)).toBe(trench);
    expect((await panelIds(page)).slice(0, 4)).toEqual([root, trench, type, layer1]);

    // Gap above Trench → root, above Trench.
    const undoBefore = await undoLength(page);
    await dragRowGrip(page, type, trench, 0.2);
    expect(await parentOf(page, type)).toBe(root);
    expect((await panelIds(page)).slice(0, 4)).toEqual([root, type, trench, layer1]);
    expect(await undoLength(page)).toBe(undoBefore + 1);

    // Back into Trench via its centre, then out again below it by
    // dragging down and to the left (root depth).
    await dragRowGrip(page, type, trench, 0.5);
    expect(await parentOf(page, type)).toBe(trench);
    expect((await panelIds(page)).slice(0, 4)).toEqual([root, trench, type, layer1]);

    // A straight drag to the Layer 1 row keeps Type where it already is:
    // nothing moves and nothing is recorded.
    const undoMid = await undoLength(page);
    await dragRowGrip(page, type, layer1, 0.2);
    expect(await parentOf(page, type)).toBe(trench);
    expect(await undoLength(page)).toBe(undoMid);

    await dragRowGrip(page, type, layer1, 0.2, { dx: -20 });
    expect(await parentOf(page, type)).toBe(root);
    expect((await panelIds(page)).slice(0, 4)).toEqual([root, trench, type, layer1]);
    expect(await undoLength(page)).toBe(undoMid + 1);
  });
});
