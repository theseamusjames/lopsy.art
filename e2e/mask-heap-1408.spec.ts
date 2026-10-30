/**
 * #1408 — on an 1800×1200 document, Add Mask grew the JS heap by ~0.5 GB
 * and every mask filter, undo and redo by ~1.4 GB of transient garbage;
 * a few in a row ran the tab out of memory.
 *
 * Each step is driven through the UI. Before a step the heap is
 * garbage-collected; ~800 ms after it, `JSHeapUsedSize` is read *without*
 * collecting, so the delta is everything the step allocated, transient
 * garbage included — which is what ran the tab out of memory.
 */
import { test, expect, type Page } from './fixtures';
import type { CDPSession } from '@playwright/test';
import { waitForStore, createDocument, drawRect, applyFilter, getEditorState } from './helpers';

const DOC_W = 1800;
const DOC_H = 1200;
const MB = 1024 * 1024;
/**
 * A full-document mask is 2.16 MB of bytes at this size, so a step that
 * copies it a handful of times stays far under this. Before the fix the
 * mask steps grew the heap by 500–1400 MB.
 */
const MAX_STEP_GROWTH_MB = 100;

async function usedHeap(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const used = metrics.find((m) => m.name === 'JSHeapUsedSize');
  if (!used) throw new Error('JSHeapUsedSize metric missing');
  return used.value;
}

async function measureStep(page: Page, cdp: CDPSession, step: () => Promise<void>): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await usedHeap(cdp);
  await step();
  await page.waitForTimeout(800);
  const after = await usedHeap(cdp);
  return (after - before) / MB;
}

async function maskMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { maskMode: string };
    };
    return ui.getState().maskMode;
  });
}

async function lastHistoryLabel(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label;
  });
}

test.describe('#1408 — layer-mask operations do not balloon the JS heap', () => {
  test('Add Mask, mask filters, undo and redo each grow the heap by well under 100 MB', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'CDP heap metrics require Chromium');
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(300_000);

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);
    await page.waitForTimeout(300);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    const layerId = (await getEditorState(page)).document.activeLayerId!;
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    const editMask = page.locator('[aria-label="Edit mask for Layer 1"]');
    await drawRect(page, 300, 200, 1200, 800, { r: 200, g: 40, b: 40 });

    const growth: Record<string, number> = {};

    growth.addMask = await measureStep(page, cdp, async () => {
      await page.locator('[aria-label="Add Mask"]').click();
      await expect(editMask).toBeVisible();
    });

    growth.enterMaskEdit = await measureStep(page, cdp, async () => {
      await editMask.click();
      await expect.poll(() => maskMode(page)).toBe('layerMask');
    });

    growth.clouds = await measureStep(page, cdp, async () => {
      await applyFilter(page, 'Clouds...', { Scale: 8 });
      await expect.poll(() => lastHistoryLabel(page)).toBe('Clouds');
    });

    growth.brightnessContrast = await measureStep(page, cdp, async () => {
      await applyFilter(page, 'Brightness/Contrast...', { Brightness: 55, Contrast: -45 });
      await expect.poll(() => lastHistoryLabel(page)).toBe('Brightness/Contrast');
    });

    growth.leaveMaskEdit = await measureStep(page, cdp, async () => {
      await row.getByText('Layer 1', { exact: true }).click();
      await expect.poll(() => maskMode(page)).toBe('off');
    });

    growth.undo = await measureStep(page, cdp, async () => {
      await page.keyboard.press('Control+z');
      await expect.poll(() => lastHistoryLabel(page)).toBe('Clouds');
    });

    growth.redo = await measureStep(page, cdp, async () => {
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(() => lastHistoryLabel(page)).toBe('Brightness/Contrast');
    });

    console.log('[#1408] JS heap growth per step (MB):', JSON.stringify(
      Object.fromEntries(Object.entries(growth).map(([k, v]) => [k, Math.round(v)])),
    ));
    await page.screenshot({ path: 'e2e/screenshots/mask-heap-1408.png' });

    for (const [step, mb] of Object.entries(growth)) {
      expect(mb, `${step} grew the JS heap by ${mb.toFixed(0)} MB`).toBeLessThan(MAX_STEP_GROWTH_MB);
    }
  });
});
