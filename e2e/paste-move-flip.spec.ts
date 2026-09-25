import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setForegroundColor,
  selectTool,
} from './helpers';

// #822 — Paste, Move-drag the pasted piece, then Flip Horizontal from the
// Move options bar. The flip re-used the float that the drag had left
// behind (whose lifted pixels still sit at their pre-drag position) and
// mirrored it about the moved selection's centre, which threw every pixel
// outside the float buffer: the pasted layer ended up with 0 opaque pixels.

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function marqueeFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await drag(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
}

interface Region { red: number; blue: number; redSumX: number; blueSumX: number }

/** Classify composited pixels inside the doc rect [x0, x1) × [y0, y1). */
async function scanComposite(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<Region> {
  return page.evaluate(async ({ x0, y0, x1, y1 }) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const { document: doc, viewport } = w.__editorStore.getState();
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const out = { red: 0, blue: 0, redSumX: 0, blueSumX: 0 };
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const sx = (x + 0.5 - doc.width / 2) * viewport.zoom + viewport.panX + rect.width / 2;
        const sy = (y + 0.5 - doc.height / 2) * viewport.zoom + viewport.panY + rect.height / 2;
        const px = Math.floor(sx * scale);
        const py = comp.height - 1 - Math.floor(sy * scale);
        const i = (py * comp.width + px) * 4;
        const r = comp.pixels[i]!;
        const g = comp.pixels[i + 1]!;
        const b = comp.pixels[i + 2]!;
        if (r > 200 && g < 60 && b < 60) { out.red++; out.redSumX += x; }
        if (b > 200 && r < 60 && g < 60) { out.blue++; out.blueSumX += x; }
      }
    }
    return out;
  }, { x0, y0, x1, y1 });
}

async function opaqueCount(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ pixels: number[] }>;
    const r = await fn(lid);
    let n = 0;
    for (let i = 3; i < r.pixels.length; i += 4) if (r.pixels[i]! > 200) n++;
    return n;
  }, layerId);
}

test('#822: paste, move the pasted piece, Flip Horizontal mirrors it in place', async ({ page, isMobile }) => {
  test.skip(isMobile, 'menu bar and options bar are hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  // Red block (40,40)-(160,120) with a blue square in its top-left corner.
  await setForegroundColor(page, 255, 0, 0);
  await marqueeFill(page, 40, 40, 160, 120);
  // Deselect first: a drag that starts inside a live marquee moves it.
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
  await setForegroundColor(page, 0, 0, 255);
  await marqueeFill(page, 40, 40, 70, 70);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);

  // Copy a marquee around it and paste: the selection stays live.
  await selectTool(page, 'marquee-rect');
  await drag(page, 20, 20, 200, 140);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const pasted = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; name: string }> } };
    };
    const s = store.getState().document;
    return { id: s.activeLayerId, name: s.layers.find((l) => l.id === s.activeLayerId)!.name };
  });
  expect(pasted.name).toMatch(/Paste/i);
  // The paste lands on a later frame under a loaded software GPU; poll.
  await expect.poll(() => opaqueCount(page, pasted.id), { timeout: 30000 }).toBeGreaterThan(9000);
  const pastedOpaque = await opaqueCount(page, pasted.id);

  // Drag the pasted piece 300px to the right.
  await page.keyboard.press('v');
  await drag(page, 100, 80, 400, 80);
  await page.waitForTimeout(200);

  const moved = await scanComposite(page, 300, 20, 600, 160);
  expect(moved.red).toBeGreaterThan(8000);
  expect(moved.blue).toBeGreaterThan(800);
  // Blue sits on the LEFT of the red block before the flip.
  expect(moved.blueSumX / moved.blue).toBeLessThan(moved.redSumX / moved.red);

  const selection = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { bounds: { x: number; width: number } | null } };
    };
    return store.getState().selection.bounds;
  });
  // The marquee (20..200) moved with the piece.
  expect(selection).toMatchObject({ x: 320, width: 180 });
  const selCentre = selection!.x + selection!.width / 2;

  await page.getByRole('button', { name: 'Flip Horizontal' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/paste-move-flip.png' });

  // The pasted pixels survive the flip ...
  const afterOpaque = await opaqueCount(page, pasted.id);
  expect(afterOpaque).toBeGreaterThan(pastedOpaque * 0.9);
  expect(afterOpaque).toBeLessThan(pastedOpaque * 1.1);

  // ... stay inside the moved selection, and are mirrored: blue now on the right.
  const flipped = await scanComposite(page, 300, 20, 600, 160);
  expect(flipped.red).toBeGreaterThan(moved.red * 0.9);
  expect(flipped.blue).toBeGreaterThan(moved.blue * 0.9);
  expect(flipped.blueSumX / flipped.blue).toBeGreaterThan(flipped.redSumX / flipped.red);
  // Mirrored about the selection's centre: content centred at c lands at 2*selCentre - c.
  const centreBefore = (moved.redSumX + moved.blueSumX) / (moved.red + moved.blue);
  const centreAfter = (flipped.redSumX + flipped.blueSumX) / (flipped.red + flipped.blue);
  expect(Math.abs(centreAfter - (2 * selCentre - centreBefore))).toBeLessThan(2);
});
