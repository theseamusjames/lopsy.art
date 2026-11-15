import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, setForegroundColor, setToolOption, waitForStore } from './helpers';

// #976: the Pen options bar says "Enter to stroke", but Enter only saved the
// path to the Paths panel and painted nothing.

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

test.describe('Pen tool Enter strokes the path (#976)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'pen tool keyboard flow needs a desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('Enter rasterizes the in-progress polyline onto the active layer and keeps the path', async ({ page }) => {
    await addLayer(page);
    await setForegroundColor(page, 200, 0, 0);
    await page.keyboard.press('p');
    await page.waitForTimeout(100);
    await setToolOption(page, 'Stroke', 12);

    const before = await historyLabels(page);
    await clickAtDoc(page, 100, 100);
    await clickAtDoc(page, 300, 200);
    await clickAtDoc(page, 500, 120);
    await page.locator('body').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    expect(await historyLabels(page)).toEqual([...before, 'Add Path', 'Stroke Path']);

    // A second Enter neither re-commits nor re-strokes the path (#1084).
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(await historyLabels(page)).toEqual([...before, 'Add Path', 'Stroke Path']);

    const layer = await readActiveLayer(page);
    // Midpoints of both segments sit on the stroke and are red.
    for (const [x, y] of [[200, 150], [400, 160]] as const) {
      const [r, g, b, a] = pixelAt(layer, x, y);
      expect(a, `alpha at (${x},${y})`).toBeGreaterThan(200);
      expect(r).toBeGreaterThan(150);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    }
    // The options-bar width (12 px) is used: 4 px below the first segment's
    // midpoint (~3.6 px perpendicular) is covered, 12 px below (~10.7 px) is not.
    expect(pixelAt(layer, 200, 154)[3]).toBeGreaterThan(200);
    expect(pixelAt(layer, 200, 162)[3]).toBe(0);
    // Well away from the polyline stays empty.
    expect(pixelAt(layer, 300, 400)[3]).toBe(0);
    expect(pixelAt(layer, 100, 500)[3]).toBe(0);

    const pathCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { paths: unknown[] };
      };
      return store.getState().paths.length;
    });
    expect(pathCount).toBe(1);

    // One undo removes the stroke but keeps the committed path.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await readActiveLayer(page);
    expect(pixelAt(undone, 200, 150)[3]).toBe(0);
    expect(await historyLabels(page)).toEqual([...before, 'Add Path']);
  });
});
