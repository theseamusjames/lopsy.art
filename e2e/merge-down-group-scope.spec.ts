/**
 * Regression for #920: Merge Down on a group's bottom child merged it into
 * the layer sitting below the group in the flat layer stack, instead of
 * being refused. That pulled the child out of its group entirely — if the
 * group was hidden, the child's (previously hidden) content reappeared on
 * canvas.
 *
 * Root cause: `computeMergeDown` picked its merge target purely from
 * `layerOrder`'s flat, bottom-to-top order, with no check that the layer
 * below shares the active layer's parent. See `canMergeDown` in
 * merge-down.ts.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, drawRect, getEditorState, getPixelAt } from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

/**
 * Count pixels in the full composited screen buffer that are clearly
 * blue-dominant (the group child's fill color) vs clearly red-dominant
 * (Layer 1's fill color). Counting by color across the whole buffer avoids
 * needing to replicate the doc-space -> screen-space -> readback-buffer
 * projection (zoom, pan, device pixel ratio) that `__readCompositedPixels`
 * doesn't apply for the caller.
 */
async function countColorDominantPixels(page: Page) {
  return page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const snap = await readFn();
    if (!snap) return { blue: 0, red: 0 };
    let blue = 0;
    let red = 0;
    for (let i = 0; i < snap.pixels.length; i += 4) {
      const r = snap.pixels[i] ?? 0;
      const g = snap.pixels[i + 1] ?? 0;
      const b = snap.pixels[i + 2] ?? 0;
      const a = snap.pixels[i + 3] ?? 0;
      if (a < 10) continue;
      if (b > 150 && b > r + 50 && b > g + 50) blue++;
      if (r > 150 && r > b + 50 && r > g + 50) red++;
    }
    return { blue, red };
  });
}

test.describe('Merge Down — refused out of a group (#920)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('bottom child of a hidden group cannot Merge Down into the layer below the group', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);

    // "Layer 1" — a plain red-filled raster layer, sibling of the group
    // we're about to create (both live directly under the root group).
    const state0 = await getEditorState(page);
    const layer1Id = state0.document.activeLayerId;
    await drawRect(page, 0, 0, 400, 300, { r: 220, g: 20, b: 20 });
    await page.waitForTimeout(200);

    const layer1Fill = await getPixelAt(page, 200, 150, layer1Id);
    expect(layer1Fill.r).toBeGreaterThan(150);
    expect(layer1Fill.a).toBeGreaterThan(150);

    // New Group (inserted directly above Layer 1), then Add Layer inside it
    // — the group's only, and therefore bottom, child.
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(200);
    const groupId = (await getEditorState(page)).document.activeLayerId;

    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(200);
    const childId = (await getEditorState(page)).document.activeLayerId;

    const afterAdd = await getEditorState(page);
    const group = afterAdd.document.layers.find((l) => l.id === groupId) as unknown as
      { children: string[] } | undefined;
    expect(group?.children).toEqual([childId]);

    await drawRect(page, 0, 0, 400, 300, { r: 20, g: 60, b: 220 });
    await page.waitForTimeout(200);

    const childFill = await getPixelAt(page, 200, 150, childId);
    expect(childFill.b).toBeGreaterThan(150);
    expect(childFill.a).toBeGreaterThan(150);

    // With the group visible, the composite should be overwhelmingly blue
    // (the child fully covers Layer 1's red).
    const withGroupVisible = await countColorDominantPixels(page);
    expect(withGroupVisible.blue).toBeGreaterThan(1000);
    expect(withGroupVisible.red).toBeLessThan(50);

    // Hide the group — blue disappears, red (Layer 1, below the group)
    // shows through.
    await page.locator(`[data-layer-id="${groupId}"]`)
      .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
      .click();
    await page.waitForTimeout(200);

    const withGroupHidden = await countColorDominantPixels(page);
    expect(withGroupHidden.red).toBeGreaterThan(1000);
    expect(withGroupHidden.blue).toBeLessThan(50);

    await page.screenshot({ path: 'e2e/screenshots/merge-down-group-scope-hidden.png' });

    // Select the group's (only, bottom) child and try Merge Down. There is
    // no sibling below it inside the group, so this must be refused rather
    // than falling through to Layer 1 outside the group.
    await page.locator(`[data-layer-id="${childId}"]`).click();
    await page.waitForTimeout(100);
    const beforeMerge = await getEditorState(page);

    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(300);

    const afterMerge = await getEditorState(page);
    expect(afterMerge.document.layers).toHaveLength(beforeMerge.document.layers.length);
    expect(afterMerge.document.layerOrder).toEqual(beforeMerge.document.layerOrder);
    expect(afterMerge.undoStackLength).toBe(beforeMerge.undoStackLength);

    const groupAfterMerge = afterMerge.document.layers.find((l) => l.id === groupId) as unknown as
      { children: string[] } | undefined;
    expect(groupAfterMerge?.children).toEqual([childId]);
    expect(afterMerge.document.layers.some((l) => l.id === layer1Id)).toBe(true);

    // The group is still hidden — the composite must still be plain red,
    // never blue. This is the actual user-visible regression: a refused (or
    // correctly scoped) merge must never un-hide the group's content.
    await page.screenshot({ path: 'e2e/screenshots/merge-down-group-scope-after-merge-attempt.png' });
    const afterMergeAttempt = await countColorDominantPixels(page);
    expect(afterMergeAttempt.red).toBeGreaterThan(1000);
    expect(afterMergeAttempt.blue).toBeLessThan(50);

    // The child's own content must be untouched and still where it was.
    const childFillAfter = await getPixelAt(page, 200, 150, childId);
    expect(childFillAfter.b).toBeGreaterThan(150);
  });
});
