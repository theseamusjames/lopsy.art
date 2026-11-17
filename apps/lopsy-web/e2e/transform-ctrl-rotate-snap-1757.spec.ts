/**
 * #1757 — dragging a rotation handle with Ctrl held must snap the angle to
 * 15° steps, as Cmd does: on Windows and Linux Meta is the Super key, so
 * Ctrl is the only practical modifier there.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, selectTool, setForegroundColor, getEditorState } from './helpers';
import { findTransformHandle } from './text-edit-helpers';

async function dragAround(
  page: Page,
  handle: { x: number; y: number },
  pivotDoc: { x: number; y: number },
  degrees: number,
  modifier: 'Control' | null,
): Promise<void> {
  const pivot = await docToScreen(page, pivotDoc.x, pivotDoc.y);
  const radius = Math.hypot(handle.x - pivot.x, handle.y - pivot.y);
  const from = Math.atan2(handle.y - pivot.y, handle.x - pivot.x);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  if (modifier) await page.keyboard.down(modifier);
  for (let i = 1; i <= 10; i++) {
    const a = from + ((degrees * Math.PI) / 180) * (i / 10);
    await page.mouse.move(pivot.x + radius * Math.cos(a), pivot.y + radius * Math.sin(a));
  }
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(200);
}

async function opaqueBounds(page: Page, layerId: string): Promise<{ w: number; h: number }> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 128) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }, layerId);
}

test.describe('Ctrl snaps transform rotation to 15° (#1757)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'handle drags need a desktop pointer');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1000, 800, true);
    await page.waitForTimeout(200);
  });

  test('a pixel selection rotated with Ctrl lands on 45°', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId;
    if (!layerId) throw new Error('no active layer');
    await setForegroundColor(page, 30, 30, 200);
    await selectTool(page, 'marquee-rect');
    const a = await docToScreen(page, 400, 350);
    const b = await docToScreen(page, 600, 450);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(150);

    await selectTool(page, 'move');
    const handle = await findTransformHandle(page, 'rotate-top-left', { x: 390, y: 340 }, 30);
    await dragAround(page, handle, { x: 500, y: 400 }, 40, 'Control');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    // A 200 x 100 box at 45° spans (200 + 100) / √2 ≈ 212 px each way; at
    // the unsnapped ~40° it would be about 218 x 206.
    const box = await opaqueBounds(page, layerId);
    console.log('rotated selection bounds:', box);
    expect(Math.abs(box.w - box.h)).toBeLessThanOrEqual(3);
    expect(Math.abs(box.w - 212)).toBeLessThanOrEqual(3);
  });

  test('live text rotated with Ctrl lands on 45°', async ({ page }) => {
    await selectTool(page, 'text');
    const at = await docToScreen(page, 400, 400);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('ROTATE ME');
    await page.getByRole('button', { name: 'Commit text' }).click();
    await page.waitForTimeout(300);

    const text = (await getEditorState(page)).document.layers.find((l) => l.type === 'text') as
      unknown as { x: number; y: number; width: number | null };
    const bounds = await page.evaluate(async () => {
      const w = window as unknown as Record<string, unknown>;
      const store = w.__editorStore as { getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } } };
      const l = store.getState().document.layers.find((x) => x.type === 'text')!;
      const read = w.__readLayerPixels as (id?: string) => Promise<{ width: number; height: number }>;
      const { width, height } = await read(l.id);
      return { x: l.x, y: l.y, width, height };
    });
    expect(text).toBeDefined();

    await selectTool(page, 'move');
    const handle = await findTransformHandle(page, 'rotate-top-left', { x: bounds.x - 10, y: bounds.y - 10 }, 30);
    await dragAround(page, handle, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, 40, 'Control');

    const transform = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ type: string; transform?: { a: number; b: number } }> } };
      };
      return store.getState().document.layers.find((l) => l.type === 'text')?.transform ?? null;
    });
    expect(transform).not.toBeNull();
    const degrees = (Math.atan2(transform!.b, transform!.a) * 180) / Math.PI;
    console.log('text rotation:', degrees);
    expect(Math.abs(degrees - 45)).toBeLessThan(0.01);
  });
});
