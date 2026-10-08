/**
 * #1131 — a shape hanging off the canvas edge left a hairline behind when a
 * marquee transform squashed it.
 *
 * The Shape tool lets a triangle's base spill a few pixels past the bottom of
 * the canvas. A marquee dragged around it is clipped to the canvas, and the
 * Move tool's float treated off-canvas texels as unselected, so squashing the
 * triangle with the bottom handle left its off-canvas base rows where they
 * were. Hidden at first, the strip came into view as a thin diagonal line
 * once the group holding the layer was rotated.
 *
 * A selection that reaches a canvas edge now carries on past it for the Move
 * tool's float, so the whole shape goes with the transform. Every check reads
 * the triangle layer's own pixels and expects one connected blob.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  drawRect,
  getEditorState,
  selectTool,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';
import { findTransformHandle } from './text-edit-helpers';

type Box = [number, number, number, number];

interface Blob {
  /** Pixels with alpha > 8, 8-connected, largest first. */
  pieces: Array<{ count: number; box: Box }>;
  /** Document-space bounds of all of them. */
  box: Box;
}

const DOC = { width: 600, height: 500 };

/** Connected pieces of a layer's ink, in document space. */
async function inkPieces(page: Page, layerId: string): Promise<Blob> {
  return page.evaluate(async (id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      layerId: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(id);
    const { width: w, height: h } = px;
    const isInk = (i: number) => (px.pixels[i * 4 + 3] ?? 0) > 8;
    const seen = new Uint8Array(w * h);
    const pieces: Array<{ count: number; box: [number, number, number, number] }> = [];
    const stack: number[] = [];
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || !isInk(start)) continue;
      const piece = { count: 0, box: [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number] };
      seen[start] = 1;
      stack.push(start);
      while (stack.length > 0) {
        const p = stack.pop()!;
        const x = p % w;
        const y = (p - x) / w;
        piece.count++;
        piece.box = [
          Math.min(piece.box[0], x + layer.x), Math.min(piece.box[1], y + layer.y),
          Math.max(piece.box[2], x + layer.x), Math.max(piece.box[3], y + layer.y),
        ];
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (seen[q] || !isInk(q)) continue;
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
      pieces.push(piece);
    }
    pieces.sort((a, b) => b.count - a.count);
    const box = pieces.reduce<[number, number, number, number]>(
      (b, p) => [Math.min(b[0], p.box[0]), Math.min(b[1], p.box[1]), Math.max(b[2], p.box[2]), Math.max(b[3], p.box[3])],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    return { pieces, box };
  }, layerId);
}

async function clickRow(page: Page, layerId: string, modifiers: Array<'Shift'> = []): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"] span[class*="name"]`).first().click({ modifiers });
  await page.waitForTimeout(100);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** A rounded triangle whose base hangs a few pixels past the canvas bottom. */
async function drawTriangleOffBottom(page: Page): Promise<void> {
  await setForegroundColor(page, 40, 120, 220);
  await selectTool(page, 'shape');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('polygon');
  await page.locator('#polygon-sides').fill('3');
  await setToolOption(page, 'Corner Radius', 100);
  await drag(page, await docToScreen(page, 300, 243), await docToScreen(page, 600, 543));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

test.describe('#1131 squashing a shape that hangs off the canvas', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layers panel and options bar need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC.width, DOC.height, false);
  });

  test('the off-canvas base moves with the squash and never shows up after a group rotate', async ({ page }) => {
    const squareId = (await getEditorState(page)).document.activeLayerId;
    await drawRect(page, 40, 40, 40, 40, { r: 255, g: 0, b: 0 });
    await page.locator('[aria-label="Add Layer"]').click();
    const triangleId = (await getEditorState(page)).document.activeLayerId;
    await drawTriangleOffBottom(page);

    const drawn = await inkPieces(page, triangleId);
    expect(drawn.pieces).toHaveLength(1);
    const [left, top, right, bottom] = drawn.box;
    // The base really is past the canvas edge, so the marquee can't reach it.
    expect(bottom).toBeGreaterThanOrEqual(DOC.height);
    expect(bottom).toBeLessThan(DOC.height + 10);

    // Marquee around the triangle (clipped to the canvas), then drag the
    // bottom handle up to squash it to about 65 % of its height.
    await page.keyboard.press('m');
    await drag(page, await docToScreen(page, left - 20, top - 20), await docToScreen(page, right + 20, bottom + 20));
    await selectTool(page, 'move');
    const centreX = (left + right) / 2;
    const handle = await findTransformHandle(page, 'bottom', { x: centreX, y: DOC.height }, 30);
    const squashedBottom = top + (DOC.height - top) * 0.65;
    await drag(page, handle, await docToScreen(page, centreX, squashedBottom));
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/screenshots/hairline-1131-squashed.png' });

    // Nothing stays behind at the old base: the squash carried it along.
    const squashed = await inkPieces(page, triangleId);
    expect(squashed.pieces).toHaveLength(1);
    expect(squashed.box[3]).toBeLessThan(squashedBottom + 6);

    // Group the triangle with the square and turn the group 14° clockwise
    // with its rotate handle; then grow the canvas downwards.
    await clickRow(page, squareId);
    await clickRow(page, triangleId, ['Shift']);
    await page.click('button:has-text("Layer")');
    await page.getByRole('menuitem', { name: /^Group Layers/ }).click();
    await page.waitForTimeout(300);
    const groupId = (await getEditorState(page)).document.activeLayerId;
    await clickRow(page, groupId);
    await selectTool(page, 'move');
    const square = await inkPieces(page, squareId);
    const union: Box = [
      Math.min(square.box[0], squashed.box[0]), Math.min(square.box[1], squashed.box[1]),
      Math.max(square.box[2], squashed.box[2]) + 1, Math.max(square.box[3], squashed.box[3]) + 1,
    ];
    const rotate = await findTransformHandle(page, 'rotate-top-right', { x: union[2] + 14, y: union[1] - 14 }, 40);
    const pivot = await docToScreen(page, (union[0] + union[2]) / 2, (union[1] + union[3]) / 2);
    const radius = Math.hypot(rotate.x - pivot.x, rotate.y - pivot.y);
    const from = Math.atan2(rotate.y - pivot.y, rotate.x - pivot.x);
    await page.mouse.move(rotate.x, rotate.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const angle = from + ((14 * Math.PI) / 180) * (i / 10);
      await page.mouse.move(pivot.x + radius * Math.cos(angle), pivot.y + radius * Math.sin(angle));
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    const rotated = await inkPieces(page, triangleId);
    expect(rotated.pieces).toHaveLength(1);
    expect(rotated.pieces[0]!.count).toBeGreaterThan(squashed.pieces[0]!.count * 0.9);

    await page.locator('button:has-text("Image")').first().click();
    await page.locator('[role="menuitem"]:has-text("Canvas Size")').click();
    const dialog = page.getByRole('dialog', { name: 'Canvas Size' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="number"]').nth(1).fill(String(DOC.height + 100));
    await dialog.locator('[aria-label="Anchor center top"]').click();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);
    expect((await getEditorState(page)).document.height).toBe(DOC.height + 100);
    await page.screenshot({ path: 'test-results/screenshots/hairline-1131-canvas-size.png' });

    const resized = await inkPieces(page, triangleId);
    expect(resized.pieces).toHaveLength(1);
    expect(resized.box[3]).toBeLessThan(rotated.box[3] + 2);
  });
});
