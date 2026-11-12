import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, setForegroundColor, setToolOption, waitForStore } from './helpers';

// #1593: on a Display P3 session the path stroke raster is drawn on a P3 2D
// context, and a CSS rgba() stroke style is sRGB, so the browser converted
// the foreground into P3 — #C80000 landed as roughly (186, 38, 23). The
// stroke must write the foreground's channel values unchanged, exactly as
// Edit → Fill (a GPU write) does.

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

test.describe('Stroke Path keeps the foreground colour on Display P3 (#1593)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'pen tool keyboard flow needs a desktop keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('Pen + Enter writes the same channel values as Edit → Fill', async ({ page }) => {
    // The bug only exists on a wide-gamut session; headless Chromium is one.
    const isP3 = await page.getByText('Display P3', { exact: true }).isVisible();
    test.skip(!isP3, 'session canvas colour space is sRGB');

    await addLayer(page);
    await setForegroundColor(page, 200, 0, 0);
    await fillRect(page, 600, 400, 700, 500);

    await page.keyboard.press('p');
    await page.waitForTimeout(200);
    await setToolOption(page, 'Stroke', 10);
    await clickAtDoc(page, 100, 100);
    await clickAtDoc(page, 400, 100);
    await page.locator('body').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/stroke-path-p3-color.png' });

    const layer = await readActiveLayer(page);
    const [fr, fg, fb, fa] = pixelAt(layer, 650, 450);
    expect(fa).toBe(255);
    expect([fr, fg, fb]).toEqual([200, 0, 0]);

    // Centre of the 10 px stroke: fully covered, so no edge blending.
    for (const x of [200, 250, 300]) {
      const [r, g, b, a] = pixelAt(layer, x, 100);
      expect(a, `alpha at (${x},100)`).toBe(255);
      expect(Math.abs(r - fr), `red at (${x},100)`).toBeLessThanOrEqual(1);
      expect(g, `green at (${x},100)`).toBeLessThanOrEqual(1);
      expect(b, `blue at (${x},100)`).toBeLessThanOrEqual(1);
    }
  });
});
