import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect, addLayer } from './helpers';

test.describe('Group move moves all children (#121)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(300);
  });

  test('updateLayerPosition on a group applies delta to all descendants', async ({ page }) => {
    // Create a group with two child layers at known positions
    const setup = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string; x: number; y: number; children?: string[] }>;
            activeLayerId: string;
            rootGroupId: string;
          };
          addLayer: () => void;
          addGroup: () => void;
          pushHistory: (label?: string) => void;
          updateLayerPosition: (id: string, x: number, y: number) => void;
          setActiveLayer: (id: string) => void;
        };
      };
      const state = store.getState();

      // Add a group
      state.addGroup();
      const afterGroup = store.getState();
      const group = afterGroup.document.layers.find(
        (l) => l.type === 'group' && l.id !== afterGroup.document.rootGroupId,
      );
      const groupId = group!.id;

      // Add two layers inside the group
      state.setActiveLayer(groupId);
      state.addLayer();
      const layer1Id = store.getState().document.activeLayerId;

      state.setActiveLayer(groupId);
      state.addLayer();
      const layer2Id = store.getState().document.activeLayerId;

      // Position the layers at known locations
      state.updateLayerPosition(layer1Id, 10, 20);
      state.updateLayerPosition(layer2Id, 100, 150);

      return { groupId, layer1Id, layer2Id };
    });

    // Paint content on both layers so they're visible.
    // Note: updateLayerPixelData auto-crops to content bounds and shifts layer.x/y
    // accordingly, so we capture the post-paint positions as our baseline.
    await paintRect(page, 10, 20, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, setup.layer1Id);
    await paintRect(page, 100, 150, 50, 50, { r: 0, g: 0, b: 255, a: 255 }, setup.layer2Id);
    await page.waitForTimeout(200);

    const before = await page.evaluate(
      ({ layer1Id, layer2Id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; x: number; y: number }> };
          };
        };
        const layers = store.getState().document.layers;
        const find = (id: string) => layers.find((l) => l.id === id);
        return {
          layer1: { x: find(layer1Id)?.x ?? 0, y: find(layer1Id)?.y ?? 0 },
          layer2: { x: find(layer2Id)?.x ?? 0, y: find(layer2Id)?.y ?? 0 },
        };
      },
      { layer1Id: setup.layer1Id, layer2Id: setup.layer2Id },
    );

    await page.screenshot({ path: 'e2e/screenshots/group-move-before.png' });

    // Move the group by (50, 30)
    const dx = 50;
    const dy = 30;
    await page.evaluate(
      ({ groupId, dx, dy }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; x: number; y: number }> };
            pushHistory: (label?: string) => void;
            updateLayerPosition: (id: string, x: number, y: number) => void;
          };
        };
        const state = store.getState();
        const group = state.document.layers.find((l) => l.id === groupId);
        state.pushHistory('Move Group');
        state.updateLayerPosition(groupId, (group?.x ?? 0) + dx, (group?.y ?? 0) + dy);
      },
      { groupId: setup.groupId, dx, dy },
    );
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/group-move-after.png' });

    // Verify both children moved by the same delta
    const positions = await page.evaluate(
      ({ groupId, layer1Id, layer2Id }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; x: number; y: number }> };
          };
        };
        const layers = store.getState().document.layers;
        const find = (id: string) => layers.find((l) => l.id === id);
        return {
          group: { x: find(groupId)?.x ?? 0, y: find(groupId)?.y ?? 0 },
          layer1: { x: find(layer1Id)?.x ?? 0, y: find(layer1Id)?.y ?? 0 },
          layer2: { x: find(layer2Id)?.x ?? 0, y: find(layer2Id)?.y ?? 0 },
        };
      },
      { groupId: setup.groupId, layer1Id: setup.layer1Id, layer2Id: setup.layer2Id },
    );

    // Both children should have moved by exactly the group delta.
    expect(positions.layer1.x).toBe(before.layer1.x + dx);
    expect(positions.layer1.y).toBe(before.layer1.y + dy);
    expect(positions.layer2.x).toBe(before.layer2.x + dx);
    expect(positions.layer2.y).toBe(before.layer2.y + dy);
  });
});
