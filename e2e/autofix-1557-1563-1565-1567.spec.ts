import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  setForegroundColor,
  setBlendMode,
  applyFilter,
} from './helpers';

/**
 * #1557 — a Soft Light layer over a gradient ramping to 0 left NaN pixels
 *         in the composite that showed through opaque layers above it.
 * #1563 — the marquee aspect-ratio inputs clamped and merged digits while
 *         typing; they now commit on blur, floor at 1, offer presets and
 *         turn the lock on.
 * #1565 — Twirl held in place tore the falloff ring into stair steps.
 * #1567 — Merge Down deleted pixels hanging past the canvas edge.
 */

interface Bounds { left: number; top: number; right: number; bottom: number }

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(250);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function fillMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  await dragDoc(page, x0, y0, x1, y1);
  await menu(page, 'Edit', /^Fill(\s*⇧F5)?$/);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId!;
}

/** Document-space bounds of a layer's opaque pixels, read from its GPU texture. */
async function contentBounds(page: Page, layerId: string): Promise<Bounds | null> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = w.__editorStore as { getState: () => { document: { layers: { id: string; x: number; y: number }[] } } };
    const layer = store.getState().document.layers.find((l) => l.id === id)!;
    const { width, height, pixels } = await read(id);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (left === Infinity) return null;
    return { left: layer.x + left, top: layer.y + top, right: layer.x + right + 1, bottom: layer.y + bottom + 1 };
  }, layerId);
}

test.describe('Autofix #1557, #1563, #1565, #1567', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and options bar');
  });

  test('#1557: an opaque layer above Soft Light over a gradient renders its own colour everywhere', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // A black-to-white ramp: every channel runs down to 0 at the top edge,
    // where the dither used to push the 16-bit texture below zero.
    await page.locator('[data-tool-id="gradient"]').click();
    await page.keyboard.press('d');
    await dragDoc(page, 200, 0, 200, 400, 5);

    await page.locator('[aria-label="Add Layer"]').click();
    await setForegroundColor(page, 255, 242, 0);
    await applyFilter(page, 'Sunburst...', { Rays: 48 });
    await setBlendMode(page, 'soft-light');

    await page.locator('[aria-label="Add Layer"]').click();
    await setForegroundColor(page, 0, 229, 255);
    await fillMarquee(page, -20, -20, 420, 420);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/autofix-1557-soft-light-nan.png' });

    const bad = await page.evaluate(async () => {
      const w = window as unknown as {
        __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
        __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
      };
      const p = await w.__readCompositedPixels();
      const { document: doc, viewport: vp } = w.__editorStore.getState();
      let count = 0;
      for (let y = 0; y < doc.height; y++) {
        const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
        for (let x = 0; x < doc.width; x++) {
          const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
          const i = ((p.height - 1 - sy) * p.width + sx) * 4;
          const r = p.pixels[i] ?? 0;
          const g = p.pixels[i + 1] ?? 0;
          const b = p.pixels[i + 2] ?? 0;
          if (r > 8 || Math.abs(g - 229) > 8 || b < 247) count++;
        }
      }
      return count;
    });
    expect(bad).toBe(0);
  });

  test('#1563: ratio fields commit on blur, floor at 1, offer presets and lock the ratio', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.keyboard.press('m');

    const width = page.locator('[aria-label="Aspect ratio width"]');
    const height = page.locator('[aria-label="Aspect ratio height"]');
    const preset = page.locator('select[aria-label="Aspect ratio preset"]');
    await expect(page.locator('[aria-label="Lock aspect ratio"]')).toHaveAttribute('aria-pressed', 'false');

    // Clicking into the field and typing replaces the 1 rather than making 15.
    await width.click();
    await page.keyboard.type('5');
    await expect(width).toHaveValue('5');
    // Deleting the digits mid-edit leaves the field empty instead of
    // snapping to a minimum.
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(width).toHaveValue('');
    await page.keyboard.type('5');
    await expect(width).toHaveValue('5');

    await height.click();
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    await expect(width).toHaveValue('5');
    await expect(height).toHaveValue('7');
    await expect(page.locator('[aria-label="Unlock aspect ratio"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(preset).toHaveValue('5:7');

    await dragDoc(page, 100, 100, 400, 400);
    const bounds = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: { width: number; height: number } | null } };
      };
      return store.getState().selection.bounds;
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.width / bounds!.height).toBeCloseTo(5 / 7, 1);
    await page.keyboard.press('Control+d');

    // A 0 commits as the minimum of 1.
    await width.fill('0');
    await width.press('Enter');
    await expect(width).toHaveValue('1');

    // Unlocking, then picking a preset fills both fields and locks again.
    await page.locator('[aria-label="Unlock aspect ratio"]').click();
    await expect(page.locator('[aria-label="Lock aspect ratio"]')).toHaveAttribute('aria-pressed', 'false');
    await preset.selectOption('16:9');
    await expect(width).toHaveValue('16');
    await expect(height).toHaveValue('9');
    await expect(page.locator('[aria-label="Unlock aspect ratio"]')).toHaveAttribute('aria-pressed', 'true');

    // A ratio that matches no preset shows Custom.
    await height.fill('10');
    await height.press('Enter');
    await expect(preset).toHaveValue('16:10');
    await height.fill('11');
    await height.press('Enter');
    await expect(preset).toHaveValue('custom');
  });

  test('#1565: Twirl wiggled in place keeps the falloff ring smooth', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 256, 256, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    const layerId = await activeLayerId(page);

    // A black-to-white ramp one level per pixel: each pixel's value is the
    // x it was pulled from, so the warp's field can be read off the layer.
    await page.locator('[data-tool-id="gradient"]').click();
    await page.keyboard.press('d');
    await dragDoc(page, 0, 128, 256, 128, 5);

    await menu(page, 'Filter', /^Liquify/);
    const panel = page.locator('[data-testid="liquify-panel"]');
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    await panel.locator('select[aria-label="Liquify mode"]').selectOption('twirl-cw');
    await panel.locator('input[aria-label="Brush size"]').fill('200');
    await panel.locator('input[aria-label="Brush pressure"]').fill('60');
    await expect(panel).toContainText('60%');

    // Every pointer move is a dab: wiggle 1 px on the spot, as in the report.
    const c0 = await docToScreen(page, 128, 128);
    const c1 = await docToScreen(page, 129, 128);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    for (let i = 0; i < 240; i++) await page.mouse.move(i % 2 ? c1.x : c0.x, c0.y);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="liquify-apply"]').click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/autofix-1565-twirl-ring.png' });

    const stats = await page.evaluate(async (lid) => {
      const w = window as unknown as Record<string, unknown>;
      const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
      const layer = store.getState().document.layers.find((l) => l.id === lid)!;
      const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const { width, pixels } = await read(lid);
      const v = (x: number, y: number) => pixels[((y - layer.y) * width + (x - layer.x)) * 4] ?? 0;
      const jumps: number[] = [];
      let moved = 0;
      for (let y = 20; y < 236; y++) {
        for (let x = 20; x < 236; x++) {
          const r = Math.hypot(x + 0.5 - 128.5, y + 0.5 - 128) / 100;
          if (r < 0.6 || r > 0.95) continue;
          if (Math.abs(v(x, y) - x) > 8) moved++;
          const sx = Math.abs(v(x - 1, y) - 2 * v(x, y) + v(x + 1, y));
          const sy = Math.abs(v(x, y - 1) - 2 * v(x, y) + v(x, y + 1));
          jumps.push(Math.max(sx, sy));
        }
      }
      jumps.sort((a, b) => a - b);
      return {
        moved: moved / jumps.length,
        p99: jumps[Math.floor(jumps.length * 0.99)] ?? 0,
        over10: jumps.filter((j) => j > 10).length,
      };
    }, layerId);

    // The twirl did swirl the ring…
    expect(stats.moved).toBeGreaterThan(0.2);
    // …and the field stayed continuous. The stair steps were offsets of
    // 10–20 px between neighbouring pixels (p99 ≈ 15 before the fix).
    expect(stats.p99).toBeLessThanOrEqual(6);
    expect(stats.over10).toBe(0);
  });

  test('#1567: Merge Down keeps pixels that hang past the canvas edge', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setForegroundColor(page, 220, 20, 20);
    await fillMarquee(page, 400, 100, 580, 200);
    const bottomId = await activeLayerId(page);
    const red = (await contentBounds(page, bottomId))!;
    expect(red).not.toBeNull();

    // Push the red bar 150 px right, past the canvas edge.
    await page.keyboard.press('v');
    await dragDoc(page, 490, 150, 640, 150);
    const pushed = (await contentBounds(page, bottomId))!;
    const dx = pushed.left - red.left;
    expect(Math.abs(dx - 150)).toBeLessThanOrEqual(1);
    expect(pushed.right).toBeGreaterThan(600 + 100);

    // The upper layer hangs off the left edge.
    await page.locator('[aria-label="Add Layer"]').click();
    await setForegroundColor(page, 20, 20, 220);
    await fillMarquee(page, 60, 60, 160, 160);
    const topId = await activeLayerId(page);
    const blue = (await contentBounds(page, topId))!;
    await page.keyboard.press('v');
    await dragDoc(page, 110, 110, 10, 110);
    const blueMoved = (await contentBounds(page, topId))!;
    const blueDx = blueMoved.left - blue.left;
    expect(Math.abs(blueDx + 100)).toBeLessThanOrEqual(1);
    expect(blueMoved.left).toBeLessThan(0);

    await menu(page, 'Layer', /^Merge Down/);
    expect(await activeLayerId(page)).toBe(bottomId);
    const merged = (await contentBounds(page, bottomId))!;
    await page.screenshot({ path: 'e2e/screenshots/autofix-1567-merge-overhang.png' });
    // Both overhangs survive the merge.
    expect(merged.left).toBe(blueMoved.left);
    expect(merged.right).toBe(pushed.right);

    // Dragging the merged layer back brings the red bar back whole.
    await dragDoc(page, 300, 150, 150, 150);
    const back = (await contentBounds(page, bottomId))!;
    const backDx = back.right - merged.right;
    expect(Math.abs(backDx + 150)).toBeLessThanOrEqual(1);
    expect(back.right - back.left).toBe(merged.right - merged.left);
    expect(back.right).toBeGreaterThan(575);
  });
});
