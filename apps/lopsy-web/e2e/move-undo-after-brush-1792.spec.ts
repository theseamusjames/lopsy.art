/**
 * #1792 — Undo after moving a layer whose last edit was a Brush or Pencil
 * stroke put the layer back at twice its content offset.
 *
 * A stroke's pointer-up caches a GPU snapshot of the layer's full-document
 * texture for the next history entry. The Move grab then crops the layer to
 * its content and pushes the 'Move' entry, which took that cached,
 * uncropped handle and paired it with the cropped x/y. Undo blitted the
 * document-sized texture in at the content's offset, so the stroke landed
 * at (content x, y) further down and right.
 */
import type { Page } from '@playwright/test';
import { test, expect, type ReadLayerInDocument } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  selectTool,
  setForegroundColor,
  setToolOption,
  undo,
  redo,
} from './helpers';

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; count: number }

const MOVE = { dx: 300, dy: 250 };

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Document-space bounds of the layer's red pixels. */
async function redBounds(page: Page, layerId: string): Promise<Bounds> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as { __readLayerInDocument: ReadLayerInDocument }).__readLayerInDocument;
    const img = await read(id);
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if ((img.data[i + 3] ?? 0) < 128 || (img.data[i] ?? 0) < 200 || (img.data[i + 1] ?? 0) > 60) continue;
        b.count++;
        if (x < b.minX) b.minX = x;
        if (y < b.minY) b.minY = y;
        if (x > b.maxX) b.maxX = x;
        if (y > b.maxY) b.maxY = y;
      }
    }
    return b;
  }, layerId);
}

/** Composited RGB at doc (x, y), as the canvas shows it. The GL buffer is bottom-up. */
async function compositeAt(page: Page, docX: number, docY: number): Promise<number[]> {
  const screen = await docToScreen(page, docX, docY);
  return page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const px = Math.round((sx - rect.left) * scale);
    const py = comp.height - 1 - Math.round((sy - rect.top) * scale);
    const i = (py * comp.width + px) * 4;
    return comp.pixels.slice(i, i + 3);
  }, { sx: screen.x, sy: screen.y });
}

function isRed(rgb: number[]): boolean {
  return (rgb[0] ?? 0) > 200 && (rgb[1] ?? 255) < 80 && (rgb[2] ?? 255) < 80;
}

function shifted(b: Bounds, dx: number, dy: number): Omit<Bounds, 'count'> {
  return { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy };
}

function boxOf(b: Bounds): Omit<Bounds, 'count'> {
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

test('#1792: undo/redo of a Move after a brush stroke restores the stroke where it was', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  const layerId = await addLayer(page);

  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'brush');
  await setToolOption(page, 'Size', 12);
  await dragDoc(page, 150, 90, 180, 40);

  const painted = await redBounds(page, layerId);
  expect(painted.count).toBeGreaterThan(100);
  // The stroke sits near the top-left: (150,90) -> (180,40), radius 6.
  expect(painted.minX).toBeGreaterThan(130);
  expect(painted.minX).toBeLessThan(150);
  expect(painted.minY).toBeGreaterThan(25);
  expect(painted.minY).toBeLessThan(45);

  await selectTool(page, 'move');
  await dragDoc(page, 165, 65, 165 + MOVE.dx, 65 + MOVE.dy);

  // The drag runs in screen pixels at the fit zoom, so the move can land a
  // pixel off the requested offset (Firefox rounds the pointer differently).
  // The stroke must still move as a whole, by that offset to within a pixel.
  const moved = await redBounds(page, layerId);
  const dx = moved.minX - painted.minX;
  const dy = moved.minY - painted.minY;
  expect(Math.abs(dx - MOVE.dx)).toBeLessThanOrEqual(1);
  expect(Math.abs(dy - MOVE.dy)).toBeLessThanOrEqual(1);
  expect(boxOf(moved)).toEqual(shifted(painted, dx, dy));

  await undo(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/move-undo-after-brush-1792.png' });

  // Back where it was painted, not at twice its offset from the origin.
  const undone = await redBounds(page, layerId);
  expect(boxOf(undone)).toEqual(boxOf(painted));
  expect(undone.count).toBe(painted.count);
  const midX = Math.round((painted.minX + painted.maxX) / 2);
  const midY = Math.round((painted.minY + painted.maxY) / 2);
  expect(isRed(await compositeAt(page, midX, midY))).toBe(true);
  expect(isRed(await compositeAt(page, midX * 2, midY * 2))).toBe(false);

  await redo(page);
  await page.waitForTimeout(300);
  const redone = await redBounds(page, layerId);
  expect(boxOf(redone)).toEqual(boxOf(moved));
  expect(isRed(await compositeAt(page, midX + dx, midY + dy))).toBe(true);

  await undo(page);
  await page.waitForTimeout(300);
  const undoneAgain = await redBounds(page, layerId);
  expect(boxOf(undoneAgain)).toEqual(boxOf(painted));
});
