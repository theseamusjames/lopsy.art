import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, setForegroundColor, setToolOption, waitForStore } from './helpers';

// #1292: Pen + Enter (and Stroke Path) read the whole layer back, stroked it
// on the CPU into a full-canvas buffer and uploaded it twice. The stroke is
// now rasterized over its own bounding box only and composited onto the
// layer texture on the GPU. These checks pin the visible result: the stroke
// lands where the path is, the layer's existing pixels survive, and undo /
// redo restore both.

async function clickAtDoc(page: Page, x: number, y: number): Promise<void> {
  const p = await docToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
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

/** Fill a marquee rect with the foreground colour via Edit → Fill, then deselect. */
async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

test.describe('Pen + Enter strokes on the GPU (#1292)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'pen tool keyboard flow needs a desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('strokes onto a layer with content, keeps its pixels and undoes cleanly', async ({ page }) => {
    await addLayer(page);
    await setForegroundColor(page, 0, 0, 220);
    await fillRect(page, 600, 400, 700, 500);
    await page.keyboard.press('p');
    await page.waitForTimeout(200);

    await setForegroundColor(page, 200, 0, 0);
    await setToolOption(page, 'Stroke', 10);
    await clickAtDoc(page, 100, 100);
    await clickAtDoc(page, 400, 100);
    await clickAtDoc(page, 400, 300);
    await page.locator('body').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/pen-stroke-gpu-patch.png' });

    const stroked = await readActiveLayer(page);
    // On the stroke (both segments' midpoints): solid red. The path raster
    // is in the canvas colour space, so on a Display P3 canvas #C80000
    // reads as roughly (186, 38, 23).
    for (const [x, y] of [[250, 100], [400, 200]] as const) {
      const [r, g, b, a] = pixelAt(stroked, x, y);
      expect(a, `alpha at (${x},${y})`).toBeGreaterThan(240);
      expect(r).toBeGreaterThan(160);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    }
    // Beside the stroke (half-width is 5 px): untouched.
    expect(pixelAt(stroked, 250, 110)[3]).toBe(0);
    expect(pixelAt(stroked, 250, 90)[3]).toBe(0);
    // The blue square the layer already held survives.
    const [, , blue, blueA] = pixelAt(stroked, 650, 450);
    expect(blueA).toBe(255);
    expect(blue).toBeGreaterThan(200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await readActiveLayer(page);
    expect(pixelAt(undone, 250, 100)[3]).toBe(0);
    expect(pixelAt(undone, 650, 450)[3]).toBe(255);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    const redone = await readActiveLayer(page);
    expect(pixelAt(redone, 250, 100)[3]).toBeGreaterThan(240);
    expect(pixelAt(redone, 650, 450)[3]).toBe(255);
  });
});
