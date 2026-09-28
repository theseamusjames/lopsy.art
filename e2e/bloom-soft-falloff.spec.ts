/**
 * Regression test for #959: since the blur shader started un-premultiplying
 * its output (#929), Bloom grew every highlight into a hard-edged solid block
 * `Radius` px wider on each side — the blurred alpha was ignored by the
 * combine pass, so every pixel inside the kernel's support got the full
 * highlight colour. Bloom must fall off smoothly from the highlight's edge.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setForegroundColor,
  docToScreen,
  applyFilter,
} from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
}

/** Red channel of the active layer along doc row `y`, for x in [x0, x1]. */
async function redAlongRow(page: Page, y: number, x0: number, x1: number): Promise<number[]> {
  return page.evaluate(async ({ y, x0, x1 }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layer.id);
    const out: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const lx = x - layer.x;
      const ly = y - layer.y;
      out.push(px.pixels[(ly * px.width + lx) * 4] ?? -1);
    }
    return out;
  }, { y, x0, x1 });
}

test('Bloom falls off smoothly from a white disc instead of growing a hard block', async ({ page, isMobile }) => {
  test.skip(isMobile, 'menus and marquee drags need the desktop layout');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 800, 600, false);
  await page.waitForTimeout(300);

  await setForegroundColor(page, 0, 0, 0);
  await editFill(page);

  await setForegroundColor(page, 255, 255, 255);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  await dragMarquee(page, 350, 250, 450, 350);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  // Before Bloom: the disc edge is at x = 450 on row y = 300; beyond it is black.
  const before = await redAlongRow(page, 300, 440, 500);
  expect(before[0]).toBeGreaterThan(250);
  expect(before[20]).toBe(0);

  await applyFilter(page, 'Bloom...', { Threshold: 50, 'Soft Knee': 50, Radius: 15, Intensity: 100 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/bloom-soft-falloff.png' });

  // Row y = 300 from x = 450 (disc edge) to x = 480 (beyond the 15 px radius).
  const row = await redAlongRow(page, 300, 450, 480);

  // A glow exists just outside the disc…
  expect(row[5]).toBeGreaterThan(20);
  // …and it fades: the bug was a flat 255 plateau up to x = 464, then 0.
  // A soft falloff has many in-between values across the halo.
  const intermediate = row.filter((r) => r > 8 && r < 240).length;
  expect(intermediate).toBeGreaterThanOrEqual(6);
  // Monotonically non-increasing outward (small tolerance for rounding).
  for (let i = 1; i < row.length; i++) {
    expect(row[i]!).toBeLessThanOrEqual(row[i - 1]! + 2);
  }
  // Beyond the kernel support nothing is added.
  expect(row[30]).toBeLessThan(8);
});
