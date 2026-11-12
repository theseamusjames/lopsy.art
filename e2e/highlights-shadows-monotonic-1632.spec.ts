// #1632 — Highlights & Shadows added a flat offset whose weight reached 1 at
// the tonal end, so Highlights / Whites at −100 dragged white down to black
// while the quarter-tones below barely moved: the top of a black→white ramp
// folded back on itself. Shadows / Blacks at +100 did the mirror image at the
// dark end. Every control must now leave the ramp monotonic.

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { addAdjustment, createDocument, docToScreen, getRootGroupId, waitForStore } from './helpers';

const DOC_W = 800;
const DOC_H = 200;

async function drawBlackToWhiteGradient(page: Page): Promise<void> {
  await page.locator('[data-tool-id="gradient"]').click();
  const start = await docToScreen(page, 0, DOC_H / 2);
  const end = await docToScreen(page, DOC_W - 1, DOC_H / 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function sampleRowRed(page: Page): Promise<number[]> {
  return page.evaluate(async ({ docW }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return [];
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number } };
    };
    const { zoom, panX, panY } = store.getState().viewport;
    const sy = Math.round(panY + result.height / 2);
    const flippedY = result.height - 1 - sy;
    const reds: number[] = [];
    for (let x = 4; x < docW - 4; x += 4) {
      const sx = Math.round((x - docW / 2) * zoom + panX + result.width / 2);
      reds.push(result.pixels[(flippedY * result.width + sx) * 4] ?? -1);
    }
    return reds;
  }, { docW: DOC_W });
}

function largestDrop(values: number[]): number {
  let drop = 0;
  let peak = values[0] ?? 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    drop = Math.max(drop, peak - v);
  }
  return drop;
}

const CASES: Array<{ name: string; values: Record<string, number> }> = [
  { name: 'Highlights −100', values: { highlights: -100 } },
  { name: 'Whites −100', values: { whites: -100 } },
  { name: 'Shadows +100', values: { shadows: 100 } },
  { name: 'Blacks +100', values: { blacks: 100 } },
  { name: 'all four at once', values: { highlights: -100, shadows: 100, whites: -100, blacks: 100 } },
];

test.describe('#1632 Highlights & Shadows keeps the tone curve monotonic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);
    await page.waitForTimeout(300);
    await drawBlackToWhiteGradient(page);
  });

  for (const { name, values } of CASES) {
    test(name, async ({ page }) => {
      const before = await sampleRowRed(page);
      expect(before[0]).toBeLessThan(20);
      expect(before[before.length - 1]).toBeGreaterThan(235);
      expect(largestDrop(before)).toBeLessThanOrEqual(3);

      await addAdjustment(page, await getRootGroupId(page), 'highlights-shadows', values);
      await page.waitForTimeout(300);

      const after = await sampleRowRed(page);
      expect(after).not.toEqual(before);
      // The gradient's dither wiggles by a level or two; the fold this
      // guards against dropped the ramp by well over 100 levels.
      expect(largestDrop(after)).toBeLessThanOrEqual(3);
      expect(after[after.length - 1]!).toBeGreaterThan(after[0]!);
    });
  }
});
