import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
} from './helpers';

// #1018 — dragging a scale handle past the canvas grows the float on every
// pointer-move, and each growth used to bump the layer's pixel version. The
// layer thumbnail re-requested a GPU readback for every bump, and the idle
// queue flushed mid-drag, so a 30-step drag paid ~30 synchronous
// `readPixels` pipeline stalls. Growth now leaves the pixel version alone
// until pointer-up, which refreshes the thumbnail once.

interface ReadLog {
  __readPixelsLog: Array<{ w: number; h: number }>;
  __countReadPixels: boolean;
}

async function installReadPixelsCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as ReadLog;
    w.__readPixelsLog = [];
    w.__countReadPixels = false;
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels as (...args: unknown[]) => void;
    (proto as unknown as { readPixels: (...args: unknown[]) => void }).readPixels = function (
      this: WebGL2RenderingContext,
      ...args: unknown[]
    ) {
      if (w.__countReadPixels) w.__readPixelsLog.push({ w: Number(args[2]), h: Number(args[3]) });
      return original.apply(this, args);
    };
  });
}

async function setCounting(page: Page, isOn: boolean): Promise<number> {
  return page.evaluate((on) => {
    const w = window as unknown as ReadLog;
    const n = w.__readPixelsLog.length;
    w.__countReadPixels = on;
    w.__readPixelsLog = [];
    return n;
  }, isOn);
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** RGBA at thumbnail-relative (fx, fy) in [0, 1] for the layer's panel thumbnail. */
async function thumbnailPixel(page: Page, layerId: string, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(({ lid, fx, fy }) => {
    const canvas = document.querySelector(`[data-layer-id="${lid}"] canvas`) as HTMLCanvasElement | null;
    if (!canvas) return [];
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const x = Math.min(canvas.width - 1, Math.floor(fx * canvas.width));
    const y = Math.min(canvas.height - 1, Math.floor(fy * canvas.height));
    return Array.from(ctx.getImageData(x, y, 1, 1).data);
  }, { lid: layerId, fx, fy });
}

test('#1018: a scale drag past the canvas does no per-move thumbnail readback', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await installReadPixelsCounter(page);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 2048, 2048, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  // Zoom out so the canvas's bottom-right corner has room past it.
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Minus');
  await page.waitForTimeout(200);

  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);

  // Red square (512,512)-(1536,1536).
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'marquee-rect');
  await drag(page, 512, 512, 1536, 1536);
  await selectTool(page, 'fill');
  const inside = await docToScreen(page, 1024, 1024);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(300);

  // Move tool on the selection shows the transform box; grab its
  // bottom-right handle and drag it out past the canvas in 30 steps, pausing
  // long enough between moves for the thumbnail idle queue to flush. At this
  // zoom the rotate handle's hit circle covers the exact corner, so grab
  // the scale handle just inside it.
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  const start = await docToScreen(page, 1510, 1510);
  const end = await docToScreen(page, 2400, 2400);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await setCounting(page, true);
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
    await page.waitForTimeout(250);
  }
  const readsDuringDrag = await setCounting(page, true);
  await page.mouse.up();

  const scale = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: { scaleX: number; scaleY: number } | null };
    };
    const t = ui.getState().transform;
    return t ? [t.scaleX, t.scaleY] : null;
  });
  expect(scale).not.toBeNull();
  // (512..1536) stretched to (512..2400): scale ≈ 1888 / 1024.
  expect(scale![0]).toBeGreaterThan(1.7);
  expect(scale![1]).toBeGreaterThan(1.7);

  // The float grew many times during the drag; none of it may have
  // triggered a readback. At most the one read the pointer-down's float
  // lift queued.
  expect(readsDuringDrag).toBeLessThanOrEqual(1);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(1500);
  const readsAfterCommit = await setCounting(page, false);
  // Pointer-up and the commit refresh the thumbnail.
  expect(readsAfterCommit).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'e2e/screenshots/transform-drag-thumbnail-1018.png' });

  // The layer now spans the canvas plus the part scaled past it; its
  // thumbnail shows transparent top-left (the canvas area above/left of the
  // square) and red where the scaled square sits.
  const corner = await thumbnailPixel(page, layerId, 0.02, 0.02);
  expect(corner[3]).toBeLessThan(20);
  const middle = await thumbnailPixel(page, layerId, 0.55, 0.55);
  expect(middle[0]).toBeGreaterThan(200);
  expect(middle[1]).toBeLessThan(60);
  expect(middle[3]).toBeGreaterThan(200);
});
