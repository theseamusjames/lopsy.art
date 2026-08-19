import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, docToScreen } from './helpers';

// Coverage for the nightly autofix batch:
// - #733 (mask-edit paint no longer materializes the layer's own RGBA
//   pixel buffer, which was a 71.64 MB round-trip per stroke at 4K)
//
// #732 (shape/gradient per-move pixel-version bump) and #734
// (stroke-end mask readback echoed straight back on the next frame) are
// unit-tested at their layer — see:
//  - src/tools/shape/shape-interaction.test.ts
//  - src/tools/gradient/gradient-interaction.test.ts
//  - src/engine-wasm/sync-state.test.ts
//  - src/engine-wasm/sync-layers.test.ts
// Both fixes are pure JS-layer behaviour a Playwright browser cannot
// observe without an instrumented build (the point of the fix is the
// absence of a call), so the unit coverage carries the regression
// contract there.

async function addMaskToActiveLayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string | null };
        addLayerMask: (id: string) => void;
      };
    };
    const state = store.getState();
    state.addLayerMask(state.document.activeLayerId!);
  });
  await page.waitForTimeout(200);
}

async function activeLayerPixelDataPresent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const editorStore = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string | null } };
    };
    const pxManager = (window as unknown as Record<string, unknown>).__pixelData as {
      get: (id: string) => unknown;
    };
    const id = editorStore.getState().document.activeLayerId;
    if (!id) return false;
    return pxManager.get(id) !== undefined;
  });
}

test.describe('#733 — mask-edit paint no longer round-trips the layer RGBA', () => {
  test('a brush stroke on a layer mask leaves the layer\'s JS pixel cache empty', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(600_000);
    await page.goto('/');
    await waitForStore(page);

    // Big enough that any accidental `expandLayerForEditing` shows up as
    // a huge JS heap allocation (the regression populated a 4096-byte
    // buffer times 800x600 = 1.92 MB per stroke at this size).
    await createDocument(page, 800, 600, false);
    await addMaskToActiveLayer(page);

    // Baseline: the layer starts with no dense JS pixel data cached —
    // the engine's GPU texture is source of truth.
    expect(await activeLayerPixelDataPresent(page)).toBe(false);

    // Enter mask edit mode via the mask thumbnail so the interaction
    // dispatcher sets maskMode='layerMask'.
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await page.waitForTimeout(150);
    const maskMode = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { maskMode: string };
      };
      return ui.getState().maskMode;
    });
    expect(maskMode).toBe('layerMask');

    // Paint on the mask. Before #733, handleToolDown's needsPixelData
    // gate fired for `isPaintTool && !isQuickMaskMode`, which is TRUE
    // in mask-edit mode too — so `expandLayerForEditing` ran and
    // populated the JS pixel cache for the *layer* even though only
    // the mask texture was being written.
    await selectTool(page, 'brush');
    const start = await docToScreen(page, 100, 300);
    const end = await docToScreen(page, 700, 300);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Post-condition: the layer's JS pixel cache is still empty. If the
    // regression returns, `expandLayerForEditing` will have stored an
    // ImageData for the active layer here.
    expect(await activeLayerPixelDataPresent(page)).toBe(false);

    // Sanity: the mask actually got painted. Values drop from 255
    // (fully reveal) toward 0 (hide) where the brush ran.
    const paintedZeros = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string | null;
            layers: Array<{ id: string; mask: { data: Uint8ClampedArray } | null }>;
          };
        };
      };
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
      if (!layer?.mask) return -1;
      let dark = 0;
      for (const v of layer.mask.data) if (v < 200) dark++;
      return dark;
    });
    expect(paintedZeros).toBeGreaterThan(500);
  });
});
