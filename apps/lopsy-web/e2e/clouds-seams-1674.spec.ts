import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';

/**
 * #1674 — Filter → Clouds produced hard-edged blocks and seams along the
 * value-noise lattice: the float hash gave the two cells either side of a
 * lattice line different values for their shared corner. Clouds is
 * continuous, so neighbouring pixels never jump by much.
 *
 * The seams came from GPU compilers that reassociate float math (seen on
 * NVIDIA). SwiftShader computes the old hash consistently, so on the
 * default e2e browser this guards continuity but cannot show the old
 * failure; run it with LOPSY_GPU=hardware on such a GPU for that.
 */

async function runFilter(page: Page, name: string, scale?: number): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}\\.\\.\\.$`) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (scale !== undefined) {
    const slider = dialog.getByRole('slider', { name: 'Scale' });
    await slider.fill(String(scale));
  }
  await dialog.getByRole('button', { name: /^Apply$/ }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(300);
}

/** Horizontally or vertically adjacent pixels whose red differs by >= 40 levels. */
async function countJumps(page: Page): Promise<{ jumps: number; opaque: number; min: number; max: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> }>;
    const store = w.__editorStore as { getState: () => { document: { activeLayerId: string } } };
    const { width, height, pixels } = await read(store.getState().document.activeLayerId);
    let jumps = 0;
    let opaque = 0;
    let min = 255;
    let max = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i + 3]! > 250) opaque++;
        min = Math.min(min, pixels[i]!);
        max = Math.max(max, pixels[i]!);
        if (x + 1 < width && Math.abs(pixels[i]! - pixels[i + 4]!) >= 40) jumps++;
        if (y + 1 < height && Math.abs(pixels[i]! - pixels[i + width * 4]!) >= 40) jumps++;
      }
    }
    return { jumps, opaque, min, max };
  });
}

test.describe('Clouds is continuous (#1674)', () => {
  test('no hard jumps between neighbouring pixels across several random seeds', async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the menu bar');
    test.setTimeout(300_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 2400, 1000, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(200);

    for (let run = 0; run < 3; run++) {
      await runFilter(page, 'Clouds', 4);
      const { jumps, opaque, min, max } = await countJumps(page);
      expect(opaque).toBe(2400 * 1000);
      // A real cloud field, not a flat fill.
      expect(max - min).toBeGreaterThan(150);
      expect(jumps, `run ${run}`).toBe(0);
    }
  });
});
