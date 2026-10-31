import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, drawRect, getEditorState, waitForStore } from './helpers';

// #1374: right after Merge Down, the Layers panel's Delete Layer button did
// nothing — selectedLayerIds still held the merged-away layer's id.

async function layerMenuItem(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name }).click();
  await page.waitForTimeout(200);
}

test.describe('Delete Layer after Merge Down / Flatten (#1374)', () => {
  test('Delete Layer removes the merged layer right after Merge Down', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    const layerA = await addLayer(page);
    await drawRect(page, 40, 40, 80, 80, { r: 255, g: 0, b: 0 });
    const layerB = await addLayer(page);
    await drawRect(page, 200, 40, 80, 80, { r: 0, g: 255, b: 0 });

    const before = await getEditorState(page);
    expect(before.document.activeLayerId).toBe(layerB);

    await layerMenuItem(page, 'Merge Down');

    const merged = await getEditorState(page);
    expect(merged.document.layers.some((l) => l.id === layerB)).toBe(false);
    expect(merged.document.activeLayerId).toBe(layerA);
    const undoDepth = merged.undoStackLength;

    await page.locator('[aria-label="Delete Layer"]').click();
    await page.waitForTimeout(200);

    const after = await getEditorState(page);
    expect(after.document.layers.some((l) => l.id === layerA)).toBe(false);
    expect(after.document.layers.length).toBe(merged.document.layers.length - 1);
    expect(after.undoStackLength).toBe(undoDepth + 1);
  });

  test('Flatten Image selects only the flattened layer', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    await addLayer(page);
    await drawRect(page, 40, 40, 80, 80, { r: 255, g: 0, b: 0 });

    await layerMenuItem(page, 'Flatten Image');

    const flat = await getEditorState(page);
    const selected = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { selectedLayerIds: string[] } };
      };
      return store.getState().document.selectedLayerIds;
    });
    expect(selected).toEqual([flat.document.activeLayerId]);
  });
});
