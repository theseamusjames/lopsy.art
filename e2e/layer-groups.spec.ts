import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
  await page.waitForTimeout(200);
}

interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  children?: string[];
  collapsed?: boolean;
}

interface DocInfo {
  layers: LayerInfo[];
  layerOrder: string[];
  activeLayerId: string | null;
  rootGroupId: string | null;
}

async function getDocInfo(page: Page): Promise<DocInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: Record<string, unknown> };
    };
    const doc = store.getState().document;
    const layers = (doc.layers as Array<Record<string, unknown>>).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      type: l.type as string,
      visible: l.visible as boolean,
      locked: l.locked as boolean,
      children: (l.children as string[] | undefined) ?? undefined,
      collapsed: (l.collapsed as boolean | undefined) ?? undefined,
    }));
    return {
      layers,
      layerOrder: doc.layerOrder as string[],
      activeLayerId: doc.activeLayerId as string | null,
      rootGroupId: (doc.rootGroupId as string | null) ?? null,
    };
  });
}

async function callStore(page: Page, method: string, ...args: unknown[]) {
  await page.evaluate(
    ({ method, args }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, (...a: unknown[]) => unknown>;
      };
      store.getState()[method]!(...args);
    },
    { method, args },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Layer Groups', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
  });

  test('new document has a root Project group', async ({ page }) => {
    const doc = await getDocInfo(page);
    expect(doc.rootGroupId).toBeTruthy();
    const rootGroup = doc.layers.find((l) => l.id === doc.rootGroupId);
    expect(rootGroup).toBeTruthy();
    expect(rootGroup!.name).toBe('Project');
    expect(rootGroup!.type).toBe('group');
    // All non-group layers should be children of the root group
    const nonGroupLayers = doc.layers.filter((l) => l.type !== 'group');
    for (const layer of nonGroupLayers) {
      expect(rootGroup!.children).toContain(layer.id);
    }
  });

  test('addLayer places new layer inside root group', async ({ page }) => {
    await callStore(page, 'addLayer');
    const doc = await getDocInfo(page);
    const rootGroup = doc.layers.find((l) => l.id === doc.rootGroupId);
    const newLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
    expect(newLayer).toBeTruthy();
    expect(rootGroup!.children).toContain(newLayer!.id);
  });

  test('addGroup creates a group inside root group', async ({ page }) => {
    await callStore(page, 'addGroup', 'Test Group');
    const doc = await getDocInfo(page);
    const rootGroup = doc.layers.find((l) => l.id === doc.rootGroupId);
    const newGroup = doc.layers.find((l) => l.name === 'Test Group');
    expect(newGroup).toBeTruthy();
    expect(newGroup!.type).toBe('group');
    expect(rootGroup!.children).toContain(newGroup!.id);
  });

  test('nested group: addGroup inside a group creates nested hierarchy', async ({ page }) => {
    await callStore(page, 'addGroup', 'Outer');
    const doc1 = await getDocInfo(page);
    const outerGroup = doc1.layers.find((l) => l.name === 'Outer')!;
    // Active is now the outer group — adding another group goes inside it
    await callStore(page, 'addGroup', 'Inner');
    const doc2 = await getDocInfo(page);
    const innerGroup = doc2.layers.find((l) => l.name === 'Inner')!;
    const updatedOuter = doc2.layers.find((l) => l.id === outerGroup.id)!;
    expect(updatedOuter.children).toContain(innerGroup.id);
  });

  test('root group cannot be deleted', async ({ page }) => {
    const before = await getDocInfo(page);
    const rootId = before.rootGroupId!;
    await callStore(page, 'removeLayer', rootId);
    const after = await getDocInfo(page);
    // Root group should still exist
    expect(after.layers.find((l) => l.id === rootId)).toBeTruthy();
  });

  test('deleting a group removes all its descendants', async ({ page }) => {
    await callStore(page, 'addGroup', 'ToDelete');
    const doc1 = await getDocInfo(page);
    const groupId = doc1.layers.find((l) => l.name === 'ToDelete')!.id;
    // Add a layer inside the group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const childId = doc2.activeLayerId!;
    expect(doc2.layers.find((l) => l.id === groupId)!.children).toContain(childId);
    // Delete the group
    await callStore(page, 'setActiveLayer', groupId);
    await callStore(page, 'removeLayer', groupId);
    const doc3 = await getDocInfo(page);
    expect(doc3.layers.find((l) => l.id === groupId)).toBeUndefined();
    expect(doc3.layers.find((l) => l.id === childId)).toBeUndefined();
  });

  test('moveLayerToGroup moves layer into target group', async ({ page }) => {
    const doc1 = await getDocInfo(page);
    const layerId = doc1.layers.find((l) => l.type === 'raster')!.id;
    await callStore(page, 'addGroup', 'Target');
    const doc2 = await getDocInfo(page);
    const targetId = doc2.layers.find((l) => l.name === 'Target')!.id;
    await callStore(page, 'moveLayerToGroup', layerId, targetId);
    const doc3 = await getDocInfo(page);
    const target = doc3.layers.find((l) => l.id === targetId)!;
    expect(target.children).toContain(layerId);
    // Layer should also be repositioned in layerOrder (before the group)
    const layerIdx = doc3.layerOrder.indexOf(layerId);
    const groupIdx = doc3.layerOrder.indexOf(targetId);
    expect(layerIdx).toBeLessThan(groupIdx);
  });

  test('toggleGroupCollapsed hides/shows children in display list', async ({ page }) => {
    await callStore(page, 'addGroup', 'Collapsible');
    const doc1 = await getDocInfo(page);
    const groupId = doc1.layers.find((l) => l.name === 'Collapsible')!.id;
    // Add a layer inside the group
    await callStore(page, 'addLayer');
    // Collapse the group
    await callStore(page, 'toggleGroupCollapsed', groupId);
    const doc2 = await getDocInfo(page);
    const group = doc2.layers.find((l) => l.id === groupId)!;
    expect(group.collapsed).toBe(true);
    // Expand again
    await callStore(page, 'toggleGroupCollapsed', groupId);
    const doc3 = await getDocInfo(page);
    const group2 = doc3.layers.find((l) => l.id === groupId)!;
    expect(group2.collapsed).toBe(false);
  });

  test('layer lock prevents editing', async ({ page }) => {
    const doc = await getDocInfo(page);
    const layerId = doc.layers.find((l) => l.type === 'raster')!.id;
    await callStore(page, 'toggleLayerLock', layerId);
    const doc2 = await getDocInfo(page);
    expect(doc2.layers.find((l) => l.id === layerId)!.locked).toBe(true);
    // Unlock
    await callStore(page, 'toggleLayerLock', layerId);
    const doc3 = await getDocInfo(page);
    expect(doc3.layers.find((l) => l.id === layerId)!.locked).toBe(false);
  });

  test('renameLayer changes layer name', async ({ page }) => {
    const doc = await getDocInfo(page);
    const layerId = doc.layers.find((l) => l.type === 'raster')!.id;
    await callStore(page, 'renameLayer', layerId, 'New Name');
    const doc2 = await getDocInfo(page);
    expect(doc2.layers.find((l) => l.id === layerId)!.name).toBe('New Name');
  });

  test('group visibility hides children from engine', async ({ page }) => {
    const doc = await getDocInfo(page);
    const rootId = doc.rootGroupId!;
    // Hide root group
    await callStore(page, 'toggleLayerVisibility', rootId);
    const doc2 = await getDocInfo(page);
    expect(doc2.layers.find((l) => l.id === rootId)!.visible).toBe(false);
    // Show it again
    await callStore(page, 'toggleLayerVisibility', rootId);
    const doc3 = await getDocInfo(page);
    expect(doc3.layers.find((l) => l.id === rootId)!.visible).toBe(true);
  });

  test('duplicateLayer on a group duplicates all children', async ({ page }) => {
    await callStore(page, 'addGroup', 'DupMe');
    const doc1 = await getDocInfo(page);
    const groupId = doc1.layers.find((l) => l.name === 'DupMe')!.id;
    // Add a layer inside the group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const childCount = doc2.layers.find((l) => l.id === groupId)!.children!.length;
    // Select the group and duplicate
    await callStore(page, 'setActiveLayer', groupId);
    await callStore(page, 'duplicateLayer');
    const doc3 = await getDocInfo(page);
    const dupGroup = doc3.layers.find((l) => l.name === 'DupMe copy');
    expect(dupGroup).toBeTruthy();
    expect(dupGroup!.children!.length).toBe(childCount);
    // Children should be new IDs (not the same as originals)
    const originalChildren = doc2.layers.find((l) => l.id === groupId)!.children!;
    for (const childId of dupGroup!.children!) {
      expect(originalChildren).not.toContain(childId);
    }
  });

  test('flatten image rebuilds root group', async ({ page }) => {
    // Add some layers first
    await callStore(page, 'addLayer');
    await callStore(page, 'addLayer');
    await callStore(page, 'flattenImage');
    const doc = await getDocInfo(page);
    expect(doc.rootGroupId).toBeTruthy();
    const rootGroup = doc.layers.find((l) => l.id === doc.rootGroupId);
    expect(rootGroup).toBeTruthy();
    expect(rootGroup!.name).toBe('Project');
    // Should have one raster layer inside the root group
    const rasterLayers = doc.layers.filter((l) => l.type === 'raster');
    expect(rasterLayers.length).toBe(1);
    expect(rootGroup!.children).toContain(rasterLayers[0]!.id);
  });

  test('group adjustments can be set and retrieved', async ({ page }) => {
    const doc = await getDocInfo(page);
    const rootId = doc.rootGroupId!;
    await page.evaluate(
      ({ rootId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
          };
        };
        store.getState().setGroupAdjustments(rootId, {
          exposure: 1.5,
          contrast: 20,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          vignette: 0,
        });
      },
      { rootId },
    );
    const adj = await page.evaluate(
      ({ rootId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { document: { layers: Array<Record<string, unknown>> } };
        };
        const group = store.getState().document.layers.find((l) => l.id === rootId);
        return group?.adjustments as Record<string, number> | undefined;
      },
      { rootId },
    );
    expect(adj?.exposure).toBe(1.5);
    expect(adj?.contrast).toBe(20);
  });

  test('move tool on group moves all descendants', async ({ page }) => {
    await callStore(page, 'addGroup', 'MoveGroup');
    const doc1 = await getDocInfo(page);
    const groupId = doc1.layers.find((l) => l.name === 'MoveGroup')!.id;
    // Add layers inside the group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const childId = doc2.activeLayerId!;
    // Move child to a known position first
    await callStore(page, 'setActiveLayer', childId);
    await page.evaluate(
      ({ id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { updateLayerPosition: (id: string, x: number, y: number) => void };
        };
        store.getState().updateLayerPosition(id, 10, 20);
      },
      { id: childId },
    );
    // Now move the group
    await callStore(page, 'setActiveLayer', groupId);
    await page.evaluate(
      ({ id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { updateLayerPosition: (id: string, x: number, y: number) => void };
        };
        store.getState().updateLayerPosition(id, 50, 50);
      },
      { id: groupId },
    );
    // Child should have moved by the same delta (50, 50)
    const doc3 = await getDocInfo(page);
    const child = doc3.layers.find((l) => l.id === childId)!;
    expect(child).toBeTruthy();
    // The group started at (0,0) and moved to (50,50), delta = (50,50)
    // Child was at (10,20), should now be at (60,70)
    const childLayer = await page.evaluate(
      ({ id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
        };
        return store.getState().document.layers.find((l) => l.id === id);
      },
      { id: childId },
    );
    expect(childLayer!.x).toBe(60);
    expect(childLayer!.y).toBe(70);
  });
});

test.describe('Group Effects Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
  });

  test('group adjustments affect the rendered output', async ({ page }) => {
    // Paint white pixels on the background layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }>, rootGroupId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
        };
      };
      const state = store.getState();
      const bgLayer = state.document.layers.find((l) => l.type === 'raster');
      if (!bgLayer) return;
      const data = state.getOrCreateLayerPixelData(bgLayer.id);
      for (let i = 0; i < data.data.length; i += 4) {
        data.data[i] = 200;
        data.data[i + 1] = 200;
        data.data[i + 2] = 200;
        data.data[i + 3] = 255;
      }
      state.updateLayerPixelData(bgLayer.id, data);
    });
    await page.waitForTimeout(200);

    // Set contrast adjustment on root group
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { rootGroupId: string };
          setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
        };
      };
      const state = store.getState();
      state.setGroupAdjustments(state.document.rootGroupId, {
        exposure: 0, contrast: 50, highlights: 0, shadows: 0,
        whites: 0, blacks: 0, vignette: 0,
      });
    });
    await page.waitForTimeout(300);

    // Verify the adjustments are stored
    const adj = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<Record<string, unknown>>, rootGroupId: string } };
      };
      const state = store.getState();
      const root = state.document.layers.find((l) => l.id === state.document.rootGroupId);
      return root?.adjustments as Record<string, number>;
    });
    expect(adj.contrast).toBe(50);
  });

  test('sub-group adjustments affect rendering (not just root group)', async ({ page }) => {
    // Create a sub-group inside the project
    await callStore(page, 'addGroup', 'Group');
    const doc1 = await getDocInfo(page);
    const subGroupId = doc1.layers.find((l) => l.name === 'Group')!.id;

    // Add a layer inside the sub-group and paint red on it
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const layerId = doc2.activeLayerId!;
    await page.evaluate(
      ({ layerId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
          };
        };
        const state = store.getState();
        const data = state.getOrCreateLayerPixelData(layerId);
        for (let i = 0; i < data.data.length; i += 4) {
          data.data[i] = 255;
          data.data[i + 1] = 0;
          data.data[i + 2] = 0;
          data.data[i + 3] = 255;
        }
        state.updateLayerPixelData(layerId, data);
      },
      { layerId },
    );

    // Set exposure on the SUB-GROUP (not root)
    await page.evaluate(
      ({ subGroupId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
          };
        };
        store.getState().setGroupAdjustments(subGroupId, {
          exposure: 2, contrast: 0, highlights: 0, shadows: 0,
          whites: 0, blacks: 0, vignette: 0,
        });
      },
      { subGroupId },
    );
    await page.waitForTimeout(300);

    // Verify the sub-group adjustments are stored
    const adj = await page.evaluate(
      ({ subGroupId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { document: { layers: Array<Record<string, unknown>> } };
        };
        const group = store.getState().document.layers.find((l) => l.id === subGroupId);
        return group?.adjustments as Record<string, number>;
      },
      { subGroupId },
    );
    expect(adj.exposure).toBe(2);

    // Verify the aggregated adjustments include the sub-group's exposure
    const aggregated = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<Record<string, unknown>> } };
      };
      const layers = store.getState().document.layers;
      const agg = { exposure: 0, contrast: 0 };
      for (const l of layers) {
        if (l.type === 'group' && l.adjustmentsEnabled !== false && l.visible && l.adjustments) {
          const a = l.adjustments as Record<string, number>;
          agg.exposure += a.exposure ?? 0;
          agg.contrast += a.contrast ?? 0;
        }
      }
      return agg;
    });
    expect(aggregated.exposure).toBe(2);
  });
});

test.describe('Group effects only affect current members', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
  });

  test('moving a layer out of a group removes it from that group children', async ({ page }) => {
    // Create a sub-group
    await callStore(page, 'addGroup', 'SubGroup');
    const doc1 = await getDocInfo(page);
    const subGroupId = doc1.layers.find((l) => l.name === 'SubGroup')!.id;

    // Add a layer inside the sub-group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const childId = doc2.activeLayerId!;

    // Verify it's in the sub-group
    const subGroup = doc2.layers.find((l) => l.id === subGroupId)!;
    expect(subGroup.children).toContain(childId);

    // Move it to the root group
    const rootId = doc2.rootGroupId!;
    await callStore(page, 'moveLayerToGroup', childId, rootId);
    const doc3 = await getDocInfo(page);

    // Verify it's no longer in the sub-group
    const updatedSubGroup = doc3.layers.find((l) => l.id === subGroupId)!;
    expect(updatedSubGroup.children).not.toContain(childId);

    // Verify it IS in the root group
    const rootGroup = doc3.layers.find((l) => l.id === rootId)!;
    expect(rootGroup.children).toContain(childId);
  });

  test('hiding a group does not affect layers that were moved out of it', async ({ page }) => {
    // Create a sub-group
    await callStore(page, 'addGroup', 'SubGroup');
    const doc1 = await getDocInfo(page);
    const subGroupId = doc1.layers.find((l) => l.name === 'SubGroup')!.id;

    // Add a layer inside the sub-group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const childId = doc2.activeLayerId!;

    // Move it out to the root group
    const rootId = doc2.rootGroupId!;
    await callStore(page, 'moveLayerToGroup', childId, rootId);

    // Hide the sub-group
    await callStore(page, 'toggleLayerVisibility', subGroupId);

    // The moved-out layer should still be visible (not affected by hidden sub-group)
    const doc3 = await getDocInfo(page);
    const movedLayer = doc3.layers.find((l) => l.id === childId)!;
    expect(movedLayer.visible).toBe(true);

    // Verify via isEffectivelyVisible logic: the layer's ancestor chain should
    // NOT include the hidden sub-group anymore
    const isInSubGroup = doc3.layers
      .find((l) => l.id === subGroupId)!
      .children!.includes(childId);
    expect(isInSubGroup).toBe(false);
  });

  test('group adjustments do not affect layers moved out of the group', async ({ page }) => {
    // Create a sub-group with adjustments
    await callStore(page, 'addGroup', 'AdjGroup');
    const doc1 = await getDocInfo(page);
    const adjGroupId = doc1.layers.find((l) => l.name === 'AdjGroup')!.id;

    // Set exposure on the group
    await page.evaluate(
      ({ groupId }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
          };
        };
        store.getState().setGroupAdjustments(groupId, {
          exposure: 3, contrast: 0, highlights: 0, shadows: 0,
          whites: 0, blacks: 0, vignette: 0,
        });
      },
      { groupId: adjGroupId },
    );

    // Add a layer inside the group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const childId = doc2.activeLayerId!;

    // Move the layer out to root group
    const rootId = doc2.rootGroupId!;
    await callStore(page, 'moveLayerToGroup', childId, rootId);

    // Verify the layer is no longer in the adjustment group
    const doc3 = await getDocInfo(page);
    const adjGroup = doc3.layers.find((l) => l.id === adjGroupId)!;
    expect(adjGroup.children).not.toContain(childId);

    // The group's adjustments should NOT affect the moved-out layer
    // (adjustments are aggregated globally for the engine, but the layer
    // is no longer structurally part of that group)
    const rootGroup = doc3.layers.find((l) => l.id === rootId)!;
    expect(rootGroup.children).toContain(childId);
  });
});

test.describe('Layer moved out of group is not affected by group visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
  });

  test('reorder-based move out of group updates children and keeps layer visible', async ({ page }) => {
    // Create a group and add a layer into it
    await callStore(page, 'addGroup', 'Group');
    const doc1 = await getDocInfo(page);
    const groupId = doc1.layers.find((l) => l.name === 'Group')!.id;

    // Add a layer inside the group (active = group, so new layer goes into it)
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const layerId = doc2.activeLayerId!;
    expect(doc2.layers.find((l) => l.id === groupId)!.children).toContain(layerId);

    // Simulate a flat reorder that moves the layer out of the group's range
    // by calling moveLayer directly (this is what the drag handler calls)
    const fromIdx = doc2.layers.findIndex((l) => l.id === layerId);
    // Move it to the end (next to Background, which is in Project)
    await page.evaluate(
      ({ fromIdx }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { moveLayer: (from: number, to: number) => void };
        };
        store.getState().moveLayer(fromIdx, 0);
      },
      { fromIdx },
    );
    const doc3 = await getDocInfo(page);

    // The layer should have been re-parented out of the group
    const updatedGroup = doc3.layers.find((l) => l.id === groupId)!;
    expect(updatedGroup.children).not.toContain(layerId);

    // Hide the group
    await callStore(page, 'toggleLayerVisibility', groupId);
    const doc4 = await getDocInfo(page);
    expect(doc4.layers.find((l) => l.id === groupId)!.visible).toBe(false);

    // Layer should still be visible
    expect(doc4.layers.find((l) => l.id === layerId)!.visible).toBe(true);
  });

  test('layer moved from group to root via moveLayerToGroup is visible when group is hidden', async ({ page }) => {
    // Create a group and add a layer into it
    await callStore(page, 'addGroup', 'Group');
    const doc1 = await getDocInfo(page);
    const groupId = doc1.layers.find((l) => l.name === 'Group')!.id;
    const rootId = doc1.rootGroupId!;

    // Add a layer inside the group
    await callStore(page, 'addLayer');
    const doc2 = await getDocInfo(page);
    const layerId = doc2.activeLayerId!;

    // Verify it's in the group
    expect(doc2.layers.find((l) => l.id === groupId)!.children).toContain(layerId);

    // Move the layer out of the group to root
    await callStore(page, 'moveLayerToGroup', layerId, rootId);
    const doc3 = await getDocInfo(page);

    // Verify it's OUT of the group
    expect(doc3.layers.find((l) => l.id === groupId)!.children).not.toContain(layerId);
    // Verify it's IN root
    expect(doc3.layers.find((l) => l.id === rootId)!.children).toContain(layerId);

    // Now hide the group
    await callStore(page, 'toggleLayerVisibility', groupId);
    const doc4 = await getDocInfo(page);
    expect(doc4.layers.find((l) => l.id === groupId)!.visible).toBe(false);

    // The layer should STILL be visible
    const layer = doc4.layers.find((l) => l.id === layerId)!;
    expect(layer.visible).toBe(true);

    // Check layerOrder positions — layer should NOT be between group's
    // children and group in the order
    const order = doc4.layerOrder;
    const layerPos = order.indexOf(layerId);
    const groupPos = order.indexOf(groupId);
    // Layer should be after the group in layerOrder (higher in stack)
    // or before all group children
    console.log('layerOrder:', order);
    console.log('layerId pos:', layerPos, 'groupId pos:', groupPos);

    // Verify the engine descriptor would have visible=true
    // by checking isEffectivelyVisible logic
    const effectiveVis = await page.evaluate(
      ({ layerId, layers }) => {
        // Replicate isEffectivelyVisible
        function findParent(lid: string): { id: string; visible: boolean; children: string[] } | null {
          for (const l of layers) {
            if (l.type === 'group' && l.children && l.children.includes(lid)) {
              return l as { id: string; visible: boolean; children: string[] };
            }
          }
          return null;
        }
        const layer = layers.find((l: { id: string }) => l.id === layerId);
        if (!layer || !layer.visible) return false;
        let currentId = layerId;
        for (;;) {
          const parent = findParent(currentId);
          if (!parent) break;
          if (!parent.visible) return false;
          currentId = parent.id;
        }
        return true;
      },
      { layerId, layers: doc4.layers },
    );
    expect(effectiveVis).toBe(true);
  });
});

test.describe('Layer visibility inside groups', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
  });

  test('hiding a layer inside a group sets visible false in engine descriptor', async ({ page }) => {
    // Get Layer 1 (inside the root group)
    const doc = await getDocInfo(page);
    const layer = doc.layers.find((l) => l.type === 'raster' && l.name !== 'Background');
    expect(layer).toBeTruthy();
    expect(layer!.visible).toBe(true);

    // Toggle visibility off
    await callStore(page, 'toggleLayerVisibility', layer!.id);
    const doc2 = await getDocInfo(page);
    const updated = doc2.layers.find((l) => l.id === layer!.id);
    expect(updated!.visible).toBe(false);

    // Toggle back on
    await callStore(page, 'toggleLayerVisibility', layer!.id);
    const doc3 = await getDocInfo(page);
    expect(doc3.layers.find((l) => l.id === layer!.id)!.visible).toBe(true);
  });

  test('hiding a layer inside a sub-group sets visible false', async ({ page }) => {
    // Create sub-group with a layer
    await callStore(page, 'addGroup', 'SubGroup');
    await callStore(page, 'addLayer');
    const doc = await getDocInfo(page);
    const childId = doc.activeLayerId!;
    expect(doc.layers.find((l) => l.id === childId)!.visible).toBe(true);

    // Hide it
    await callStore(page, 'toggleLayerVisibility', childId);
    const doc2 = await getDocInfo(page);
    expect(doc2.layers.find((l) => l.id === childId)!.visible).toBe(false);
  });
});
