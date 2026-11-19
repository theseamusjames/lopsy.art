import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, setToolOption } from './helpers';
import { clickAtDoc } from './text-edit-helpers';
import { serveFontsOffline } from './font-fixtures';

/**
 * #1806: where two contours of one glyph overlap, swash's rasterizer added
 * both contours' partial edge coverage, so a straight edge shared by both
 * came out brighter: Azeret Mono Black's P had a ~38% cap line with a run
 * at ~68% where the stem and bowl contours meet. The cap line must be one
 * flat partial coverage, as a non-zero fill of the glyph gives.
 */

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForFunction(
    (f) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
      return fn ? fn(f) : false;
    },
    family,
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
}

/** Alpha of the text layer's topmost row with ink, pixels above 10 only. */
async function readCapLine(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string }> } };
    };
    const read = w.__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const layer = store.getState().document.layers.find((l) => l.type === 'text');
    if (!layer) return [];
    const { width, height, pixels } = await read(layer.id);
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        const a = pixels[(y * width + x) * 4 + 3]!;
        if (a > 10) row.push(a);
      }
      if (row.length > 0) return row;
    }
    return [];
  });
}

test('overlapping contours of a glyph leave its edge row flat (#1806)', async ({ page }) => {
  await serveFontsOffline(page);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 900, 600, false);
  await page.waitForTimeout(300);

  await page.keyboard.press('t');
  await setToolOption(page, 'Size', 330);
  await selectFont(page, 'Azeret Mono');
  await page.getByLabel('Font weight').selectOption('900');
  await page.waitForTimeout(400);

  await clickAtDoc(page, 200, 100);
  await page.keyboard.type('P');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  const capLine = await readCapLine(page);
  expect(capLine.length, 'the P is drawn').toBeGreaterThan(40);
  const sorted = [...capLine].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  // The cap line sits at a fractional y, so it is partly covered…
  expect(median, `cap line ${capLine.join(' ')}`).toBeLessThan(250);
  // …and no stretch of it is brighter where the stem and bowl overlap.
  expect(sorted[sorted.length - 1]!, `cap line ${capLine.join(' ')}`).toBeLessThanOrEqual(median + 6);
});
