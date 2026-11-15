import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
  setToolOption,
  getEditorState,
} from './helpers';

/**
 * #850 — a layer mask renders correctly only while its layer is the active
 * layer. Once another layer is selected, the deferred "crop on leave" idle
 * callback shrinks the layer's GPU texture to its content bounds and moves
 * `layer.x/y` off (0, 0). The compositor then samples the document-sized
 * mask texture at the wrong place — shifted by the layer's own (x, y)
 * offset — so the masked-out region reappears once the layer is inactive.
 *
 * Repro (400x300 doc): add a layer, fill a 160x160 red square at
 * (200,100)-(360,260), add a mask, paint two vertical brush strokes to hide
 * the left half of the square in the mask, leave mask-edit mode (still on
 * the same layer — no crop yet), then switch to the Background layer and
 * wait for the idle crop to fire. The left half of the square must stay
 * hidden.
 */

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Fill a rectangular marquee selection via Edit > Fill (GPU-only paint,
 * no JS-side pixel data touched, so no premature auto-crop — matches how
 * a real user paints a fill). */
async function rectFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function verticalMaskStroke(page: Page, x: number, y0: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x, y0);
  const b = await docToScreen(page, x, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/** Composited RGBA at doc (x, y). The GL buffer is bottom-up. */
async function compositeAt(page: Page, docX: number, docY: number): Promise<{ r: number; g: number; b: number; a: number }> {
  const screen = await docToScreen(page, docX, docY);
  const px = await page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const px = Math.round((sx - rect.left) * scale);
    const py = comp.height - 1 - Math.round((sy - rect.top) * scale);
    const i = (py * comp.width + px) * 4;
    return comp.pixels.slice(i, i + 4);
  }, { sx: screen.x, sy: screen.y });
  return { r: px[0]!, g: px[1]!, b: px[2]!, a: px[3]! };
}

function isOpaqueRed(p: { r: number; g: number; b: number; a: number }): boolean {
  return p.a > 200 && p.r > 180 && p.g < 80 && p.b < 80;
}

// The document has an opaque white background layer, so a masked-out
// (hidden) red pixel shows the white background through, not transparency.
function isHiddenToWhite(p: { r: number; g: number; b: number; a: number }): boolean {
  return p.a > 200 && p.r > 220 && p.g > 220 && p.b > 220;
}

test('#850: layer mask stays applied after the layer is cropped on switch-away', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  test.setTimeout(120_000);

  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(200);

  const backgroundId = (await getEditorState(page)).document.activeLayerId;

  const redLayer = await addLayer(page);
  await setActiveLayer(page, redLayer);

  // Fill a 160x160 red square at (200,100)-(360,260).
  await setForegroundColor(page, 255, 0, 0);
  await rectFill(page, 200, 100, 360, 260);

  // Sanity: the square is fully opaque red and the layer has not been
  // cropped yet (still the active layer).
  expect(isOpaqueRed(await compositeAt(page, 230, 180))).toBe(true);
  expect(isOpaqueRed(await compositeAt(page, 330, 180))).toBe(true);
  const stateBefore = await getEditorState(page);
  const redLayerBefore = stateBefore.document.layers.find((l) => l.id === redLayer);
  expect(redLayerBefore?.x).toBe(0);
  expect(redLayerBefore?.y).toBe(0);

  // Add a mask and paint two vertical strokes to hide the left half
  // (x: 200-280) of the square in the mask. Black paints mask value 0
  // (hidden) — reset the foreground color from the red used for the fill.
  await page.locator('[aria-label="Add Mask"]').click();
  await page.getByRole('button', { name: /Edit mask for/ }).click();
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'brush');
  await setToolOption(page, 'Size', 90);
  await verticalMaskStroke(page, 220, 105, 255);
  await verticalMaskStroke(page, 260, 105, 255);

  // Leave mask-edit mode by clicking the layer's own row — still active,
  // so no crop happens yet.
  await page.locator(`[data-layer-id="${redLayer}"]`).click();
  await page.waitForTimeout(100);

  // While still active: left half hidden (shows white background through
  // the masked-out red), right half still red.
  expect(isHiddenToWhite(await compositeAt(page, 230, 180))).toBe(true);
  expect(isOpaqueRed(await compositeAt(page, 330, 180))).toBe(true);

  await page.screenshot({ path: 'e2e/screenshots/mask-crop-offset-850-active.png' });

  // Switch to the Background layer and wait for the idle "crop on leave"
  // to shrink the red layer's texture to its content bounds.
  await page.locator(`[data-layer-id="${backgroundId}"]`).click();

  await expect.poll(async () => {
    const state = await getEditorState(page);
    const layer = state.document.layers.find((l) => l.id === redLayer);
    return (layer?.x ?? 0) > 0 || (layer?.width ?? 400) < 400;
  }, { timeout: 5_000 }).toBe(true);

  const stateAfter = await getEditorState(page);
  const redLayerAfter = stateAfter.document.layers.find((l) => l.id === redLayer);
  expect(stateAfter.document.activeLayerId).not.toBe(redLayer);
  // The layer really did get cropped away from the document origin —
  // otherwise this test would pass trivially without exercising the bug.
  expect(redLayerAfter?.x).toBeGreaterThan(0);
  expect(redLayerAfter?.y).toBeGreaterThan(0);

  await page.screenshot({ path: 'e2e/screenshots/mask-crop-offset-850-cropped.png' });

  // The mask must still hide the left half and show the right half, even
  // though the layer is no longer active and its texture has been cropped.
  const left = await compositeAt(page, 230, 180);
  const right = await compositeAt(page, 330, 180);
  expect(isHiddenToWhite(left)).toBe(true);
  expect(isOpaqueRed(right)).toBe(true);
});
