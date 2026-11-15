import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForStore,
  createDocument,
  getEditorState,
  selectTool,
  setForegroundColor,
  docToScreen,
  applyFilter,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  count: number;
}

async function dragSelection(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(200);
}

/** Doc-space bounding box of opaque dark pixels on a layer's GPU texture. */
async function darkBBox(page: Page, layerId: string): Promise<BBox> {
  return page.evaluate(async (lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await readFn(lid);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if ((pixels[i + 3] ?? 0) < 128 || (pixels[i] ?? 255) > 128) continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      minX: minX + lx,
      minY: minY + ly,
      maxX: maxX + lx,
      maxY: maxY + ly,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      count,
    };
  }, layerId);
}

test.describe('Lens Distortion on a non-square layer (#946)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('a centred circle stays circular on a 1600x400 layer', async ({ page }) => {
    await createDocument(page, 1600, 400, false);
    const state = await getEditorState(page);
    const layer1 = state.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');
    expect(state.document.activeLayerId).toBe(layer1.id);

    // 300x300 circle centred on the document: elliptical marquee + Edit > Fill.
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'marquee-ellipse');
    await dragSelection(page, 650, 50, 950, 350);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    const before = await darkBBox(page, layer1.id);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'lens-distortion-aspect-before.png') });

    // Fixture sanity: a ~300px circle centred at (800, 200).
    expect(Math.abs(before.width - 300)).toBeLessThanOrEqual(4);
    expect(Math.abs(before.height - 300)).toBeLessThanOrEqual(4);
    expect(Math.abs(before.width - before.height)).toBeLessThanOrEqual(2);

    await applyFilter(page, 'Lens Distortion...', {
      Strength: 50,
      Zoom: 100,
      'Chromatic Fringing': 0,
    });
    await page.waitForTimeout(400);

    const after = await darkBBox(page, layer1.id);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'lens-distortion-aspect-after.png') });

    // The filter ran: barrel distortion pulls the circle inward, so both
    // axes shrink a little. It stays centred on (800, 200).
    expect(after.count).toBeGreaterThan(0);
    expect(after.count).toBeLessThan(before.count);
    expect(after.width).toBeLessThan(before.width);
    expect(after.height).toBeLessThan(before.height);
    expect(Math.abs((after.minX + after.maxX) / 2 - 800)).toBeLessThanOrEqual(2);
    expect(Math.abs((after.minY + after.maxY) / 2 - 200)).toBeLessThanOrEqual(2);

    // #946: the radius was measured in UV units, so on a 4:1 layer the
    // vertical axis was distorted 4x harder and the circle came out as a
    // ~298x270 ellipse. Measured in pixels, both axes shrink equally.
    expect(Math.abs(after.width - after.height)).toBeLessThanOrEqual(4);
  });
});
