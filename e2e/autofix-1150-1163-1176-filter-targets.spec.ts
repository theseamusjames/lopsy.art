/**
 * #1176 — Unsharp Mask ignored the active selection and sharpened the
 *         whole layer.
 * #1163 — Brightness/Contrast baked another group's Gradient Map (left over
 *         in the shared adjustments shader) into the filtered layer.
 * #1150 — in mask edit mode, Filter menu commands changed the layer's pixels
 *         instead of its mask.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
  getPixelAt,
  applyFilter,
  addLayer,
  setActiveLayer,
} from './helpers';

interface LayerPixels {
  width: number;
  height: number;
  pixels: number[];
}

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function readLayer(page: Page, layerId: string): Promise<LayerPixels & { x: number; y: number }> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    };
    const px = await w.__readLayerPixels(lid);
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    return { width: px.width, height: px.height, pixels: Array.from(px.pixels), x: layer.x, y: layer.y };
  }, layerId);
}

async function maskByteAt(page: Page, layerId: string, x: number, y: number): Promise<number> {
  return page.evaluate(({ lid, x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number } | null }> } };
    };
    const mask = store.getState().document.layers.find((l) => l.id === lid)!.mask!;
    return mask.data[y * mask.width + x] ?? -1;
  }, { lid: layerId, x, y });
}

async function maskRange(page: Page, layerId: string): Promise<{ min: number; max: number }> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray } | null }> } };
    };
    const data = store.getState().document.layers.find((l) => l.id === lid)!.mask!.data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }, layerId);
}

async function lastHistoryLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label ?? '';
  });
}

async function maskMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { maskMode: string };
    };
    return store.getState().maskMode;
  });
}

/** Composited (on-screen) colour at a document point, at the current viewport. */
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

function expectNear(actual: [number, number, number], expected: [number, number, number], tol = 3): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tol);
}

/** Counts pixels whose RGBA changed, split by whether doc (x, y) is inside `rect`. */
function countChanged(
  before: LayerPixels & { x: number; y: number },
  after: LayerPixels & { x: number; y: number },
  rect: { x0: number; y0: number; x1: number; y1: number },
  margin: number,
): { inside: number; outside: number } {
  let inside = 0;
  let outside = 0;
  for (let ty = 0; ty < after.height; ty++) {
    for (let tx = 0; tx < after.width; tx++) {
      const i = (ty * after.width + tx) * 4;
      let changed = false;
      for (let c = 0; c < 4; c++) {
        if (Math.abs((after.pixels[i + c] ?? 0) - (before.pixels[i + c] ?? 0)) > 1) changed = true;
      }
      if (!changed) continue;
      const dx = tx + after.x;
      const dy = ty + after.y;
      const isInside = dx >= rect.x0 + margin && dx < rect.x1 - margin && dy >= rect.y0 + margin && dy < rect.y1 - margin;
      const isOutside = dx < rect.x0 - margin || dx >= rect.x1 + margin || dy < rect.y0 - margin || dy >= rect.y1 + margin;
      if (isInside) inside++;
      else if (isOutside) outside++;
    }
  }
  return { inside, outside };
}

test.describe('Filter targets: selection, adjustment state, layer mask', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and the layers panel need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('#1176 Unsharp Mask only sharpens inside the selection', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 128, 128, 128);
    await editFill(page);
    await applyFilter(page, 'Add Noise...', { Amount: 40 });

    await dragMarquee(page, 40, 40, 240, 560);
    const before = await readLayer(page, layerId);
    await applyFilter(page, 'Unsharp Mask...', { Radius: 3, Amount: 3 });
    const after = await readLayer(page, layerId);
    await page.screenshot({ path: 'e2e/screenshots/unsharp-mask-selection-1176.png' });

    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // The noisy grey is sharpened (contrast-boosted) inside the marquee; a
    // 4 px margin keeps the antialiased marquee edge out of either bucket.
    const changed = countChanged(before, after, { x0: 40, y0: 40, x1: 240, y1: 560 }, 4);
    expect(changed.inside).toBeGreaterThan(192 * 512 * 0.5);
    expect(changed.outside).toBe(0);
  });

  test('#1163 Brightness/Contrast ignores another group\'s Gradient Map', async ({ page }) => {
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);
    const layer1 = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 128, 128, 128);
    await dragMarquee(page, 0, 0, 300, 400);
    await editFill(page);
    await deselect(page);

    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    const inner = await addLayer(page);
    await setActiveLayer(page, inner);
    await dragMarquee(page, 300, 0, 600, 400);
    await editFill(page);
    await deselect(page);

    await setActiveLayer(page, groupId);
    await page.locator(`[data-layer-id="${groupId}"]`).locator('button[aria-label*="effects"]').click();
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    await page.locator('[aria-label="Add Adjustment"]').click();
    const item = page.getByRole('menuitem', { name: 'Gradient Map', exact: true });
    await item.waitFor({ state: 'visible', timeout: 3000 });
    await item.click();
    const hex = drawer.getByRole('textbox', { name: 'Hex color', exact: true });
    await hex.scrollIntoViewIfNeeded();
    await drawer.getByTestId('gradient-stop-0').click();
    await hex.fill('300000');
    await hex.press('Enter');
    await drawer.getByTestId('gradient-stop-1').click();
    await hex.fill('FFD000');
    await hex.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // The group's right half is tinted by the gradient map; Layer 1 isn't.
    const tinted = await compositeAt(page, 450, 200);
    expect(tinted[0] - tinted[2]).toBeGreaterThan(60);
    expectNear(await compositeAt(page, 150, 200), [128, 128, 128]);

    await setActiveLayer(page, layer1);
    await applyFilter(page, 'Brightness/Contrast...', { Brightness: 10, Contrast: 0 });
    await page.screenshot({ path: 'e2e/screenshots/brightness-contrast-gradient-map-1163.png' });

    // Brightness +10 lifts mid-grey evenly; it stays grey (no gold tint).
    const px = await getPixelAt(page, 150, 200, layer1);
    expect(Math.abs(px.r - px.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(px.g - px.b)).toBeLessThanOrEqual(2);
    expect(px.r).toBeGreaterThan(135);
    expect(px.r).toBeLessThan(170);
    const shown = await compositeAt(page, 150, 200);
    expect(Math.abs(shown[0] - shown[2])).toBeLessThanOrEqual(3);
  });

  test('#1150 Invert and Clouds in mask edit mode write the mask, not the pixels', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    const editMask = page.locator('[aria-label="Edit mask for Layer 1"]');
    await setForegroundColor(page, 255, 0, 0);
    await editFill(page);

    await page.locator('[aria-label="Add Mask"]').click();
    await editMask.click();
    await page.waitForTimeout(100);
    expect(await maskMode(page)).toBe('layerMask');

    await applyFilter(page, 'Invert');
    expect(await lastHistoryLabel(page)).toBe('Invert');
    const px = await getPixelAt(page, 400, 300, layerId);
    expect([px.r, px.g, px.b, px.a]).toEqual([255, 0, 0, 255]);
    await expect.poll(() => maskByteAt(page, layerId, 400, 300)).toBe(0);

    // Out of mask edit mode the inverted (black) mask hides the red layer.
    await row.click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/mask-filter-invert-1150.png' });
    expectNear(await compositeAt(page, 400, 300), [255, 255, 255]);

    // Undo restores the white mask, and the red layer shows again.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expectNear(await compositeAt(page, 400, 300), [255, 0, 0]);
    await expect.poll(() => maskByteAt(page, layerId, 400, 300)).toBe(255);

    // Clouds writes a grey pattern into the mask; the layer stays solid red.
    await editMask.click();
    await page.waitForTimeout(100);
    await applyFilter(page, 'Clouds...', { Scale: 5 });
    expect(await lastHistoryLabel(page)).toBe('Clouds');
    await expect.poll(async () => {
      const r = await maskRange(page, layerId);
      return r.max - r.min;
    }).toBeGreaterThan(60);
    const after = await getPixelAt(page, 123, 456, layerId);
    expect([after.r, after.g, after.b, after.a]).toEqual([255, 0, 0, 255]);
    await row.click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/mask-filter-clouds-1150.png' });
  });

  test('#1150 mask edit mode ends when undo removes the mask', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
    await page.locator('[aria-label="Add Mask"]').click();
    await page.locator('[aria-label="Edit mask for Layer 1"]').click();
    await page.waitForTimeout(100);
    expect(await maskMode(page)).toBe('layerMask');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await expect(page.locator('[aria-label="Edit mask for Layer 1"]')).toHaveCount(0);
    expect(await maskMode(page)).toBe('off');
  });

  test('#1150 Liquify and Tilt-Shift are unavailable in mask edit mode', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
    await page.locator('[aria-label="Add Mask"]').click();
    await page.locator('[aria-label="Edit mask for Layer 1"]').click();
    await page.waitForTimeout(100);

    await page.click('text=Filter');
    await expect(page.getByRole('menuitem', { name: /^Liquify/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: /^Tilt-Shift Blur/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: /^Gaussian Blur/ })).not.toHaveAttribute('aria-disabled', 'true');
  });
});
