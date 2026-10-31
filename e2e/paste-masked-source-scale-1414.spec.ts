import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, docToScreen, selectTool, setForegroundColor } from './helpers';

// #1414 — Copy/paste from a masked photo layer sitting at a non-zero origin,
// delete the photo, then scale the pasted layer with a Move-tool handle: the
// box shrank but the pixels stayed put. The compositor left the photo's mask
// bound to a texture unit; once the photo was deleted the pool handed that
// texture to the pasted layer, and every float composite into it became a
// WebGL feedback loop that wrote nothing.

const DOC_W = 600;
const DOC_H = 450;

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

/** Drops a 675 × 450 PNG with a colour gradient, so it fits as 600 × 400 at y = 25. */
async function dropPhoto(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 675;
    canvas.height = 450;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 675, 450);
    grad.addColorStop(0, '#ff2000');
    grad.addColorStop(0.5, '#20ff40');
    grad.addColorStop(1, '#2040ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 675, 450);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    const target = document.querySelector('[data-testid="canvas-container"]')!;
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
}

async function traceLasso(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  await selectTool(page, 'lasso');
  const screen: Array<{ x: number; y: number }> = [];
  for (const p of points) screen.push(await docToScreen(page, p.x, p.y));
  await page.mouse.move(screen[0]!.x, screen[0]!.y);
  await page.mouse.down();
  for (const sp of screen.slice(1)) {
    await page.mouse.move(sp.x, sp.y, { steps: 10 });
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

interface LayerInfo { id: string; name: string; x: number; y: number; width: number; height: number }

async function layers(page: Page): Promise<{ active: string; list: LayerInfo[] }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: LayerInfo[] } };
    };
    const d = store.getState().document;
    return {
      active: d.activeLayerId,
      list: d.layers.map((l) => ({ id: l.id, name: l.name, x: l.x, y: l.y, width: l.width, height: l.height })),
    };
  });
}

/** Hidden (black) texels in a layer's JS mask bytes, which refresh lazily from the GPU. */
async function hiddenMaskTexels(page: Page, layerId: string): Promise<number> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask?: { data: Uint8ClampedArray } | null }> } };
    };
    const mask = store.getState().document.layers.find((l) => l.id === lid)?.mask;
    if (!mask) return 0;
    let n = 0;
    for (const v of mask.data) if (v < 128) n++;
    return n;
  }, layerId);
}

interface Box { minX: number; minY: number; maxX: number; maxY: number; count: number }

/** Bounding box (doc space) of opaque pixels in a layer's GPU texture. */
async function opaqueBox(page: Page, layerId: string): Promise<Box> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const r = await w.__readLayerPixels(lid);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if (r.pixels[(y * r.width + x) * 4 + 3]! > 128) {
          box.count++;
          box.minX = Math.min(box.minX, x + layer.x);
          box.minY = Math.min(box.minY, y + layer.y);
          box.maxX = Math.max(box.maxX, x + layer.x);
          box.maxY = Math.max(box.maxY, y + layer.y);
        }
      }
    }
    return box;
  }, layerId);
}

test.describe('Scale a layer pasted from a deleted masked photo (#1414)', () => {
  test('transform handles scale the pasted pixels', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel and handles differ on touch devices');
    const glErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') glErrors.push(msg.text());
    });

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    const before = await layers(page);
    await dropPhoto(page);
    await expect.poll(async () => (await layers(page)).list.length, { timeout: 15000 }).toBe(before.list.length + 1);
    const photoId = (await layers(page)).active;
    await expect.poll(async () => (await opaqueBox(page, photoId)).count, { timeout: 15000 }).toBe(600 * 400);
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);
    const photo = (await layers(page)).list.find((l) => l.id === photoId)!;

    // Lasso (150,75)–(468,412), add a mask and fill everything outside it black.
    await traceLasso(page, [
      { x: 150, y: 75 }, { x: 468, y: 75 }, { x: 468, y: 412 }, { x: 150, y: 412 }, { x: 150, y: 75 },
    ]);
    await page.locator('[aria-label="Add Mask"]').click();
    await page.waitForTimeout(200);
    await page.locator(`[aria-label="Edit mask for ${photo.name}"]`).click();
    await page.waitForTimeout(150);
    await menu(page, 'Select', /^\s*Inverse/);
    await setForegroundColor(page, 0, 0, 0);
    await menu(page, 'Edit', /^Fill$/);
    await page.keyboard.press('Control+d');
    await expect.poll(() => hiddenMaskTexels(page, photoId), { timeout: 10000 }).toBeGreaterThan(100000);

    // Mask → selection (the hidden area), inverted to the visible piece; copy, paste.
    await page.locator(`[data-mask-layer-id="${photoId}"]`).locator('[aria-label="Convert mask to selection"]').click();
    await page.waitForTimeout(150);
    await menu(page, 'Select', /^\s*Inverse/);
    await menu(page, 'Edit', /^Copy$/);
    await menu(page, 'Edit', /^Paste$/);
    await expect.poll(async () => (await layers(page)).list.length, { timeout: 10000 }).toBe(before.list.length + 2);
    const pastedId = (await layers(page)).active;
    expect(pastedId).not.toBe(photoId);
    // Deactivated, the photo crops to its content, so it is deleted from a
    // non-zero origin.
    await expect.poll(async () => (await layers(page)).list.find((l) => l.id === photoId)!.y).toBe(25);

    await page.locator(`[data-layer-id="${photoId}"]`).click();
    await page.waitForTimeout(100);
    await page.locator('[aria-label="Delete Layer"]').click();
    await expect.poll(async () => (await layers(page)).list.some((l) => l.id === photoId)).toBe(false);

    // Select the pasted layer and ⌘-click its thumbnail to load its alpha.
    await page.locator(`[data-layer-id="${pastedId}"]`).click();
    await page.waitForTimeout(100);
    await page.locator(`[data-layer-id="${pastedId}"]`).locator('[class*="thumbnail"]').first()
      .click({ modifiers: ['Control'] });
    await page.waitForTimeout(200);

    // The pasted piece is the lassoed box of the photo.
    const start = await opaqueBox(page, pastedId);
    expect(start).toMatchObject({ minX: 150, minY: 75, maxX: 467, maxY: 411 });

    // Bottom-right handle pulled in to 60 % of the piece: (468,412) → (341,277).
    await selectTool(page, 'move');
    const newMaxX = start.minX + Math.round((start.maxX + 1 - start.minX) * 0.6);
    const newMaxY = start.minY + Math.round((start.maxY + 1 - start.minY) * 0.6);
    const a = await docToScreen(page, start.maxX + 1, start.maxY + 1);
    const b = await docToScreen(page, newMaxX, newMaxY);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/paste-masked-source-scale.png' });

    // The top-left corner stays put, the far corner follows the handle and
    // the piece keeps ~0.6 × 0.6 of its pixels.
    const end = await opaqueBox(page, pastedId);
    expect(Math.abs(end.minX - start.minX)).toBeLessThanOrEqual(2);
    expect(Math.abs(end.minY - start.minY)).toBeLessThanOrEqual(2);
    expect(Math.abs(end.maxX + 1 - newMaxX)).toBeLessThanOrEqual(3);
    expect(Math.abs(end.maxY + 1 - newMaxY)).toBeLessThanOrEqual(3);
    expect(end.count).toBeGreaterThan(start.count * 0.3);
    expect(end.count).toBeLessThan(start.count * 0.42);

    expect(glErrors.filter((e) => /feedback loop/i.test(e))).toEqual([]);
  });
});
