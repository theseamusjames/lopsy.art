/**
 * Regression test for #1181: Bloom's combine pass divided the added light by
 * the layer's coverage, so on anti-aliased edges it stored straight colour
 * above 1.0 in the FP16 texture. The compositor (live view, export) showed
 * that as an over-white rim, while any 8-bit encode of the layer (project
 * save, readback) clamped it — so the reopened document looked different.
 *
 * The layer's 8-bit pixels composited over the background by hand must match
 * what the engine composites when flattening.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, setForegroundColor, docToScreen, applyFilter, getEditorState } from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
}

interface LayerPixels {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number[];
}

async function readLayer(page: Page, layerId: string): Promise<LayerPixels> {
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    return { x: layer.x, y: layer.y, width: px.width, height: px.height, pixels: px.pixels };
  }, layerId);
}

function channelAt(l: LayerPixels, docX: number, docY: number, c: number): number {
  const lx = docX - l.x;
  const ly = docY - l.y;
  if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) return 0;
  return l.pixels[(ly * l.width + lx) * 4 + c] ?? 0;
}

test('Bloom keeps soft-edge colour within range so the flattened result matches the stored pixels (#1181)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'menus and marquee drags need the desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);
  await page.waitForTimeout(300);

  const initial = await getEditorState(page);
  const layerId = initial.document.activeLayerId;
  const bgId = initial.document.layers.find((l) => l.name === 'Background')!.id;

  await page.locator(`[data-layer-id="${bgId}"]`).click();
  await setForegroundColor(page, 0x7f, 0xd3, 0xff);
  await editFill(page);

  await page.locator(`[data-layer-id="${layerId}"]`).click();
  await setForegroundColor(page, 255, 255, 255);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  await dragMarquee(page, 360, 260, 440, 340);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  await page.click('text=Filter');
  await page.click('text=Bloom...');
  await page.locator('button:has-text("Apply")').click();
  await page.waitForTimeout(300);

  const bloomed = await readLayer(page, layerId);
  const background = await readLayer(page, bgId);

  await page.locator('nav[aria-label="Application menu"]').locator('button:has-text("Layer")').click();
  await page.getByRole('menuitem', { name: 'Flatten Image', exact: true }).click();
  await page.waitForTimeout(300);
  const flatId = (await getEditorState(page)).document.activeLayerId;
  const flat = await readLayer(page, flatId);

  let partialPixels = 0;
  let worst = 0;
  for (let y = 230; y < 370; y++) {
    for (let x = 330; x < 470; x++) {
      const a = channelAt(bloomed, x, y, 3) / 255;
      if (a <= 0.02 || a >= 0.98) continue;
      partialPixels++;
      for (let c = 0; c < 3; c++) {
        const expected = channelAt(bloomed, x, y, c) * a + channelAt(background, x, y, c) * (1 - a);
        worst = Math.max(worst, Math.abs(channelAt(flat, x, y, c) - expected));
      }
    }
  }
  expect(partialPixels).toBeGreaterThan(50);
  // Rounding of the 8-bit readback alone stays within a few levels; the
  // over-white rim put the flattened pixels up to ~40 levels brighter.
  expect(worst).toBeLessThanOrEqual(4);
});
