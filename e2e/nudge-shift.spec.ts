import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, addLayer, drawRect, selectTool } from './helpers';

async function layerPosition(page: import('@playwright/test').Page, layerId: string): Promise<{ x: number; y: number }> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    return { x: layer?.x ?? NaN, y: layer?.y ?? NaN };
  }, layerId);
}

test.describe('Arrow-key nudge', () => {
  test('arrow moves the layer 1px; shift+arrow moves it 10px', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);
    const layerId = await addLayer(page);
    await drawRect(page, 100, 100, 60, 40, { r: 255, g: 0, b: 0 });
    await selectTool(page, 'move');

    const start = await layerPosition(page, layerId);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    const afterPlain = await layerPosition(page, layerId);
    expect(afterPlain.x - start.x).toBe(1);
    expect(afterPlain.y).toBe(start.y);

    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('Shift+ArrowDown');
    await page.waitForTimeout(100);
    const afterShift = await layerPosition(page, layerId);
    expect(afterShift.x - afterPlain.x).toBe(10);
    expect(afterShift.y - afterPlain.y).toBe(10);
  });
});
