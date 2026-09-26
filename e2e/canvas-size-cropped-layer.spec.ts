import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, getEditorState, getPixelAt, drawRect, setActiveLayer } from './helpers';

// #902 — Canvas Size stretched every raster layer that was NOT the active
// layer, because its GPU texture had already been cropped to content
// bounds (the automatic crop-on-deselect behaviour) and resize-canvas.ts
// passed the *document's* old width/height as the "source size" for the
// GPU copy instead of that layer's own, smaller texture size. The GPU op
// then sampled a 60x40 texture as if it were 400x300, stretching it across
// most of the new, larger canvas.

async function openImageMenuItem(page: Page, itemLabel: string): Promise<void> {
  await page.locator('button:has-text("Image")').first().click();
  await page.locator(`[role="menuitem"]:has-text("${itemLabel}")`).click();
  await page.waitForTimeout(200);
}

test('#902: Canvas Size does not stretch a cropped, inactive raster layer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel and menu bar require desktop layout');
  await page.goto('/');
  await waitForStore(page);

  // Opaque 400x300 doc: ships with a "Background" layer and an active
  // "Layer 1" on top of it.
  await createDocument(page, 400, 300, false);

  const initial = await getEditorState(page);
  const layer1 = initial.document.layers.find((l) => l.name === 'Layer 1')!;
  const background = initial.document.layers.find((l) => l.name === 'Background')!;
  expect(initial.document.activeLayerId).toBe(layer1.id);

  // Rect marquee + fill + deselect on the active layer, exactly as the
  // repro describes.
  await drawRect(page, 50, 50, 60, 40, { r: 255, g: 0, b: 0 });

  // Switching the active layer away from Layer 1 schedules an idle-time
  // crop of its texture down to its content bounds (60x40 at (50,50)).
  await setActiveLayer(page, background.id);
  await page.waitForFunction((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; width: number }> } };
    };
    const l = store.getState().document.layers.find((x) => x.id === id);
    return !!l && l.width <= 100;
  }, layer1.id, { timeout: 5000 });

  const cropped = await getEditorState(page);
  const croppedLayer1 = cropped.document.layers.find((l) => l.id === layer1.id)!;
  expect(croppedLayer1.width).toBeLessThanOrEqual(100);
  expect(croppedLayer1.height).toBeLessThanOrEqual(100);

  // Canvas Size to 440x340, anchor center (the modal's default anchor) —
  // a (20, 20) shift for every layer's content.
  await openImageMenuItem(page, 'Canvas Size');
  const dialog = page.getByRole('dialog', { name: 'Canvas Size' });
  await expect(dialog).toBeVisible();
  const widthInput = dialog.locator('input[type="number"]').first();
  const heightInput = dialog.locator('input[type="number"]').nth(1);
  await widthInput.fill('440');
  await heightInput.fill('340');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);

  const resized = await getEditorState(page);
  expect(resized.document.width).toBe(440);
  expect(resized.document.height).toBe(340);

  await page.screenshot({ path: 'e2e/screenshots/canvas-size-cropped-layer.png' });

  // The red rect should have simply shifted by the (20, 20) anchor offset,
  // landing at (70, 70)-(129, 109) — not stretched to fill the new canvas.
  const corners = [
    { x: 70, y: 70 },
    { x: 129, y: 70 },
    { x: 70, y: 109 },
    { x: 129, y: 109 },
    { x: 100, y: 90 },
  ];
  for (const { x, y } of corners) {
    const p = await getPixelAt(page, x, y, layer1.id);
    expect(p.r, `(${x}, ${y}) should be red`).toBeGreaterThan(200);
    expect(p.a, `(${x}, ${y}) should be opaque`).toBeGreaterThan(200);
  }

  // Just outside the shifted rect's bounds, and in the middle/far corner of
  // the new canvas — these must NOT be red. Under the bug, the cropped
  // 60x40 texture was stretched to fill roughly (70,70)-(440,340), so
  // these points came back red.
  const outside = [
    { x: 135, y: 90 },
    { x: 100, y: 115 },
    { x: 200, y: 150 },
    { x: 430, y: 330 },
  ];
  for (const { x, y } of outside) {
    const p = await getPixelAt(page, x, y, layer1.id);
    expect(p.r > 200 && p.a > 200, `(${x}, ${y}) should not be red (got ${JSON.stringify(p)})`).toBe(false);
  }
});
