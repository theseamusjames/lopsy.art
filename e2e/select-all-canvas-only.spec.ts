/**
 * ⌘A (Select → All) selects the canvas, not every layer.
 *
 * The Layers panel's own ⌘A handler used to fire whenever nothing had
 * focus — the normal state while drawing — so one ⌘A both selected the
 * whole canvas and multi-selected every layer. The next Move drag then
 * dragged every layer, Background included.
 *
 * Selecting every layer with ⌘A still works while focus is inside the
 * Layers panel.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { waitForStore, createDocument, addLayer, drawRect, docToScreen, getPixelAt } from './helpers';

interface SelectionSnapshot {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  selectedLayerIds: string[];
  activeLayerId: string;
  layerIds: string[];
  backgroundId: string;
}

async function readSelection(page: Page): Promise<SelectionSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: { active: boolean; bounds: SelectionSnapshot['bounds'] };
        document: {
          selectedLayerIds: readonly string[];
          activeLayerId: string;
          rootGroupId: string | null;
          layers: Array<{ id: string; name: string }>;
        };
      };
    };
    const s = store.getState();
    const doc = s.document;
    return {
      active: s.selection.active,
      bounds: s.selection.bounds,
      selectedLayerIds: [...doc.selectedLayerIds],
      activeLayerId: doc.activeLayerId,
      layerIds: doc.layers.filter((l) => l.id !== doc.rootGroupId).map((l) => l.id),
      backgroundId: doc.layers.find((l) => l.name === 'Background')?.id ?? '',
    };
  });
}

async function blurFocus(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe('Select All selects the canvas only', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('⌘A with nothing focused leaves the layer selection alone', async ({ page }) => {
    await addLayer(page);
    await drawRect(page, 60, 60, 80, 60, { r: 255, g: 0, b: 0 });
    const before = await readSelection(page);
    expect(before.layerIds.length).toBeGreaterThanOrEqual(2);
    expect(before.selectedLayerIds).toEqual([before.activeLayerId]);

    await blurFocus(page);
    await page.keyboard.press('ControlOrMeta+a');

    const after = await readSelection(page);
    expect(after.active).toBe(true);
    expect(after.bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(after.selectedLayerIds, '⌘A must not multi-select every layer').toEqual([before.activeLayerId]);

    // ⌘A, ⌘D, then a Move drag: Move drags every *selected* layer when
    // there is no marquee, so a leftover multi-selection would drag the
    // white Background too and uncover its top-left corner.
    await page.keyboard.press('ControlOrMeta+d');
    await page.keyboard.press('v');
    const from = await docToScreen(page, 200, 150);
    const to = await docToScreen(page, 240, 180);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    await page.screenshot({ path: 'e2e/screenshots/select-all-then-move.png' });

    const bgCorner = await getPixelAt(page, 5, 5, after.backgroundId);
    expect(bgCorner, 'Background must not move with the active layer').toEqual({ r: 255, g: 255, b: 255, a: 255 });
    const moved = await getPixelAt(page, 60 + 80 + 20, 60 + 60 + 15, after.activeLayerId);
    expect(moved, 'the red rect on the active layer moved by (40, 30)').toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  test('⌘A with focus in the Layers panel still selects every layer', async ({ page }) => {
    await addLayer(page);
    await addLayer(page);
    const before = await readSelection(page);
    expect(before.selectedLayerIds).toEqual([before.activeLayerId]);

    // Keyboard focus inside the panel, as tabbing to a layer's drag grip does.
    await page.locator(`[data-layer-id="${before.backgroundId}"] [aria-label^="Drag to reorder"]`).focus();
    await page.keyboard.press('ControlOrMeta+a');

    const after = await readSelection(page);
    expect([...after.selectedLayerIds].sort()).toEqual([...before.layerIds].sort());
  });
});
