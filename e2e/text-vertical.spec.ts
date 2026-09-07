// E2E tests for the vertical text option (#751).
//
// Strategy: mirror text-decorations.spec.ts. Enable the vertical toggle via
// the options bar, commit two text layers (one horizontal, one vertical) with
// the SAME string, then read their GPU texture dimensions. Vertical text
// should be taller than it is wide, whereas the horizontal version should be
// the other way around.

import { test, expect } from '@playwright/test';
import {
  createDocument,
  setForegroundColor,
  selectTool,
  docToScreen,
  waitForStore,
} from './helpers';

async function readLayerDims(
  page: import('@playwright/test').Page,
  layerId: string,
): Promise<{ width: number; height: number }> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as {
      __readLayerPixels: (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    const r = await readFn(id);
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  }, layerId);
}

async function clickVerticalToggle(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[aria-label="Toggle vertical text"]').click();
}

async function typeAndCommitText(
  page: import('@playwright/test').Page,
  text: string,
  docX: number,
  docY: number,
): Promise<string> {
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(50);
  await selectTool(page, 'text');
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(200);
  await page.keyboard.type(text);
  await page.waitForTimeout(200);
  await page.locator('[data-tool-id="move"]').click();
  await page.waitForTimeout(300);
  const layerId = await page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string; name: string }> } } };
    }).__editorStore.getState();
    const textLayers = store.document.layers.filter((l) => l.type === 'text');
    return textLayers.at(-1)?.id ?? null;
  });
  expect(layerId).not.toBeNull();
  return layerId!;
}

test.describe('vertical text (#751)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text tool requires keyboard, not available on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await setForegroundColor(page, 255, 255, 255);
    await selectTool(page, 'text');
    // Make sure vertical starts off.
    const btn = page.locator('[aria-label="Toggle vertical text"]');
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      if ((await btn.getAttribute('aria-pressed')) === 'true') await btn.click();
    }
  });

  test('vertical toggle is visible in the text options bar', async ({ page }) => {
    await selectTool(page, 'text');
    const btn = page.locator('[aria-label="Toggle vertical text"]');
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('aria-pressed')).toBe('false');

    await btn.click();
    expect(await btn.getAttribute('aria-pressed')).toBe('true');

    await page.screenshot({ path: 'e2e/screenshots/text-vertical-toggle.png' });
  });

  test('vertical text renders taller than wide, horizontal is wider than tall', async ({ page }) => {
    // Horizontal render of "ABCDE": should be a wide row.
    const horizId = await typeAndCommitText(page, 'ABCDE', 400, 200);
    const horizDims = await readLayerDims(page, horizId);
    expect(horizDims.width).toBeGreaterThan(horizDims.height);

    await page.screenshot({ path: 'e2e/screenshots/text-vertical-horizontal-baseline.png' });

    // Vertical render of "ABCDE": should stack into a tall column.
    await selectTool(page, 'text');
    await clickVerticalToggle(page);
    const vertId = await typeAndCommitText(page, 'ABCDE', 400, 400);
    const vertDims = await readLayerDims(page, vertId);

    await page.screenshot({ path: 'e2e/screenshots/text-vertical-column.png' });

    expect(vertDims.height).toBeGreaterThan(vertDims.width);
    // Committed layer stays type: 'text'.
    const layerType = await page.evaluate((id) => {
      const store = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; type: string }> } } };
      }).__editorStore.getState();
      return store.document.layers.find((l) => l.id === id)?.type ?? null;
    }, vertId);
    expect(layerType).toBe('text');

    // The vertical field is stored on the layer.
    const vertical = await page.evaluate((id) => {
      const store = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; vertical?: boolean }> } } };
      }).__editorStore.getState();
      return store.document.layers.find((l) => l.id === id)?.vertical ?? false;
    }, vertId);
    expect(vertical).toBe(true);
  });

  test('vertical text with a newline stacks into two side-by-side columns', async ({ page }) => {
    await selectTool(page, 'text');
    await clickVerticalToggle(page);

    // Two lines of 3 glyphs each → two columns. Total width should exceed
    // one column's width; total height should reflect ~3 rows (not 6).
    const vertId = await typeAndCommitText(page, 'ABC\nDEF', 400, 300);
    const vertDims = await readLayerDims(page, vertId);
    await page.screenshot({ path: 'e2e/screenshots/text-vertical-two-columns.png' });

    // Compare to a single-column render of "ABC".
    // Toggle off, then back on for the second layer? Just use the current
    // vertical layer as baseline is enough — we know column width ~= font_size.
    // Height should approximate 3 × (font_size + letter_spacing), width should
    // approximate 2 × (font_size × lineHeight). Assert the aspect: two columns
    // means the layer is wider than a single-column render of the same 3 glyphs.
    const singleColId = await typeAndCommitText(page, 'ABC', 200, 300);
    const singleDims = await readLayerDims(page, singleColId);
    expect(vertDims.width).toBeGreaterThan(singleDims.width);
    // But height should be roughly similar (both stack 3 glyphs).
    expect(vertDims.height).toBeGreaterThan(singleDims.height * 0.5);
    expect(vertDims.height).toBeLessThan(singleDims.height * 1.5);
  });
});
