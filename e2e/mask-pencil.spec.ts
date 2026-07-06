import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, docToScreen, setForegroundColor } from './helpers';

/**
 * Pencil on layer masks runs through the GPU dab path
 * (mask_paint_gpu::draw_pencil_blocks_gpu). The old implementation
 * issued one texSubImage2D upload per interpolated point, which made
 * mask pencil strokes on large documents unusably slow. This spec locks
 * in the painted result; for responsiveness regressions use the CDP
 * profiling workflow in MEMORY.md.
 */

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

async function getMaskStats(page: Page): Promise<{ zeros: number; total: number }> {
  return page.evaluate(() => {
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
    if (!layer?.mask) return { zeros: -1, total: -1 };
    let zeros = 0;
    for (const v of layer.mask.data) {
      if (v < 16) zeros++;
    }
    return { zeros, total: layer.mask.data.length };
  });
}

test.describe('Pencil on layer mask', () => {
  test('paints hidden pixels into the mask and stays responsive', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);

    // Large document so a per-point-upload regression is visible as a
    // wall-clock blowup rather than noise.
    await createDocument(page, 1600, 1200, false);
    await addMaskToActiveLayer(page);

    // Enter mask edit mode by clicking the mask thumbnail.
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await page.waitForTimeout(200);
    const maskMode = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { maskMode: string };
      };
      return ui.getState().maskMode;
    });
    expect(maskMode).toBe('layerMask');

    await selectTool(page, 'pencil');

    const before = await getMaskStats(page);
    expect(before.total).toBeGreaterThan(0);
    expect(before.zeros).toBe(0); // fresh mask is fully white (reveal)

    // Long diagonal stroke across most of the document.
    const start = await docToScreen(page, 100, 100);
    const end = await docToScreen(page, 1500, 1100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 60 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Pencil on a mask paints "hide" (value 0). The stroke-end readback
    // syncs the GPU mask texture into layer.mask.data.
    const after = await getMaskStats(page);
    expect(after.zeros).toBeGreaterThan(500);
  });

  test('quick mask pencil marks selection through the same GPU path', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    await page.keyboard.press('q');
    await page.waitForTimeout(150);
    // Quick-mask pencil follows the foreground color: white selects.
    await setForegroundColor(page, 255, 255, 255);
    await selectTool(page, 'pencil');

    const start = await docToScreen(page, 100, 300);
    const end = await docToScreen(page, 700, 300);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 30 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Exit quick mask — painted strip becomes the selection.
    await page.keyboard.press('q');
    await page.waitForTimeout(400);

    const selection = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection;
    });
    expect(selection.active).toBe(true);
  });
});
