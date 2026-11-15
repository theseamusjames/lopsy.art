import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen } from './helpers';

// #1189 — Select → Grow kept the old anti-aliased edge pixels at their
// partial coverage, so filling the grown selection left a faint ring of the
// old outline `amount` px inside the new edge.

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function menu(page: Page, top: string, item: RegExp): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: top, exact: true }).click();
  await page.locator(`[role="menu"][aria-label="${top}"]`).getByRole('menuitem', { name: item }).first().click();
  await page.waitForTimeout(200);
}

async function growBy(page: Page, amount: number): Promise<void> {
  await menu(page, 'Select', /^Grow/);
  const modal = page.locator('[role="dialog"][aria-label="Grow Selection"]');
  await modal.waitFor({ state: 'visible' });
  const input = modal.locator('input[aria-label$=" value"]').first();
  await input.fill(String(amount));
  await input.press('Tab');
  await modal.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(300);
}

interface AlphaStats {
  partialInside: number;
  lowest: number;
  alphaAtOldEdge: number;
}

async function alphaInsideGrownEllipse(page: Page): Promise<AlphaStats> {
  return page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return { partialInside: -1, lowest: -1, alphaAtOldEdge: -1 };
    // Marquee (100,80)→(300,220) grown by 10: centre (200,150), semi-axes
    // 110 × 80. Probe everything at least 5 px inside that outline.
    let partialInside = 0;
    let lowest = 255;
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const dx = (x + 0.5 - 200) / 105;
        const dy = (y + 0.5 - 150) / 75;
        if (dx * dx + dy * dy > 1) continue;
        const a = result.pixels[(y * result.width + x) * 4 + 3] ?? 0;
        if (a < 255) partialInside++;
        if (a < lowest) lowest = a;
      }
    }
    // The old marquee's left edge pixel on the centre row.
    const alphaAtOldEdge = result.pixels[(150 * result.width + 100) * 4 + 3] ?? 0;
    return { partialInside, lowest, alphaAtOldEdge };
  });
}

test.describe('Select → Grow anti-aliased edge (#1189)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
  });

  test('filling a grown elliptical selection leaves no ghost of the old edge', async ({ page }) => {
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragOnCanvas(page, 100, 80, 300, 220);
    await growBy(page, 10);
    await menu(page, 'Edit', /^Fill$/);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/selection-grow-aa-ring.png' });

    const stats = await alphaInsideGrownEllipse(page);
    expect(stats.alphaAtOldEdge).toBe(255);
    expect(stats.lowest).toBe(255);
    expect(stats.partialInside).toBe(0);
  });
});
