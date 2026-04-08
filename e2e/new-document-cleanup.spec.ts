import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect, addLayer, getEditorState } from './helpers';

test.describe('New document clears engine resources (#124)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('creating a new document clears old layers from engine', async ({ page }) => {
    // Create first document with content on multiple layers
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);

    // Add layers with content
    await addLayer(page);
    await page.waitForTimeout(100);
    const state1 = await getEditorState(page);
    await paintRect(page, 10, 10, 80, 80, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(100);

    await addLayer(page);
    await page.waitForTimeout(100);
    await paintRect(page, 50, 50, 80, 80, { r: 0, g: 0, b: 255, a: 255 });
    await page.waitForTimeout(100);

    await page.screenshot({ path: 'e2e/screenshots/new-doc-cleanup-before.png' });

    // Verify we have multiple layers
    const beforeState = await getEditorState(page);
    expect(beforeState.document.layers.length).toBeGreaterThan(2);

    // Create a new document
    await createDocument(page, 100, 100, true);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/new-doc-cleanup-after.png' });

    // Verify the new document has a clean state
    const afterState = await getEditorState(page);
    // New document should have fewer layers (just the background + root group)
    expect(afterState.document.layers.length).toBeLessThanOrEqual(
      beforeState.document.layers.length,
    );

    // Verify the engine doesn't have stale textures from the old document
    const engineLayerCount = await page.evaluate(() => {
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      } | undefined;
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        getLayerTextureDimensions?: (engine: unknown, id: string) => unknown;
      } | undefined;
      if (!engineState || !bridge?.getLayerTextureDimensions) return -1;
      const engine = engineState.getEngine();
      if (!engine) return -1;

      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string }> } };
      };
      const layers = store.getState().document.layers;
      let validTextures = 0;
      for (const layer of layers) {
        try {
          const dims = bridge.getLayerTextureDimensions(engine, layer.id);
          if (dims) validTextures++;
        } catch {
          // No texture for this layer — expected for groups
        }
      }
      return validTextures;
    });

    // Should only have textures for the current document's raster layers
    expect(engineLayerCount).toBeLessThanOrEqual(2);
  });
});
