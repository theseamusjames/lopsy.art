import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect, addLayer, getEditorState } from './helpers';

test.describe('New document clears engine resources (#124)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('creating a new document clears old layers from engine', async ({ page }) => {
    // Guard: skip if the WASM bridge is not available
    const hasWasmBridge = await page.evaluate(() => {
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      } | undefined;
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        getLayerTextureDimensions?: (engine: unknown, id: string) => unknown;
      } | undefined;
      return !!(engineState?.getEngine() && bridge?.getLayerTextureDimensions);
    });
    if (!hasWasmBridge) {
      test.skip(true, 'WASM bridge not available — cannot verify GPU texture cleanup');
      return;
    }

    // Create first document with content on multiple layers
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);

    // Add layers with content
    await addLayer(page);
    await page.waitForTimeout(100);
    await paintRect(page, 10, 10, 80, 80, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(100);

    await addLayer(page);
    await page.waitForTimeout(100);
    await paintRect(page, 50, 50, 80, 80, { r: 0, g: 0, b: 255, a: 255 });
    await page.waitForTimeout(100);

    await page.screenshot({ path: 'e2e/screenshots/new-doc-cleanup-before.png' });

    // Verify we have multiple layers and capture old layer IDs
    const beforeState = await getEditorState(page);
    expect(beforeState.document.layers.length).toBeGreaterThan(2);
    const oldLayerIds = beforeState.document.layers.map((l) => l.id);

    // Create a new document
    await createDocument(page, 100, 100, true);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/new-doc-cleanup-after.png' });

    // Verify the new document has a clean state
    const afterState = await getEditorState(page);
    expect(afterState.document.layers.length).toBeGreaterThan(0);

    // Verify old layer textures were released from the engine
    const staleTextures = await page.evaluate((ids: string[]) => {
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      };
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        getLayerTextureDimensions: (engine: unknown, id: string) => unknown;
      };
      const engine = engineState.getEngine();
      const stale: string[] = [];
      for (const id of ids) {
        try {
          const dims = bridge.getLayerTextureDimensions(engine, id);
          if (dims) stale.push(id);
        } catch {
          // No texture — expected, the layer was cleaned up
        }
      }
      return stale;
    }, oldLayerIds);

    expect(staleTextures, 'Old layer textures should be released after creating a new document').toEqual([]);
  });
});
