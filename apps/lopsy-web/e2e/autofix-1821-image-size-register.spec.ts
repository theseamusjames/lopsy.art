// #1821 — Image → Image Size rounded each raster layer's box on its own and
// stretched the texture to the rounded size, so a layer cropped to its
// content got its own effective scale (round(h * s) / h) and two layers in
// register before the resize could end up half a pixel apart.
//
// The repro from the issue: a 99-row rect on one layer, and a copy of it
// whose box is the whole canvas (a dot in two opposite corners). Halving the
// document must leave both layers' pixels identical in document space.

import { test, expect, type Page } from '@playwright/test';
import { createDocument, drawRect, getEditorState, waitForStore } from './helpers';

interface LayerPixels { x: number; y: number; width: number; height: number; pixels: number[] }

async function readLayerInDocSpace(page: Page, layerId: string): Promise<LayerPixels> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await read(id);
    return { x: layer.x, y: layer.y, width: result?.width ?? 0, height: result?.height ?? 0, pixels: result?.pixels ?? [] };
  }, layerId);
}

function pixelAt(layer: LayerPixels, x: number, y: number): [number, number, number, number] {
  const lx = x - layer.x;
  const ly = y - layer.y;
  if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return [0, 0, 0, 0];
  const i = (ly * layer.width + lx) * 4;
  return [layer.pixels[i]!, layer.pixels[i + 1]!, layer.pixels[i + 2]!, layer.pixels[i + 3]!];
}

async function openImageSize(page: Page): Promise<void> {
  await page.locator('button:has-text("Image")').first().click();
  await page.locator('[role="menuitem"]:has-text("Image Size")').click();
}

test.describe('#1821 — Image Size keeps layers in register', () => {
  test('a cropped layer and a full-canvas copy of it still match pixel for pixel after halving', async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar requires desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);

    await page.locator('[aria-label="Add Layer"]').click();
    await drawRect(page, 100, 101, 200, 99, { r: 255, g: 128, b: 0 });

    await page.locator('[aria-label="Duplicate Layer"]').click();
    await page.waitForTimeout(150);
    await drawRect(page, 0, 0, 2, 2, { r: 255, g: 128, b: 0 });
    await drawRect(page, 398, 298, 2, 2, { r: 255, g: 128, b: 0 });

    const before = await getEditorState(page);
    const rasters = before.document.layers.filter((l) => l.type === 'raster');
    const copyId = before.document.activeLayerId;
    const original = rasters.find((l) => l.id !== copyId && (l as { width?: number }).width !== 400);
    expect(original, 'the original layer is cropped to the rect').toBeTruthy();
    const originalBefore = await readLayerInDocSpace(page, original!.id);
    const copyBefore = await readLayerInDocSpace(page, copyId);
    // Precondition: the two boxes differ, and the rect's rows start on an
    // odd row so halving puts its edges on half pixels.
    expect(originalBefore.y).toBe(101);
    expect(originalBefore.height).toBe(99);
    expect(copyBefore.height).toBe(300);

    await openImageSize(page);
    const dialog = page.getByRole('dialog', { name: 'Image Size' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="number"]').first().fill('200');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);

    const after = await getEditorState(page);
    expect(after.document.width).toBe(200);
    expect(after.document.height).toBe(150);

    const a = await readLayerInDocSpace(page, original!.id);
    const b = await readLayerInDocSpace(page, copyId);

    // The rect covers x 50..150 and y 50.5..100 in the new document: the
    // edge rows are half covered on both layers alike.
    const mismatches: string[] = [];
    for (let y = 45; y < 106; y++) {
      for (const x of [49, 50, 75, 100, 149, 150]) {
        const pa = pixelAt(a, x, y);
        const pb = pixelAt(b, x, y);
        if (pa.some((v, i) => Math.abs(v - pb[i]!) > 3)) {
          mismatches.push(`(${x},${y}) original ${pa.join(',')} copy ${pb.join(',')}`);
        }
      }
    }
    expect(mismatches).toEqual([]);

    // And the content itself landed where the exact scale puts it.
    expect(pixelAt(a, 100, 75)[3]).toBe(255);
    expect(pixelAt(a, 100, 49)[3]).toBe(0);
    expect(pixelAt(a, 100, 100)[3]).toBe(0);
    const topEdge = pixelAt(a, 100, 50)[3];
    expect(topEdge).toBeGreaterThan(64);
    expect(topEdge).toBeLessThan(192);
  });
});
