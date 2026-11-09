import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';

// #1421: resizing a marquee from its handles ignored the aspect-ratio lock,
// and every pointer move rebuilt and re-uploaded a document-sized mask, so
// resizing crawled on large canvases.

interface Bounds { x: number; y: number; width: number; height: number }

async function selection(page: Page): Promise<{ bounds: Bounds | null; mask: unknown }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { bounds: Bounds | null; mask: unknown } };
    };
    const sel = store.getState().selection;
    return { bounds: sel.bounds, mask: sel.mask };
  });
}

async function selectionMaskIdentity(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & { __maskIds?: WeakMap<object, number>; __maskNext?: number };
    const store = w.__editorStore as { getState: () => { selection: { mask: object | null } } };
    const mask = store.getState().selection.mask;
    if (!mask) return -1;
    w.__maskIds ??= new WeakMap();
    w.__maskNext ??= 0;
    if (!w.__maskIds.has(mask)) w.__maskIds.set(mask, w.__maskNext++);
    return w.__maskIds.get(mask)!;
  });
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function lockRatio(page: Page, w: number, h: number): Promise<void> {
  await page.locator('[aria-label="Aspect ratio width"]').fill(String(w));
  await page.locator('[aria-label="Aspect ratio height"]').fill(String(h));
  await page.locator('[aria-label="Aspect ratio height"]').press('Enter');
  await expect(page.locator('[aria-label="Unlock aspect ratio"]')).toHaveAttribute('aria-pressed', 'true');
}

test.describe('Marquee handle resize (#1421)', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'options bar requires desktop viewport');
  });

  test('a locked marquee keeps its aspect ratio when resized from a corner or an edge', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await page.keyboard.press('m');
    await lockRatio(page, 2, 1);
    await dragDoc(page, 100, 100, 300, 300);
    const drawn = (await selection(page)).bounds!;
    expect(drawn.width / drawn.height).toBeCloseTo(2, 1);

    // Corner: drag the bottom-right handle far down; width stays 2× height.
    const br = { x: drawn.x + drawn.width, y: drawn.y + drawn.height };
    await dragDoc(page, br.x, br.y, br.x + 100, br.y + 200);
    const afterCorner = (await selection(page)).bounds!;
    await page.screenshot({ path: 'e2e/screenshots/marquee-resize-aspect-1421-corner.png' });
    expect(afterCorner.x).toBe(drawn.x);
    expect(afterCorner.y).toBe(drawn.y);
    expect(afterCorner.width).toBeGreaterThan(drawn.width);
    expect(afterCorner.width / afterCorner.height).toBeCloseTo(2, 1);

    // Edge: drag the right handle; the height follows.
    const right = { x: afterCorner.x + afterCorner.width, y: afterCorner.y + afterCorner.height / 2 };
    await dragDoc(page, right.x, right.y, right.x + 80, right.y);
    const afterEdge = (await selection(page)).bounds!;
    await page.screenshot({ path: 'e2e/screenshots/marquee-resize-aspect-1421-edge.png' });
    expect(afterEdge.width).toBeGreaterThan(afterCorner.width + 60);
    expect(afterEdge.height).toBeGreaterThan(afterCorner.height + 30);
    expect(afterEdge.width / afterEdge.height).toBeCloseTo(2, 1);
  });

  test('an unlocked marquee still resizes freely', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await page.keyboard.press('m');
    await dragDoc(page, 100, 100, 300, 200);
    const drawn = (await selection(page)).bounds!;
    await dragDoc(page, drawn.x + drawn.width, drawn.y + drawn.height, drawn.x + drawn.width + 100, drawn.y + drawn.height);
    const resized = (await selection(page)).bounds!;
    expect(resized.width).toBeGreaterThan(drawn.width + 80);
    expect(Math.abs(resized.height - drawn.height)).toBeLessThanOrEqual(1);
  });

  test('the selection mask is built once per resize, not on every pointer move', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 4000, 3000, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await page.keyboard.press('m');
    await dragDoc(page, 500, 500, 2000, 1500);
    const drawn = (await selection(page)).bounds!;
    const maskBefore = await selectionMaskIdentity(page);

    // A couple of screen pixels inside the corner: right on it at this zoom
    // can land in the rotate zone just outside.
    const corner = await docToScreen(page, drawn.x + drawn.width, drawn.y + drawn.height);
    const a = { x: corner.x - 2, y: corner.y - 2 };
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(a.x + i * 5, a.y + i * 4);
    }
    await page.waitForTimeout(100);
    // Mid-drag the committed selection is untouched; only the preview moves.
    expect(await selectionMaskIdentity(page)).toBe(maskBefore);
    expect((await selection(page)).bounds).toEqual(drawn);
    await page.mouse.up();
    await page.waitForTimeout(200);

    const resized = (await selection(page)).bounds!;
    expect(await selectionMaskIdentity(page)).not.toBe(maskBefore);
    expect(resized.x).toBe(drawn.x);
    expect(resized.width).toBeGreaterThan(drawn.width);
    expect(resized.height).toBeGreaterThan(drawn.height);
  });
});
