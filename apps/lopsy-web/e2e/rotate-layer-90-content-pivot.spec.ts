/**
 * Regression test for #969: the Move tool's Rotate 90° buttons (no
 * selection) pivoted on the layer's texture bounds. An expanded layer's
 * texture is the whole canvas, so small art swung around the canvas centre
 * and off the canvas, and because crop/expand on a layer switch moves the
 * texture bounds, CW → switch layers → CCW didn't come back to the start.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setForegroundColor, docToScreen, setActiveLayer } from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

interface Box { x: number; y: number; width: number; height: number; opaque: number }

/** Opaque-content bounds of a layer in document space. */
async function contentBox(page: Page, layerId: string): Promise<Box> {
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, opaque = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 127) {
          opaque++;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    return { x: layer.x + minX, y: layer.y + minY, width: maxX - minX + 1, height: maxY - minY + 1, opaque };
  }, layerId);
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function backgroundId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    return store.getState().document.layers.find((l) => l.name === 'Background')!.id;
  });
}

test('Rotate 90° turns layer content in place and CW → switch → CCW round-trips', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Move options bar needs the desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);
  await page.waitForTimeout(300);

  await page.locator('[aria-label="Add Layer"]').click();
  const layerId = await activeLayerId(page);

  await setForegroundColor(page, 200, 30, 30);
  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, 50, 50);
  const b = await docToScreen(page, 250, 150);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(150);

  const start = await contentBox(page, layerId);
  expect(start.width).toBeGreaterThan(190);
  expect(start.height).toBeGreaterThan(90);
  const centreX = start.x + start.width / 2;
  const centreY = start.y + start.height / 2;

  await selectTool(page, 'move');
  await page.getByRole('button', { name: 'Rotate 90° CW' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/screenshots/rotate-layer-90-cw.png' });

  const cw = await contentBox(page, layerId);
  expect(cw.opaque).toBe(start.opaque);
  expect(cw.width).toBe(start.height);
  expect(cw.height).toBe(start.width);
  // Turned about its own centre, not the canvas centre (the bug put it at x 550, y −50).
  expect(Math.abs(cw.x + cw.width / 2 - centreX)).toBeLessThanOrEqual(1);
  expect(Math.abs(cw.y + cw.height / 2 - centreY)).toBeLessThanOrEqual(1);
  // The content spans the full canvas height after the turn, so its top edge
  // sits at y ≈ 0. Firefox's marquee comes out 1px taller and shifted up, which
  // puts the pivoted top edge at y = −1; allow the same ±1px the centre checks
  // use. The #969 bug put it at y ≈ −50, which this still catches decisively.
  expect(cw.y).toBeGreaterThanOrEqual(-1);

  // Switch away and back so the texture crops and re-expands.
  await setActiveLayer(page, await backgroundId(page));
  await page.waitForTimeout(700);
  await setActiveLayer(page, layerId);
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Rotate 90° CCW' }).click();
  await page.waitForTimeout(200);

  const back = await contentBox(page, layerId);
  expect(back).toEqual(start);
});
