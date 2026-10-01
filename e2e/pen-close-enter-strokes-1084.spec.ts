import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, setForegroundColor, setToolOption, waitForStore } from './helpers';

// #1084: closing a Pen path on its first anchor committed it to the Paths
// panel, leaving no draft for Enter ("Enter to stroke") to stroke — closed
// shapes could only be stroked through Paths panel → Stroke Path.

async function clickAtDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function pathsState(page: Page): Promise<Array<{ anchorCount: number; closed: boolean }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ anchors: unknown[]; closed: boolean }> };
    };
    return store.getState().paths.map((p) => ({ anchorCount: p.anchors.length, closed: p.closed }));
  });
}

interface LayerRead { width: number; height: number; pixels: number[]; x: number; y: number }

async function readActiveLayer(page: Page): Promise<LayerRead> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await read(doc.activeLayerId);
    return { ...r, x: layer.x, y: layer.y };
  });
}

function pixelAt(l: LayerRead, docX: number, docY: number): [number, number, number, number] {
  const lx = docX - l.x;
  const ly = docY - l.y;
  if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) return [0, 0, 0, 0];
  const i = (ly * l.width + lx) * 4;
  return [l.pixels[i]!, l.pixels[i + 1]!, l.pixels[i + 2]!, l.pixels[i + 3]!];
}

function expectRed(l: LayerRead, x: number, y: number): void {
  const [r, g, b, a] = pixelAt(l, x, y);
  expect(a, `alpha at (${x},${y})`).toBeGreaterThan(200);
  expect(r, `red at (${x},${y})`).toBeGreaterThan(150);
  expect(g, `green at (${x},${y})`).toBeLessThan(60);
  expect(b, `blue at (${x},${y})`).toBeLessThan(60);
}

test.describe('Pen tool: Enter strokes a path closed on its first anchor (#1084)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'pen tool keyboard flow needs a desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('close click adds the closed path, Enter strokes all three sides', async ({ page }) => {
    await addLayer(page);
    await setForegroundColor(page, 200, 0, 0);
    await page.keyboard.press('p');
    await page.waitForTimeout(100);
    await setToolOption(page, 'Stroke', 12);

    const before = await historyLabels(page);
    await clickAtDoc(page, 200, 450);
    await clickAtDoc(page, 400, 150);
    await clickAtDoc(page, 600, 450);
    await clickAtDoc(page, 200, 450);
    await page.waitForTimeout(150);

    // Closing still lands the path in the Paths panel straight away.
    expect(await historyLabels(page)).toEqual([...before, 'Add Path']);
    expect(await pathsState(page)).toEqual([{ anchorCount: 3, closed: true }]);

    await page.locator('body').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    expect(await historyLabels(page)).toEqual([...before, 'Add Path', 'Stroke Path']);
    expect(await pathsState(page)).toEqual([{ anchorCount: 3, closed: true }]);

    await page.screenshot({ path: 'e2e/screenshots/pen-close-enter-strokes-1084.png' });
    const layer = await readActiveLayer(page);
    // Midpoints of the two drawn sides and of the closing side (bottom edge).
    expectRed(layer, 300, 300);
    expectRed(layer, 500, 300);
    expectRed(layer, 400, 450);
    // Options-bar width (12 px): 4 px off the bottom edge is covered, 10 px is not.
    expect(pixelAt(layer, 400, 454)[3]).toBeGreaterThan(200);
    expect(pixelAt(layer, 400, 460)[3]).toBe(0);
    // The stroke is an outline, not a fill.
    expect(pixelAt(layer, 400, 350)[3]).toBe(0);

    // Undo removes the stroke and keeps the closed path.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await readActiveLayer(page);
    expect(pixelAt(undone, 400, 450)[3]).toBe(0);
    expect(await historyLabels(page)).toEqual([...before, 'Add Path']);
    expect(await pathsState(page)).toEqual([{ anchorCount: 3, closed: true }]);
  });
});
