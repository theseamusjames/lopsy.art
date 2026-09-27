import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setForegroundColor,
  selectTool,
} from './helpers';

// #948 — Paste, switch to Move, scale the piece with a corner handle, then
// drag it: the piece snapped back to its pre-scale size. The drag reused the
// live float but re-composited its *untransformed* lifted pixels at the drag
// offset, dropping the pending scale. It must now translate the transform.

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function marqueeFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await drag(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
}

interface Box { minX: number; minY: number; maxX: number; maxY: number; count: number }

/** Bounding box (doc space) of red pixels in the on-screen composite. */
async function redBoxComposite(page: Page): Promise<Box> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const { document: doc, viewport } = w.__editorStore.getState();
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const sx = (x + 0.5 - doc.width / 2) * viewport.zoom + viewport.panX + rect.width / 2;
        const sy = (y + 0.5 - doc.height / 2) * viewport.zoom + viewport.panY + rect.height / 2;
        const px = Math.floor(sx * scale);
        const py = comp.height - 1 - Math.floor(sy * scale);
        const i = (py * comp.width + px) * 4;
        if (comp.pixels[i]! > 200 && comp.pixels[i + 1]! < 60 && comp.pixels[i + 2]! < 60) {
          box.count++;
          box.minX = Math.min(box.minX, x);
          box.minY = Math.min(box.minY, y);
          box.maxX = Math.max(box.maxX, x);
          box.maxY = Math.max(box.maxY, y);
        }
      }
    }
    return box;
  });
}

/** Bounding box (doc space) of opaque pixels in a layer's GPU texture. */
async function opaqueBoxLayer(page: Page, layerId: string): Promise<Box> {
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

async function pasteRedBlock(page: Page): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  // 120 × 80 red block at (40,40)–(160,120), copied and pasted.
  await setForegroundColor(page, 255, 0, 0);
  await marqueeFill(page, 40, 40, 160, 120);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const pastedId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; name: string }> } };
    };
    const s = store.getState().document;
    return s.layers.find((l) => l.id === s.activeLayerId)!.name.match(/Paste/i) ? s.activeLayerId : '';
  });
  expect(pastedId).not.toBe('');
  await expect.poll(async () => (await opaqueBoxLayer(page, pastedId)).count, { timeout: 30000 }).toBeGreaterThan(9000);

  // Hide the original so the composite shows only the pasted piece.
  const originalId = await page.evaluate((pid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    return store.getState().document.layers.find((l) => l.type === 'raster' && l.id !== pid)!.id;
  }, pastedId);
  await page.locator(`[data-layer-id="${originalId}"]`)
    .locator('button[aria-label="Hide layer"]').click();
  await page.waitForTimeout(150);
  return pastedId;
}

test.describe('Scale then move a pasted piece (#948)', () => {
  test('dragging a scaled piece keeps its new size', async ({ page, isMobile }) => {
    test.skip(isMobile, 'options bar and handles differ on touch devices');
    const pastedId = await pasteRedBlock(page);

    await page.keyboard.press('v');
    // Bottom-right handle (160,120) → (220,160): 120×80 grows to 180×120.
    await drag(page, 160, 120, 220, 160);
    const scaled = await redBoxComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/paste-scale-then-move-scaled.png' });
    expect(scaled.maxX - scaled.minX + 1).toBeGreaterThan(170);
    expect(scaled.maxY - scaled.minY + 1).toBeGreaterThan(112);

    // Drag from inside the scaled piece by (+200, +100).
    await drag(page, 100, 80, 300, 180);
    const moved = await redBoxComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/paste-scale-then-move-moved.png' });

    // Still 180 × 120 (not snapped back to 120 × 80), shifted by the drag.
    const movedW = moved.maxX - moved.minX + 1;
    const movedH = moved.maxY - moved.minY + 1;
    expect(Math.abs(movedW - (scaled.maxX - scaled.minX + 1))).toBeLessThanOrEqual(2);
    expect(Math.abs(movedH - (scaled.maxY - scaled.minY + 1))).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.minX - (scaled.minX + 200))).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.minY - (scaled.minY + 100))).toBeLessThanOrEqual(2);
    expect(moved.count).toBeGreaterThan(scaled.count * 0.95);

    // The transform keeps the scale, so the handles stay on the big box.
    const transform = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: { scaleX: number; scaleY: number } | null };
      };
      return ui.getState().transform;
    });
    expect(transform?.scaleX).toBeCloseTo(1.5, 1);

    // Commit: the layer holds the scaled, moved block.
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    const committed = await opaqueBoxLayer(page, pastedId);
    expect(Math.abs(committed.maxX - committed.minX + 1 - movedW)).toBeLessThanOrEqual(2);
    expect(Math.abs(committed.maxY - committed.minY + 1 - movedH)).toBeLessThanOrEqual(2);
    expect(Math.abs(committed.minX - moved.minX)).toBeLessThanOrEqual(2);
  });

  test('arrow-key nudges of a scaled piece keep its new size', async ({ page, isMobile }) => {
    test.skip(isMobile, 'options bar and handles differ on touch devices');
    await pasteRedBlock(page);

    await page.keyboard.press('v');
    await drag(page, 160, 120, 220, 160);
    const scaled = await redBoxComposite(page);

    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const nudged = await redBoxComposite(page);
    await page.screenshot({ path: 'e2e/screenshots/paste-scale-then-nudge.png' });

    expect(Math.abs((nudged.maxX - nudged.minX) - (scaled.maxX - scaled.minX))).toBeLessThanOrEqual(2);
    expect(Math.abs((nudged.maxY - nudged.minY) - (scaled.maxY - scaled.minY))).toBeLessThanOrEqual(2);
    expect(Math.abs(nudged.minX - (scaled.minX + 5))).toBeLessThanOrEqual(1);
  });
});
