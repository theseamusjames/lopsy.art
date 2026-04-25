import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  getEditorState,
  getPixelAt,
  paintRect,
  addLayer,
  undo,
  redo,
} from './helpers';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ===========================================================================
// Basic Undo/Redo
// ===========================================================================

test.describe('History - Basic Undo/Redo', () => {
  test('undo restores previous state after adding a layer', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    expect(s0.document.layers).toHaveLength(2);

    await addLayer(page);
    const s1 = await getEditorState(page);
    expect(s1.document.layers).toHaveLength(3);

    await undo(page);
    const s2 = await getEditorState(page);
    expect(s2.document.layers).toHaveLength(2);
  });

  test('redo restores undone state', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await addLayer(page);
    const s1 = await getEditorState(page);
    expect(s1.document.layers).toHaveLength(3);

    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    await redo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(3);
  });

  test('new edit after undo clears redo stack', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await addLayer(page);
    await addLayer(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(4);

    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(3);
    expect((await getEditorState(page)).redoStackLength).toBe(1);

    // New edit should clear redo
    await addLayer(page);
    const s = await getEditorState(page);
    expect(s.document.layers).toHaveLength(4);
    expect(s.redoStackLength).toBe(0);
  });
});

// ===========================================================================
// Multi-Step Undo/Redo with Multiple Layers
// ===========================================================================

test.describe('History - Multi-Step Operations', () => {
  test('undo through paint, add layer, paint, merge sequence', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Step 1: Paint red on bg
    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Step 2: Add layer
    await addLayer(page);
    const s1 = await getEditorState(page);
    const topId = s1.document.activeLayerId;

    // Step 3: Paint blue on top
    await paintRect(page, 25, 25, 50, 50, { r: 0, g: 0, b: 255, a: 255 }, topId);

    // Step 4: Merge down
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { mergeDown: () => void };
      };
      store.getState().mergeDown();
    });

    const merged = await getEditorState(page);
    expect(merged.document.layers).toHaveLength(2);

    // Undo merge -> should have 2 layers
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(3);

    // Undo paint on top -> top layer should be empty
    await undo(page);
    const topPixel = await getPixelAt(page, 30, 30, topId);
    expect(topPixel.a).toBe(0);

    // Undo add layer -> back to 1 raster layer + group
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    // Undo paint on bg -> bg should be empty
    await undo(page);
    const bgPixel = await getPixelAt(page, 10, 10, bgId);
    expect(bgPixel.a).toBe(0);
  });

  test('redo all steps after undoing everything', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile || browserName === 'firefox', 'GPU texture/layer position race after cropLayerToContent');
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, bgId);
    await addLayer(page);
    const s1 = await getEditorState(page);
    const topId = s1.document.activeLayerId;
    await paintRect(page, 50, 50, 50, 50, { r: 0, g: 255, b: 0, a: 255 }, topId);

    // Undo everything
    await undo(page); // undo paint top
    await undo(page); // undo add layer
    await undo(page); // undo paint bg

    const empty = await getEditorState(page);
    expect(empty.document.layers).toHaveLength(2);
    expect(empty.redoStackLength).toBe(3);

    // Redo everything
    await redo(page); // redo paint bg
    const bgPixel = await getPixelAt(page, 10, 10, bgId);
    expect(bgPixel.r).toBe(255);

    await redo(page); // redo add layer
    expect((await getEditorState(page)).document.layers).toHaveLength(3);

    await redo(page); // redo paint top
    const topPixel = await getPixelAt(page, 60, 60, topId);
    expect(topPixel.g).toBe(255);
  });
});

// ===========================================================================
// Visibility Toggle Undo
// ===========================================================================

test.describe('History - Layer Visibility', () => {
  test('toggling visibility is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;
    expect(s0.document.layers[0]!.visible).toBe(true);

    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { toggleLayerVisibility: (id: string) => void };
        };
        store.getState().toggleLayerVisibility(id);
      },
      layerId,
    );

    expect((await getEditorState(page)).document.layers[0]!.visible).toBe(false);

    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.visible).toBe(true);
  });
});

// ===========================================================================
// Opacity Change Undo
// ===========================================================================

test.describe('History - Layer Opacity', () => {
  test('changing opacity is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    await page.evaluate(
      ({ id, opacity }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            pushHistory: (label?: string) => void;
            updateLayerOpacity: (id: string, opacity: number) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Change Opacity');
        state.updateLayerOpacity(id, opacity);
      },
      { id: layerId, opacity: 0.5 },
    );

    expect((await getEditorState(page)).document.layers[0]!.opacity).toBe(0.5);

    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.opacity).toBe(1);
  });
});

// ===========================================================================
// Effects Undo
// ===========================================================================

test.describe('History - Layer Effects', () => {
  test('updating effects is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        const newEffects = {
          ...layer.effects,
          dropShadow: { ...(layer.effects.dropShadow as Record<string, unknown>), enabled: true },
        };
        state.updateLayerEffects(id, newEffects as never);
      },
      layerId,
    );

    expect((await getEditorState(page)).document.layers[0]!.effects.dropShadow.enabled).toBe(true);

    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.effects.dropShadow.enabled).toBe(false);
  });
});

// ===========================================================================
// Mask Undo
// ===========================================================================

test.describe('History - Layer Masks', () => {
  test('adding a mask is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayerMask: (id: string) => void };
        };
        store.getState().addLayerMask(id);
      },
      layerId,
    );

    expect((await getEditorState(page)).document.layers[0]!.mask).not.toBeNull();

    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.mask).toBeNull();
  });

  test('removing a mask is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Add mask
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayerMask: (id: string) => void };
        };
        store.getState().addLayerMask(id);
      },
      layerId,
    );

    // Remove mask
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { removeLayerMask: (id: string) => void };
        };
        store.getState().removeLayerMask(id);
      },
      layerId,
    );

    expect((await getEditorState(page)).document.layers[0]!.mask).toBeNull();

    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.mask).not.toBeNull();
  });

  test('toggling a mask is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Add mask
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayerMask: (id: string) => void };
        };
        store.getState().addLayerMask(id);
      },
      layerId,
    );

    expect((await getEditorState(page)).document.layers[0]!.mask!.enabled).toBe(true);

    // Toggle mask off
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { toggleLayerMask: (id: string) => void };
        };
        store.getState().toggleLayerMask(id);
      },
      layerId,
    );

    expect((await getEditorState(page)).document.layers[0]!.mask!.enabled).toBe(false);

    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.mask!.enabled).toBe(true);
  });
});

// ===========================================================================
// Complex Multi-Operation Sequences
// ===========================================================================

test.describe('History - Complex Sequences', () => {
  test('interleaved operations across multiple layers', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint on bg
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Add layer 2
    await addLayer(page);
    const s1 = await getEditorState(page);
    const layer2Id = s1.document.activeLayerId;

    // Paint on layer 2
    await paintRect(page, 0, 0, 50, 50, { r: 0, g: 255, b: 0, a: 255 }, layer2Id);

    // Toggle bg visibility
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { toggleLayerVisibility: (id: string) => void };
        };
        store.getState().toggleLayerVisibility(id);
      },
      bgId,
    );

    // Change layer 2 opacity
    await page.evaluate(
      ({ id, opacity }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            pushHistory: (label?: string) => void;
            updateLayerOpacity: (id: string, opacity: number) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Change Opacity');
        state.updateLayerOpacity(id, opacity);
      },
      { id: layer2Id, opacity: 0.75 },
    );

    // Add layer 3
    await addLayer(page);
    const s2 = await getEditorState(page);

    // Current state: 3 raster layers + group, bg invisible, layer2 at 0.75 opacity
    expect(s2.document.layers).toHaveLength(4);

    // Undo add layer 3
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(3);

    // Undo opacity change
    await undo(page);
    const afterUndoOpacity = await getEditorState(page);
    const l2 = afterUndoOpacity.document.layers.find((l) => l.id === layer2Id);
    expect(l2!.opacity).toBe(1);

    // Undo visibility toggle
    await undo(page);
    const afterUndoVis = await getEditorState(page);
    const bg = afterUndoVis.document.layers.find((l) => l.id === bgId);
    expect(bg!.visible).toBe(true);

    // Undo paint on layer 2
    await undo(page);
    const l2Pixel = await getPixelAt(page, 10, 10, layer2Id);
    expect(l2Pixel.a).toBe(0);

    // Undo add layer 2
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    // Undo paint on bg
    await undo(page);
    const bgPixel = await getPixelAt(page, 50, 50, bgId);
    expect(bgPixel.a).toBe(0);
  });

  test('undo after undo + new edit discards redo branch', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Step 1: Paint red
    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Step 2: Add layer
    await addLayer(page);

    // Step 3: Add another layer
    await addLayer(page);

    expect((await getEditorState(page)).document.layers).toHaveLength(4);

    // Undo twice (back to 1 raster layer + group + red paint)
    await undo(page);
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(2);
    expect((await getEditorState(page)).redoStackLength).toBe(2);

    // Paint blue (diverges from original history)
    await paintRect(page, 50, 50, 50, 50, { r: 0, g: 0, b: 255, a: 255 }, bgId);

    // Redo should be empty now
    expect((await getEditorState(page)).redoStackLength).toBe(0);

    // Undo the blue paint
    await undo(page);
    const pixel = await getPixelAt(page, 60, 60, bgId);
    expect(pixel.a).toBe(0);

    // Red paint should still be there
    const redPixel = await getPixelAt(page, 10, 10, bgId);
    expect(redPixel.r).toBe(255);
  });

  test('effects + merge down + undo sequence', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint bg
    await paintRect(page, 0, 0, 100, 100, { r: 100, g: 100, b: 100, a: 255 }, bgId);

    // Add layer and paint
    await addLayer(page);
    const s1 = await getEditorState(page);
    const topId = s1.document.activeLayerId;
    await paintRect(page, 10, 10, 30, 30, { r: 255, g: 0, b: 0, a: 255 }, topId);

    // Enable drop shadow on top layer
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        const newEffects = {
          ...layer.effects,
          dropShadow: { ...(layer.effects.dropShadow as Record<string, unknown>), enabled: true },
        };
        state.updateLayerEffects(id, newEffects as never);
      },
      topId,
    );

    // Merge down
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { mergeDown: () => void };
      };
      store.getState().mergeDown();
    });

    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    // Undo merge -> 2 raster layers + group, top should still have drop shadow
    await undo(page);
    const afterUndoMerge = await getEditorState(page);
    expect(afterUndoMerge.document.layers).toHaveLength(3);
    const topLayer = afterUndoMerge.document.layers.find((l) => l.id === topId);
    expect(topLayer!.effects.dropShadow.enabled).toBe(true);

    // Undo effects -> drop shadow disabled
    await undo(page);
    const afterUndoFx = await getEditorState(page);
    const topAfterFx = afterUndoFx.document.layers.find((l) => l.id === topId);
    expect(topAfterFx!.effects.dropShadow.enabled).toBe(false);
  });

  test('duplicate layer + delete + undo sequence', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint on bg
    await paintRect(page, 0, 0, 100, 100, { r: 128, g: 64, b: 32, a: 255 }, bgId);

    // Duplicate layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { duplicateLayer: () => void };
      };
      store.getState().duplicateLayer();
    });

    const afterDup = await getEditorState(page);
    expect(afterDup.document.layers).toHaveLength(3);
    const dupId = afterDup.document.activeLayerId;

    // Verify duplicate has same pixel data
    const dupPixel = await getPixelAt(page, 50, 50, dupId);
    expect(dupPixel.r).toBe(128);

    // Delete the duplicate
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { removeLayer: (id: string) => void };
        };
        store.getState().removeLayer(id);
      },
      dupId,
    );

    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    // Undo delete -> should restore duplicate
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(3);

    // Undo duplicate -> back to 1 raster + group
    await undo(page);
    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    // Original bg should still have its content
    const bgPixel = await getPixelAt(page, 50, 50, bgId);
    expect(bgPixel.r).toBe(128);
  });

  test('rapid undo/redo cycles preserve data integrity', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const s0 = await getEditorState(page);
    const baseline = s0.undoStackLength;

    // Build up 5 history entries
    for (let i = 0; i < 5; i++) {
      await paintRect(page, i * 20, 0, 20, 20, { r: 255, g: 0, b: 0, a: 255 });
    }

    const s1 = await getEditorState(page);
    expect(s1.undoStackLength).toBe(baseline + 5);

    // Undo all 5
    for (let i = 0; i < 5; i++) {
      await undo(page);
    }

    const s2 = await getEditorState(page);
    expect(s2.undoStackLength).toBe(baseline);
    expect(s2.redoStackLength).toBe(5);

    // Redo all 5
    for (let i = 0; i < 5; i++) {
      await redo(page);
    }

    const s3 = await getEditorState(page);
    expect(s3.undoStackLength).toBe(baseline + 5);
    expect(s3.redoStackLength).toBe(0);
  });

  test('flatten image undo restores all layers', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    await addLayer(page);
    const s1 = await getEditorState(page);
    const midId = s1.document.activeLayerId;
    await paintRect(page, 0, 0, 100, 100, { r: 0, g: 255, b: 0, a: 128 }, midId);

    await addLayer(page);
    const s2 = await getEditorState(page);
    const topId = s2.document.activeLayerId;
    await paintRect(page, 0, 0, 100, 100, { r: 0, g: 0, b: 255, a: 64 }, topId);

    expect((await getEditorState(page)).document.layers).toHaveLength(4);

    // Flatten
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { flattenImage: () => void };
      };
      store.getState().flattenImage();
    });

    expect((await getEditorState(page)).document.layers).toHaveLength(2);

    // Undo flatten -> should restore all 3 raster layers + group
    await undo(page);
    const restored = await getEditorState(page);
    expect(restored.document.layers).toHaveLength(4);
  });

  test('undo does nothing with empty undo stack', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const before = await getEditorState(page);
    const baseline = before.undoStackLength;

    // Undo past any baseline snapshots to reach true empty
    for (let i = 0; i < baseline; i++) {
      await undo(page);
    }

    const empty = await getEditorState(page);
    expect(empty.undoStackLength).toBe(0);

    // Undo on empty stack should be a no-op
    await undo(page);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(2);
    expect(after.undoStackLength).toBe(0);
  });

  test('redo does nothing with empty redo stack', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await redo(page);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(2);
    expect(after.redoStackLength).toBe(0);
  });
});
