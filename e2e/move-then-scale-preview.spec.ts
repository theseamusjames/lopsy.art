/**
 * Regression test for #874: after a Move-drag, scaling from a corner handle
 * must show a live preview — the presented canvas and the handle box grow
 * with the scale — and the rotate handle drawn at the scaled corner must
 * rotate (keeping the scale) rather than start a plain Move.
 *
 * Assertions read the *presented* frame (a page screenshot) and the 2D
 * overlay canvas, not `__readCompositedPixels`, which forces its own
 * recomposite and so could pass while the screen stayed stale.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setForegroundColor, docToScreen } from './helpers';

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

/** RGB of the presented page (a real screenshot) at a doc coordinate. */
async function presentedRgb(page: Page, docX: number, docY: number): Promise<[number, number, number]> {
  const s = await docToScreen(page, docX, docY);
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ png, x, y }) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const scale = img.width / innerWidth;
    const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, { png, x: s.x, y: s.y });
}

/** Max overlay alpha in a 7x7 box around a doc coordinate (the handle box is drawn there). */
async function overlayAlphaNear(page: Page, docX: number, docY: number): Promise<number> {
  const s = await docToScreen(page, docX, docY);
  return page.evaluate(({ x, y }) => {
    const c = Array.from(document.querySelectorAll('canvas')).find((el) => /overlayCanvas/.test(el.className)) as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 3, Math.round((y - r.top) * k) - 3, 7, 7).data;
    let m = 0;
    for (let i = 3; i < d.length; i += 4) m = Math.max(m, d[i]!);
    return m;
  }, s);
}

interface Transform { scaleX: number; scaleY: number; rotation: number }

async function transform(page: Page): Promise<Transform | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { transform: Transform | null } };
    return ui.getState().transform;
  });
}

test('scaling right after a Move-drag previews live, and the scaled rotate handle rotates', async ({ page, isMobile }) => {
  test.skip(isMobile, 'transform handles need the desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(300);

  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'marquee-rect');
  await drag(page, 60, 60, 140, 120);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);

  await page.keyboard.press('v');
  await drag(page, 100, 90, 200, 150);
  await page.waitForTimeout(200);
  // Block now covers (160,120)-(240,180).
  expect(await presentedRgb(page, 200, 150)).toEqual([255, 0, 0]);

  await page.keyboard.down('Shift');
  await drag(page, 240, 180, 280, 210);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/move-then-scale-preview.png' });

  const scaled = await transform(page);
  expect(scaled?.scaleX).toBeCloseTo(1.5, 2);
  // The presented frame shows the 120x90 preview (160,120)-(280,210)…
  expect(await presentedRgb(page, 265, 200)).toEqual([255, 0, 0]);
  // …and the handle box moved to the scaled corner.
  expect(await overlayAlphaNear(page, 280, 210)).toBeGreaterThan(200);
  expect(await overlayAlphaNear(page, 240, 180)).toBeLessThan(50);

  // The rotate handle sits 20 px outside the corner in pre-transform space,
  // so after the 1.5x scale it is 30 doc px out.
  const zoom = await page.evaluate(() => {
    const s = (window as unknown as Record<string, unknown>).__editorStore as { getState: () => { viewport: { zoom: number } } };
    return s.getState().viewport.zoom;
  });
  const corner = await docToScreen(page, 280, 120);
  const off = 20 * 1.5 * zoom;
  await page.mouse.move(corner.x + off, corner.y - off);
  await page.mouse.down();
  await page.mouse.move(corner.x + off + 20, corner.y - off + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const rotated = await transform(page);
  expect(Math.abs(rotated?.rotation ?? 0)).toBeGreaterThan(0.1);
  expect(rotated?.scaleX).toBeCloseTo(1.5, 2);
  expect(rotated?.scaleY).toBeCloseTo(1.5, 2);
});
