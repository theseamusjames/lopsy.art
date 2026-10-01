/**
 * Image → Flip Horizontal / Vertical on the two layer types it used to get
 * wrong:
 *
 * - On a GROUP it pushed a history row and flipped the group's own 1×1
 *   placeholder texture, so nothing changed. It now mirrors every descendant
 *   about the group's combined content bounds, as one undo step.
 * - On a TEXT layer it mirrored the rendered glyph texture, which the next
 *   re-render from the stored string threw away. Like Edit → Fill and the
 *   filters, it now refuses a live text layer with a toast and no history
 *   row; rasterized, the same layer flips and stays flipped.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  docToScreen,
  getEditorState,
} from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): Promise<void> {
  await page.keyboard.press('m');
  await dragMarquee(page, x0, y0, x1, y1);
  await setForegroundColor(page, ...rgb);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function imageMenu(page: Page, item: 'Flip Horizontal' | 'Flip Vertical'): Promise<void> {
  await page.getByRole('button', { name: /^Image$/ }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(300);
}

/** Composited (on-screen) colour at a document point, at the current viewport. */
async function compositeAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
    const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
    const i = ((p.height - 1 - sy) * p.width + sx) * 4;
    return [p.pixels[i] ?? 0, p.pixels[i + 1] ?? 0, p.pixels[i + 2] ?? 0] as [number, number, number];
  }, { x, y });
}

function expectNear(actual: [number, number, number], expected: [number, number, number], tol = 4): void {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tol);
}

async function activeLayerId(page: Page): Promise<string> {
  return (await getEditorState(page)).document.activeLayerId!;
}

interface LayerSummary { id: string; type: string; children?: string[] }

async function layerSummaries(page: Page): Promise<LayerSummary[]> {
  return (await getEditorState(page)).document.layers as unknown as LayerSummary[];
}

interface LayerAlpha { width: number; height: number; alpha: number[] }

async function readLayerAlpha(page: Page, layerId: string): Promise<LayerAlpha> {
  return page.evaluate(async (lid) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await read(lid);
    const alpha: number[] = [];
    for (let i = 3; i < r.pixels.length; i += 4) alpha.push(r.pixels[i]!);
    return { width: r.width, height: r.height, alpha };
  }, layerId);
}

function opaqueCount(a: LayerAlpha): number {
  return a.alpha.filter((v) => v > 128).length;
}

/** Texels whose opaque/transparent state differs between `a` and `b` mirrored left-right. */
function mirrorMismatches(a: LayerAlpha, b: LayerAlpha): number {
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const av = a.alpha[y * a.width + x]! > 128;
      const bv = b.alpha[y * b.width + (b.width - 1 - x)]! > 128;
      if (av !== bv) n++;
    }
  }
  return n;
}

const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];
const BLUE: [number, number, number] = [0, 0, 255];

test.describe('Image → Flip on groups and text layers', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar and layers panel need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);
  });

  test('Flip Horizontal on a group mirrors its children about the group bounds, one undo step', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = await activeLayerId(page);

    // Child A: red block x 40..140, y 60..160, with a green notch in its top-left corner.
    await page.locator('[aria-label="Add Layer"]').click();
    const childA = await activeLayerId(page);
    await fillRect(page, 40, 60, 140, 160, RED);
    await fillRect(page, 40, 60, 70, 90, GREEN);
    // Child B: blue bar x 200..260, y 100..140.
    await page.locator('[aria-label="Add Layer"]').click();
    const childB = await activeLayerId(page);
    await fillRect(page, 200, 100, 260, 140, BLUE);

    const group = (await layerSummaries(page)).find((l) => l.id === groupId);
    expect(group?.children).toEqual(expect.arrayContaining([childA, childB]));

    // Before: green notch top-left of the red block, blue on the right.
    expectNear(await compositeAt(page, 55, 75), GREEN);
    expectNear(await compositeAt(page, 120, 130), RED);
    expectNear(await compositeAt(page, 230, 120), BLUE);
    expectNear(await compositeAt(page, 245, 75), WHITE);

    await page.locator(`[data-layer-id="${groupId}"]`).click();
    const undoBefore = (await getEditorState(page)).undoStackLength;
    await imageMenu(page, 'Flip Horizontal');
    await page.screenshot({ path: 'e2e/screenshots/image-flip-group-horizontal.png' });

    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore + 1);

    // The group's content spans x 40..260, so x maps to 300 − x:
    // red 40..140 → 160..260, its green notch 40..70 → 230..260, blue 200..260 → 40..100.
    expectNear(await compositeAt(page, 245, 75), GREEN);
    expectNear(await compositeAt(page, 180, 130), RED);
    expectNear(await compositeAt(page, 230, 120), RED);
    expectNear(await compositeAt(page, 70, 120), BLUE);
    expectNear(await compositeAt(page, 55, 75), WHITE);
    expectNear(await compositeAt(page, 120, 80), WHITE);
    // Rows outside every child stay untouched.
    expectNear(await compositeAt(page, 150, 200), WHITE);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expectNear(await compositeAt(page, 55, 75), GREEN);
    expectNear(await compositeAt(page, 120, 130), RED);
    expectNear(await compositeAt(page, 230, 120), BLUE);
    expectNear(await compositeAt(page, 245, 75), WHITE);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    expectNear(await compositeAt(page, 245, 75), GREEN);
    expectNear(await compositeAt(page, 70, 120), BLUE);
    expectNear(await compositeAt(page, 55, 75), WHITE);
  });

  test('Flip Vertical on a group mirrors its children top-to-bottom about the group bounds', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    await fillRect(page, 100, 40, 200, 100, RED);
    await page.locator('[aria-label="Add Layer"]').click();
    await fillRect(page, 300, 200, 360, 240, BLUE);

    await page.locator(`[data-layer-id="${groupId}"]`).click();
    await imageMenu(page, 'Flip Vertical');

    // Content spans y 40..240, so y maps to 280 − y:
    // red 40..100 → 180..240, blue 200..240 → 40..80.
    expectNear(await compositeAt(page, 150, 210), RED);
    expectNear(await compositeAt(page, 330, 60), BLUE);
    expectNear(await compositeAt(page, 150, 60), WHITE);
    expectNear(await compositeAt(page, 330, 220), WHITE);
  });

  test('Flip on a live text layer is refused with a toast; rasterized, it flips', async ({ page }) => {
    await page.keyboard.press('t');
    const before = new Set((await layerSummaries(page)).map((l) => l.id));
    const pos = await docToScreen(page, 80, 120);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('Flip Lp');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(400);
    const textLayer = (await layerSummaries(page)).find((l) => !before.has(l.id));
    expect(textLayer?.type).toBe('text');
    const textId = textLayer!.id;

    await page.keyboard.press('v');
    const glyphs = await readLayerAlpha(page, textId);
    expect(opaqueCount(glyphs)).toBeGreaterThan(100);
    // The glyphs are not left-right symmetric, so a mirror is detectable.
    expect(mirrorMismatches(glyphs, glyphs)).toBeGreaterThan(50);
    const undoBefore = (await getEditorState(page)).undoStackLength;

    await imageMenu(page, 'Flip Horizontal');

    const toast = page.locator('[role="status"]').filter({ hasText: 'Text layers must be rasterized before they can be flipped.' });
    await expect(toast).toBeVisible();
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore);
    const unchanged = await readLayerAlpha(page, textId);
    expect(unchanged.width).toBe(glyphs.width);
    expect(unchanged.alpha).toEqual(glyphs.alpha);

    await page.locator('[aria-label="Rasterize Layer"]').click();
    await page.waitForTimeout(300);
    expect((await layerSummaries(page)).find((l) => l.id === textId)?.type).toBe('raster');
    const raster = await readLayerAlpha(page, textId);
    const rasterUndo = (await getEditorState(page)).undoStackLength;

    await imageMenu(page, 'Flip Horizontal');
    await page.screenshot({ path: 'e2e/screenshots/image-flip-rasterized-text.png' });

    expect((await getEditorState(page)).undoStackLength).toBe(rasterUndo + 1);
    const flipped = await readLayerAlpha(page, textId);
    expect(flipped.width).toBe(raster.width);
    expect(flipped.height).toBe(raster.height);
    expect(mirrorMismatches(raster, flipped)).toBe(0);
  });

  test('Flip on a group holding a live text layer is refused with a toast', async ({ page }) => {
    await page.locator('[aria-label="New Group"]').click();
    const groupId = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    await fillRect(page, 40, 60, 140, 160, RED);

    await page.keyboard.press('t');
    const pos = await docToScreen(page, 300, 120);
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('Hi');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(400);
    await page.keyboard.press('v');

    const layers = await layerSummaries(page);
    const group = layers.find((l) => l.id === groupId);
    expect(group?.children?.some((id) => layers.find((l) => l.id === id)?.type === 'text')).toBe(true);

    await page.locator(`[data-layer-id="${groupId}"]`).click();
    const undoBefore = (await getEditorState(page)).undoStackLength;
    await imageMenu(page, 'Flip Horizontal');

    const toast = page.locator('[role="status"]').filter({ hasText: 'Rasterize the text layers in this group before flipping it.' });
    await expect(toast).toBeVisible();
    expect((await getEditorState(page)).undoStackLength).toBe(undoBefore);
    expectNear(await compositeAt(page, 60, 80), RED);
  });
});
