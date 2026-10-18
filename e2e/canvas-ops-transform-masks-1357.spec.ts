import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, setForegroundColor } from './helpers';

// #1357 — Image Size, Canvas Size, Crop and Rotate Image left layer masks
// at their old size and position, so a masked layer came back wrongly
// hidden or unmasked. Each case builds an 800 × 600 page with a full red
// layer whose mask hides its left half, runs the operation from the menu,
// and probes the composite where the mask must have gone.

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function compositeAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as [number, number, number];
  }, { x, y });
}

async function fitView(page: Page): Promise<void> {
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(200);
}

async function expectRed(page: Page, x: number, y: number): Promise<void> {
  const [r, g, b] = await compositeAt(page, x, y);
  expect({ at: [x, y], r: r > 200, g: g < 60, b: b < 60 }).toEqual({ at: [x, y], r: true, g: true, b: true });
}

async function expectWhite(page: Page, x: number, y: number): Promise<void> {
  const [r, g, b] = await compositeAt(page, x, y);
  expect({ at: [x, y], rgb: [r > 230, g > 230, b > 230] }).toEqual({ at: [x, y], rgb: [true, true, true] });
}

/** Full red layer named "Layer 1" whose mask hides x 0–400 of the 800 × 600 page. */
async function buildHalfMaskedLayer(page: Page): Promise<void> {
  await fitView(page);
  await setForegroundColor(page, 255, 0, 0);
  await menu(page, 'Select', /^All/);
  await menu(page, 'Edit', /^Fill$/);
  await page.keyboard.press('Control+d');
  await page.locator('[aria-label="Add Mask"]').click();
  await page.locator('[aria-label="Edit mask for Layer 1"]').click();
  await setForegroundColor(page, 0, 0, 0);
  await page.keyboard.press('m');
  await dragOnCanvas(page, 0, 0, 400, 600);
  await menu(page, 'Edit', /^Fill$/);
  await page.keyboard.press('Control+d');
  // Leave mask editing so the composite shows the masked layer, not the overlay.
  await page.getByText('Layer 1', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/screenshots/mask-half-1357-before.png' });
  await expectWhite(page, 80, 300);
  await expectWhite(page, 320, 300);
  await expectRed(page, 480, 300);
  await expectRed(page, 720, 300);
}

async function sizeDialog(page: Page, item: string, width: number, height?: number): Promise<void> {
  await menu(page, 'Image', new RegExp(`^${item}`));
  const dialog = page.getByRole('dialog', { name: item });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="number"]').first().fill(String(width));
  if (height !== undefined) await dialog.locator('input[type="number"]').nth(1).fill(String(height));
  return dialog.getByRole('button', { name: 'Apply' }).click();
}

test.describe('canvas operations carry layer masks (#1357)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await buildHalfMaskedLayer(page);
  });

  test('Image Size scales the mask with the layer, and undo restores it', async ({ page }) => {
    await sizeDialog(page, 'Image Size', 400);
    await page.waitForTimeout(300);
    await fitView(page);
    await page.screenshot({ path: 'e2e/screenshots/mask-image-size-1357.png' });
    await expectWhite(page, 40, 150);
    await expectWhite(page, 160, 150);
    await expectRed(page, 240, 150);
    await expectRed(page, 360, 150);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await fitView(page);
    await expectWhite(page, 320, 300);
    await expectRed(page, 480, 300);
  });

  test('Canvas Size moves the mask with the anchor offset', async ({ page }) => {
    // Grow to 1000 wide with the default centre anchor: content shifts 100 px right.
    await sizeDialog(page, 'Canvas Size', 1000, 600);
    await page.waitForTimeout(300);
    await fitView(page);
    await page.screenshot({ path: 'e2e/screenshots/mask-canvas-size-1357.png' });
    // Old mask x 0–400 now covers x 100–500; red runs x 500–900.
    await expectWhite(page, 450, 300);
    await expectRed(page, 550, 300);
    await expectRed(page, 850, 300);
  });

  test('Crop to a selection crops the mask with it', async ({ page }) => {
    await page.keyboard.press('m');
    await dragOnCanvas(page, 200, 100, 600, 500);
    await menu(page, 'Edit', /^Crop$/);
    await page.waitForTimeout(300);
    await fitView(page);
    await page.screenshot({ path: 'e2e/screenshots/mask-crop-1357.png' });
    // Old x 200–400 (hidden) is new x 0–200; old x 400–600 (red) is new x 200–400.
    await expectWhite(page, 100, 200);
    await expectRed(page, 300, 200);
  });

  test('Rotate Image 90° CW turns the mask with the canvas', async ({ page }) => {
    await menu(page, 'Image', /^Rotate 90° CW/);
    await page.waitForTimeout(300);
    await fitView(page);
    await page.screenshot({ path: 'e2e/screenshots/mask-rotate-cw-1357.png' });
    // CW sends (x, y) → (600 − y, x): the hidden left half becomes the top half.
    await expectWhite(page, 300, 200);
    await expectRed(page, 300, 600);
  });

  test('Flip Horizontal mirrors the mask with the layer', async ({ page }) => {
    await menu(page, 'Image', /^Flip Horizontal/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/mask-flip-h-1357.png' });
    // The full-page layer mirrors about the page centre, so the hidden half moves right.
    await expectRed(page, 200, 300);
    await expectWhite(page, 600, 300);
  });
});
