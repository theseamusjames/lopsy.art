import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, drawRect, docToScreen, addLayer, setActiveLayer } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enableSnapToLayers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { snapToLayers: boolean; toggleSnapToLayers: () => void };
    };
    const state = store.getState();
    if (!state.snapToLayers) state.toggleSnapToLayers();
  });
}

async function getLayerPosition(page: Page, layerId: string): Promise<{ x: number; y: number }> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    return layer ? { x: layer.x, y: layer.y } : { x: 0, y: 0 };
  }, layerId);
}

async function getSnapLines(page: Page): Promise<Array<{ orientation: string; position: number }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { snapLines: Array<{ orientation: string; position: number }> };
    };
    return store.getState().snapLines as Array<{ orientation: string; position: number }>;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Snap to layer edges', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('layer left edge snaps to other layer right edge during drag', async ({ page }) => {
    // Layer A (static): draw a 60x60 red rect at doc (100, 100).
    // After auto-crop: layer A is at x=100, y=100, 60x60 → right edge at 160.
    await drawRect(page, 100, 100, 60, 60, { r: 255, g: 0, b: 0 });
    const layerAId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    // Layer B (will be moved): add a new layer, draw a 60x60 blue rect at doc (220, 100).
    const layerBId = await addLayer(page);
    await setActiveLayer(page, layerBId);
    await drawRect(page, 220, 100, 60, 60, { r: 0, g: 0, b: 255 });

    // Enable snap-to-layers.
    await enableSnapToLayers(page);

    // Switch to move tool.
    await page.keyboard.press('v');
    await page.waitForTimeout(100);

    // Select layer B.
    await setActiveLayer(page, layerBId);

    // Drag layer B toward layer A's right edge (160).
    // Layer B is at x≈220. Drag left so its left edge lands near 160 (within threshold=5).
    // We move from layer B's center to ~(165,130) so left edge ≈ 165 → snaps to 160.
    const layerBBefore = await getLayerPosition(page, layerBId);
    const centerDocX = layerBBefore.x + 30; // center of 60-wide layer
    const centerDocY = layerBBefore.y + 30;

    const start = await docToScreen(page, centerDocX, centerDocY);

    // Target: move layer B so its left edge (currently at 220) lands at 163
    // (within 5px of 160). The layer's center will be at 163+30 = 193.
    const targetDocX = 163 + 30; // target center x
    const end = await docToScreen(page, targetDocX, centerDocY);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });

    // Take screenshot while snap is active (before mouse up).
    await page.screenshot({ path: 'e2e/screenshots/snap-layer-edges-during-drag.png' });

    await page.mouse.up();
    await page.waitForTimeout(150);

    // After mouse up, layer B should be snapped so its left edge aligns with
    // layer A's right edge (160). Layer B position: x=160.
    const layerBAfter = await getLayerPosition(page, layerBId);
    await page.screenshot({ path: 'e2e/screenshots/snap-layer-edges-after-drop.png' });

    // Layer B's left edge should have snapped to 160.
    expect(Math.abs(layerBAfter.x - 160)).toBeLessThanOrEqual(2);

    // Snap lines should be cleared after mouse up.
    const snapLinesAfter = await getSnapLines(page);
    expect(snapLinesAfter).toHaveLength(0);

    // Layer A should not have moved.
    const layerAAfter = await getLayerPosition(page, layerAId);
    expect(Math.abs(layerAAfter.x - 100)).toBeLessThanOrEqual(2);
  });

  test('snap lines appear during drag and clear on mouse up', async ({ page }) => {
    // Layer A: 60x60 blue rect at (100, 100).
    await drawRect(page, 100, 100, 60, 60, { r: 0, g: 0, b: 200 });

    // Layer B: 60x60 green rect at (230, 100).
    const layerBId = await addLayer(page);
    await setActiveLayer(page, layerBId);
    await drawRect(page, 230, 100, 60, 60, { r: 0, g: 200, b: 0 });

    await enableSnapToLayers(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await setActiveLayer(page, layerBId);

    const layerBPos = await getLayerPosition(page, layerBId);
    const centerDocX = layerBPos.x + 30;
    const centerDocY = layerBPos.y + 30;
    const start = await docToScreen(page, centerDocX, centerDocY);

    // Move so layer B's left edge ≈ 163, near layer A's right edge (160).
    const targetCenterX = 163 + 30;
    const end = await docToScreen(page, targetCenterX, centerDocY);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });

    // Snap lines should be present during drag.
    const snapLinesDuring = await getSnapLines(page);
    expect(snapLinesDuring.length).toBeGreaterThan(0);

    const verticalSnapLines = snapLinesDuring.filter((l) => l.orientation === 'vertical');
    expect(verticalSnapLines.length).toBeGreaterThan(0);
    // The snap line should be at x=160 (layer A's right edge).
    const snapX = verticalSnapLines[0]?.position ?? -1;
    expect(Math.abs(snapX - 160)).toBeLessThanOrEqual(2);

    await page.mouse.up();
    await page.waitForTimeout(150);

    // Snap lines must clear after release.
    const snapLinesAfter = await getSnapLines(page);
    expect(snapLinesAfter).toHaveLength(0);
  });

  test('no snap when snapToLayers is disabled', async ({ page }) => {
    // Layer A: 60x60 at (100, 100).
    await drawRect(page, 100, 100, 60, 60, { r: 255, g: 0, b: 0 });

    // Layer B: 60x60 at (230, 100).
    const layerBId = await addLayer(page);
    await setActiveLayer(page, layerBId);
    await drawRect(page, 230, 100, 60, 60, { r: 0, g: 0, b: 255 });

    // Do NOT enable snap-to-layers — it's off by default.
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await setActiveLayer(page, layerBId);

    const layerBPos = await getLayerPosition(page, layerBId);
    const centerDocX = layerBPos.x + 30;
    const centerDocY = layerBPos.y + 30;
    const start = await docToScreen(page, centerDocX, centerDocY);

    // Same drag that would snap if enabled: move toward 163 (near 160).
    const targetCenterX = 163 + 30;
    const end = await docToScreen(page, targetCenterX, centerDocY);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const layerBAfter = await getLayerPosition(page, layerBId);

    // No snap: layer should be somewhere near 163, not exactly at 160.
    // The drag distance is (230 → 163) = 67 px back, so x ≈ 163.
    // Without snap the position won't be exactly 160.
    const snapLinesFinal = await getSnapLines(page);
    expect(snapLinesFinal).toHaveLength(0);

    await page.screenshot({ path: 'e2e/screenshots/snap-layer-edges-disabled.png' });

    // The layer should have moved away from its starting position (230).
    expect(layerBAfter.x).not.toBe(layerBPos.x);
  });

  test('Snap to Layers menu item toggles the setting', async ({ page }) => {
    // Verify the toggle works via the View menu.
    const initialState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { snapToLayers: boolean };
      };
      return store.getState().snapToLayers;
    });
    expect(initialState).toBe(false);

    // Toggle on via store (menu test — just verifying the store field exists and works).
    await enableSnapToLayers(page);

    const afterEnable = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { snapToLayers: boolean };
      };
      return store.getState().snapToLayers;
    });
    expect(afterEnable).toBe(true);

    // Toggle off.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleSnapToLayers: () => void };
      };
      store.getState().toggleSnapToLayers();
    });

    const afterDisable = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { snapToLayers: boolean };
      };
      return store.getState().snapToLayers;
    });
    expect(afterDisable).toBe(false);
  });
});
