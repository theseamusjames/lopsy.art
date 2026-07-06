import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
} from './helpers';

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function getDoc(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{
            id: string;
            name: string;
            type: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }>;
          activeLayerId: string;
        };
      };
    };
    const doc = store.getState().document;
    return { layers: doc.layers, activeLayerId: doc.activeLayerId };
  });
}

async function getSelectionBounds(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          bounds: { x: number; y: number; width: number; height: number } | null;
        } | null;
      };
    };
    return store.getState().selection?.bounds ?? null;
  });
}

async function countOpaquePixelsInLayer(page: Page, layerId: string) {
  return page.evaluate(async (lid) => {
    const read = (window as unknown as Record<string, (...args: unknown[]) => Promise<{
      width: number;
      height: number;
      pixels: number[];
    }>>).__readLayerPixels;
    const data = await read(lid);
    let count = 0;
    let minX = data.width;
    let maxX = 0;
    let minY = data.height;
    let maxY = 0;
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const alpha = data.pixels[(y * data.width + x) * 4 + 3] ?? 0;
        if (alpha > 10) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { count, minX, maxX, minY, maxY, texW: data.width, texH: data.height };
  }, layerId);
}

test.describe('rasterize text + cmd+click selection alignment', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('cmd+click selection aligns with rasterized text content after move', async ({ page }) => {
    await createDocument(page, 800, 600, true);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { fitToView: () => void };
      };
      store.getState().fitToView();
    });
    await page.waitForTimeout(300);

    // 1. Select text tool and set 200px font, click near the bottom
    await page.keyboard.press('t');
    await page.waitForTimeout(100);

    // Set font size to 200px via tool settings store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setTextSetting: (key: 'fontSize', value: number) => void };
      };
      store.getState().setTextSetting('fontSize', 200);
    });
    await page.waitForTimeout(100);

    await clickAtDoc(page, 200, 480);
    await page.waitForTimeout(200);

    // Type text
    await page.keyboard.type('Hello', { delay: 30 });
    await page.waitForTimeout(200);

    // Commit text with Shift+Enter
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(500);

    // Find the text layer
    let doc = await getDoc(page);
    const textLayer = doc.layers.find((l) => l.type === 'text');
    expect(textLayer).toBeDefined();
    const layerId = textLayer!.id;

    await page.screenshot({ path: 'e2e/screenshots/rasterize-text-sel-initial.png' });

    // 2. Move text up toward the middle using the move tool
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await page.waitForTimeout(100);

    // Use a real mouse drag to move the layer up
    const layerCenterX = textLayer!.x + 50;
    const layerCenterY = textLayer!.y + 10;
    const startPos = await docToScreen(page, layerCenterX, layerCenterY);
    const targetY = 150;
    const deltaY = targetY - textLayer!.y;
    const endPos = await docToScreen(page, layerCenterX, layerCenterY + deltaY);
    await page.mouse.move(startPos.x, startPos.y);
    await page.mouse.down();
    await page.mouse.move(endPos.x, endPos.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    doc = await getDoc(page);
    const movedLayer = doc.layers.find((l) => l.id === layerId)!;
    expect(movedLayer.y).toBeLessThan(textLayer!.y);

    await page.screenshot({ path: 'e2e/screenshots/rasterize-text-sel-moved.png' });

    // 3. Rasterize the text layer
    const rasterizeBtn = page.locator('[aria-label="Rasterize Layer"]');
    await rasterizeBtn.click();
    await page.waitForTimeout(500);

    doc = await getDoc(page);
    const rasterLayer = doc.layers.find((l) => l.id === layerId)!;
    expect(rasterLayer.type).toBe('raster');

    // Read content bounds within the texture
    const contentInfo = await countOpaquePixelsInLayer(page, layerId);
    expect(contentInfo.count).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/rasterize-text-sel-rasterized.png' });

    // 4. Cmd+click layer thumbnail to create selection from alpha
    const layerRow = page.locator(`[data-layer-id="${layerId}"]`);
    const thumbnail = layerRow.locator('canvas').first();
    await thumbnail.click({ modifiers: ['Meta'] });
    await page.waitForTimeout(500);

    const selBounds = await getSelectionBounds(page);
    expect(selBounds).not.toBeNull();

    // The selection should be around the moved layer position, not at 0,0
    // Layer content in doc space = layer.x + content offset within texture
    const rasterBounds = doc.layers.find((l) => l.id === layerId)!;
    const contentDocMinY = rasterBounds.y + contentInfo.minY;
    const contentDocMaxY = rasterBounds.y + contentInfo.maxY;

    // The key assertion: selection.y should be near the moved position,
    // not at 0 (which would indicate the position was lost during rasterize)
    expect(selBounds!.y).toBeGreaterThan(50);
    expect(selBounds!.y).toBeLessThan(contentDocMaxY + 10);
    expect(selBounds!.y).toBeGreaterThanOrEqual(contentDocMinY - 5);

    await page.screenshot({ path: 'e2e/screenshots/rasterize-text-sel-selection.png' });

    // 5. Apply gradient across the text selection
    await page.locator('[data-tool-id="gradient"]').click();
    await page.waitForTimeout(200);

    // Drag gradient across the full text area (left to right)
    const gradStartX = selBounds!.x - 10;
    const gradEndX = selBounds!.x + selBounds!.width + 10;
    const gradY = selBounds!.y + selBounds!.height / 2;
    const gradStart = await docToScreen(page, gradStartX, gradY);
    const gradEnd = await docToScreen(page, gradEndX, gradY);
    await page.mouse.move(gradStart.x, gradStart.y);
    await page.mouse.down();
    await page.mouse.move(gradEnd.x, gradEnd.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/rasterize-text-sel-gradient.png' });

    // Check the layer's bounds after gradient — did the layer change position?
    doc = await getDoc(page);
    const afterGradient = doc.layers.find((l) => l.id === layerId)!;

    // 6. Deselect
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);

    // 7. Cmd+click again — this is where the bug manifests
    await thumbnail.click({ modifiers: ['Meta'] });
    await page.waitForTimeout(500);

    const selBounds2 = await getSelectionBounds(page);
    expect(selBounds2).not.toBeNull();

    await page.screenshot({ path: 'e2e/screenshots/rasterize-text-sel-after-gradient.png' });

    // The second selection should match the first — same content, same position
    // A large difference means the selection drifted (the bug in #494)
    expect(Math.abs(selBounds2!.y - selBounds!.y)).toBeLessThan(20);
    expect(Math.abs(selBounds2!.x - selBounds!.x)).toBeLessThan(20);
  });
});
