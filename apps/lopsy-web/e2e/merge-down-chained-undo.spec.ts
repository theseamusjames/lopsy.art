/**
 * Regression for #921: undo of two chained Merge Downs starting from a
 * rasterized text layer restored the middle layer holding the *merged*
 * pixels (a ghost of the layer that was merged into it) at a doubled
 * offset, instead of its own pre-merge content.
 *
 * Root cause: `mergeDown()` called `computeMergeDown()` — which mutates
 * the below-layer's GPU texture in place via `mergeLayers` — *before*
 * `pushHistory()`. The undo snapshot for "state before this merge" was
 * therefore sometimes taken from the below layer's texture *after* it had
 * already been merged into, whenever `snapshotGpuLayers`'s handle-reuse
 * shortcut didn't apply (which happens for a just-rasterized text layer,
 * since `Rasterize Layer` nudges the layer's x/y by a few px, breaking the
 * reuse check's position match). See merge-down.ts's #921 comment and
 * document-slice.ts's `mergeDown` action.
 *
 * Repro (from the issue): 600x400 doc, Layer 1 filled with a rectangle,
 * two rasterized text layers (VALUE, LABEL) added above it. Merge VALUE
 * down into LABEL, then LABEL down into Layer 1. Undo twice. LABEL and
 * VALUE must both come back holding only their own original text, at
 * their original positions — not a merged ghost at a shifted position.
 */
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, drawRect, setForegroundColor, docToScreen } from './helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function typeTextLayer(
  page: Page,
  docX: number,
  docY: number,
  text: string,
): Promise<void> {
  await page.keyboard.press('t');
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(200);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
}

/** Absolute (document-space) opaque-pixel bounding box + count for a layer. */
async function readContentBBox(page: Page, layerId: string) {
  return page.evaluate(async (lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const r = await readFn(lid);
    if (!r || r.width === 0) return null;
    let minX = r.width;
    let minY = r.height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const a = r.pixels[(y * r.width + x) * 4 + 3] ?? 0;
        if (a > 10) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    return {
      count,
      absMinX: lx + minX,
      absMinY: ly + minY,
      absMaxX: lx + maxX,
      absMaxY: ly + maxY,
    };
  }, layerId);
}

test.describe('Merge Down — chained undo restores exact content (#921)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('undoing two chained Merge Downs restores both rasterized text layers exactly', async ({ page }) => {
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(300);

    // The fresh document's single raster layer stands in for "Layer 1" —
    // give it its own fill, matching the issue's rectangle-fill step.
    const layer1Id = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    await drawRect(page, 100, 100, 400, 200, { r: 255, g: 220, b: 60 });

    // VALUE, then LABEL — both added above Layer 1, both rasterized. Each
    // "click Layer 1's row, place text" step matters: it deactivates the
    // previous text layer (VALUE) before creating the next one, matching
    // the issue's exact repro and layer order (top -> bottom: VALUE,
    // LABEL, Layer 1, Background).
    await setForegroundColor(page, 20, 20, 20);
    await typeTextLayer(page, 130, 180, 'VALUE');
    const valueId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string }> } };
      };
      return store.getState().document.layers.find((l) => l.type === 'text')!.id;
    });
    await page.locator('[aria-label="Rasterize Layer"]').click();
    await page.waitForTimeout(300);

    await page.locator(`[data-layer-id="${layer1Id}"]`).click();
    await page.waitForTimeout(100);
    await typeTextLayer(page, 130, 110, 'LABEL');
    const labelId = await page.evaluate((vid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string }> } };
      };
      return store.getState().document.layers.find((l) => l.type === 'text' && l.id !== vid)!.id;
    }, valueId);
    await page.locator('[aria-label="Rasterize Layer"]').click();
    await page.waitForTimeout(300);

    // Baselines: each layer's own content, before either merge touches it.
    const valueBaseline = await readContentBBox(page, valueId);
    const labelBaseline = await readContentBBox(page, labelId);
    expect(valueBaseline).not.toBeNull();
    expect(labelBaseline).not.toBeNull();
    expect(valueBaseline!.count).toBeGreaterThan(0);
    expect(labelBaseline!.count).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/merge-down-chained-undo-before.png' });

    // Merge VALUE -> LABEL, then LABEL -> Layer 1.
    await page.locator(`[data-layer-id="${valueId}"]`).click();
    await page.waitForTimeout(100);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(300);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(300);

    // Both text layers are gone, merged into Layer 1.
    const afterMerges = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string }> } };
      };
      return store.getState().document.layers.map((l) => l.id);
    });
    expect(afterMerges).not.toContain(valueId);
    expect(afterMerges).not.toContain(labelId);

    await page.screenshot({ path: 'e2e/screenshots/merge-down-chained-undo-merged.png' });

    // Undo both merges.
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForTimeout(300);
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/merge-down-chained-undo-after.png' });

    const layersAfterUndo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string }> } };
      };
      return store.getState().document.layers.map((l) => l.id);
    });
    expect(layersAfterUndo).toContain(valueId);
    expect(layersAfterUndo).toContain(labelId);

    const valueAfterUndo = await readContentBBox(page, valueId);
    const labelAfterUndo = await readContentBBox(page, labelId);
    expect(valueAfterUndo).not.toBeNull();
    expect(labelAfterUndo).not.toBeNull();

    // The bug: LABEL's restored content included VALUE's glyphs too (a
    // "ghost"), roughly doubling both its pixel count and its bounding-box
    // offset. The fix restores LABEL to exactly its own pre-merge content —
    // same absolute position and pixel count as the baseline, regardless of
    // whatever texture size the layer happens to have been expanded/cropped
    // to by the unrelated active-layer memory optimization.
    expect(labelAfterUndo!.count).toBe(labelBaseline!.count);
    expect(labelAfterUndo!.absMinX).toBe(labelBaseline!.absMinX);
    expect(labelAfterUndo!.absMinY).toBe(labelBaseline!.absMinY);
    expect(labelAfterUndo!.absMaxX).toBe(labelBaseline!.absMaxX);
    expect(labelAfterUndo!.absMaxY).toBe(labelBaseline!.absMaxY);

    expect(valueAfterUndo!.count).toBe(valueBaseline!.count);
    expect(valueAfterUndo!.absMinX).toBe(valueBaseline!.absMinX);
    expect(valueAfterUndo!.absMinY).toBe(valueBaseline!.absMinY);
    expect(valueAfterUndo!.absMaxX).toBe(valueBaseline!.absMaxX);
    expect(valueAfterUndo!.absMaxY).toBe(valueBaseline!.absMaxY);

    // Hiding VALUE must not reveal a "VALUE" ghost baked into LABEL: LABEL's
    // own pixel count already matching its baseline (above) covers this,
    // but also assert directly that LABEL's bounding box doesn't reach down
    // into VALUE's original (lower) region.
    expect(labelAfterUndo!.absMaxY).toBeLessThan(valueBaseline!.absMinY);
  });
});
