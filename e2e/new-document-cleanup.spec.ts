import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect, addLayer, getEditorState } from './helpers';

test.describe('New document clears engine resources (#124)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('creating a new document removes old layer textures from the engine', async ({ page }) => {
    // Build a document with two raster layers, both painted, so we have
    // multiple GPU textures attached to the engine.
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);

    await addLayer(page);
    await page.waitForTimeout(100);
    await paintRect(page, 10, 10, 80, 80, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(100);

    await addLayer(page);
    await page.waitForTimeout(100);
    await paintRect(page, 50, 50, 80, 80, { r: 0, g: 0, b: 255, a: 255 });
    await page.waitForTimeout(100);

    // Snapshot the old layer IDs and verify each one has live GPU texture
    // pixels right now (so the assertion below — that they're gone after
    // createDocument — is meaningful).
    const before = await getEditorState(page);
    const oldRasterIds = before.document.layers.filter((l) => l.id !== before.document.activeLayerId || true)
      .map((l) => l.id);
    expect(oldRasterIds.length).toBeGreaterThan(2);

    const beforeReads = await page.evaluate(async (ids: string[]) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result: Record<string, { width: number; height: number; pixelCount: number } | null> = {};
      for (const id of ids) {
        const px = await readFn(id);
        result[id] = px ? { width: px.width, height: px.height, pixelCount: px.pixels.length } : null;
      }
      return result;
    }, oldRasterIds);

    // At least the layers we painted on must have non-empty texture pixels
    // before we create the new document.
    const sizesBefore = Object.values(beforeReads).filter((r) => r && r.width > 0);
    expect(sizesBefore.length).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/new-doc-cleanup-before.png' });

    // Create a brand-new document. The old document's layers must be
    // dropped from both the JS store AND the engine's texture pool.
    await createDocument(page, 100, 100, true);
    await page.waitForTimeout(400);

    await page.screenshot({ path: 'e2e/screenshots/new-doc-cleanup-after.png' });

    // Verify the new document has its own (different) layer set.
    const after = await getEditorState(page);
    expect(after.document.layers.length).toBeGreaterThan(0);
    const newIds = new Set(after.document.layers.map((l) => l.id));
    for (const oldId of oldRasterIds) {
      expect(newIds.has(oldId)).toBe(false);
    }

    // For every old layer ID, the engine must no longer have any pixel
    // data — readLayerPixels returns {width:0, height:0, pixels:[]} when
    // the texture isn't tracked. We tolerate either null or zero-width.
    const afterReads = await page.evaluate(async (ids: string[]) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result: Record<string, { width: number; height: number; pixelCount: number } | null> = {};
      for (const id of ids) {
        const px = await readFn(id);
        result[id] = px ? { width: px.width, height: px.height, pixelCount: px.pixels.length } : null;
      }
      return result;
    }, oldRasterIds);

    for (const [id, res] of Object.entries(afterReads)) {
      // Either no result, or an empty result. A non-zero width means a
      // stale texture is still present in the engine.
      const present = res !== null && res.width > 0 && res.pixelCount > 0;
      expect(present, `old layer ${id} still has GPU pixels after new document`).toBe(false);
    }
  });
});
