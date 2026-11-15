/**
 * Regression test for #964: ⌘C on one layer, then clicking the row of a layer
 * that was cropped when it was left, wiped that layer — its texture expanded
 * to the full document but every pixel came back transparent.
 *
 * Root cause: `clipboard_copy` leaves its `u_maskTex` sampler on texture unit
 * 1, bound to the selection mask. Re-activating the cropped layer expands it
 * with the same shader, which never reset that sampler. Once ⌘D released the
 * doc-sized selection mask, the texture pool handed that same texture back as
 * the doc-sized expand target — a framebuffer/sampler feedback loop, so WebGL
 * dropped the draw and the layer was replaced with an empty texture.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setForegroundColor,
  docToScreen,
  addLayer,
  setActiveLayer,
} from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
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

async function layerContent(page: Page, layerId: string): Promise<{ width: number; height: number; opaque: number }> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    let opaque = 0;
    for (let i = 3; i < px.pixels.length; i += 4) {
      if ((px.pixels[i] ?? 0) > 127) opaque++;
    }
    return { width: px.width, height: px.height, opaque };
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

test('clicking a cropped layer right after ⌘C on another layer keeps its pixels', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires the desktop sidebar');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, true);
  await page.waitForTimeout(300);
  await setForegroundColor(page, 0, 0, 0);

  const layer1Id = await activeLayerId(page);

  // 1. Layer 1: filled block at (100,100)-(300,200).
  await dragMarquee(page, 100, 100, 300, 200);
  await editFill(page);
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // 2. A second layer with a 100x100 square at (400,300).
  await addLayer(page);
  const squareId = await activeLayerId(page);
  await dragMarquee(page, 400, 300, 500, 400);
  await editFill(page);
  await page.keyboard.press(`${mod}+KeyD`);
  await page.waitForTimeout(100);

  // 3. Leave it so it gets cropped to its content.
  await addLayer(page);
  await expect.poll(async () => (await layerContent(page, squareId)).width, { timeout: 5000 }).toBe(100);
  const before = await layerContent(page, squareId);
  expect(before.opaque).toBe(10_000);

  // 4. Copy from Layer 1.
  await setActiveLayer(page, layer1Id);
  await dragMarquee(page, 90, 90, 310, 210);
  await page.keyboard.press(`${mod}+KeyC`);
  await page.waitForTimeout(200);

  // 5. Click the square's row. It expands for editing but must keep its pixels.
  await setActiveLayer(page, squareId);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/copy-then-select-cropped-layer.png' });

  const after = await layerContent(page, squareId);
  expect(after.opaque).toBe(10_000);
});
