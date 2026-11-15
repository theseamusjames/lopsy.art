import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, docToScreen } from './helpers';

// #897 — a regression from #817's fix, which let every key through the
// global shortcut handler once a non-text input (range, checkbox, radio…)
// had focus. That went too far: focusing the grid-size range slider and
// pressing an arrow key let the global arrow-key nudge shortcut win the
// race and move the active layer instead of stepping the slider — a silent
// data-corruption risk, since the user is looking at the options bar, not
// the canvas, when it happens.

async function openHistoryPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        visiblePanels: Set<string>;
        togglePanel: (id: string) => void;
      };
    };
    const state = store.getState();
    if (!state.visiblePanels.has('history')) {
      state.togglePanel('history');
    }
  });
  await page.waitForTimeout(100);
  const tab = page.locator('[data-dock-tab="history"]');
  if (await tab.count() > 0) {
    await tab.click();
  }
  await page.locator('section[role="tabpanel"][aria-label="History"]').waitFor({ state: 'visible' });
}

async function getHistoryLabels(page: Page): Promise<string[]> {
  const panel = page.locator('section[role="tabpanel"][aria-label="History"]');
  const rows = panel.locator('button');
  const count = await rows.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    labels.push((await rows.nth(i).locator('span').nth(1).innerText()).trim());
  }
  return labels;
}

async function activeLayerPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          activeLayerId: string;
          layers: Array<{ id: string; x: number; y: number }>;
        };
      };
    };
    const { activeLayerId, layers } = store.getState().document;
    const layer = layers.find((l) => l.id === activeLayerId)!;
    return { x: layer.x, y: layer.y };
  });
}

async function gridSize(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { gridSize: number };
    };
    return store.getState().gridSize;
  });
}

test.describe('Grid-size slider arrow keys do not trigger the global nudge (#897)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'options bar and menu bar are desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('arrow keys step the focused grid-size slider, not the active layer', async ({ page }) => {
    // Put real content on the active layer via a marquee selection + fill,
    // so a silent nudge would be visible as a layer position change.
    await selectTool(page, 'marquee-rect');
    const a = await docToScreen(page, 50, 50);
    const b = await docToScreen(page, 200, 150);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Edit > Fill (the ⇧F5 label in the menu is not wired to a live
    // keyboard shortcut, so drive it through the menu like a real user).
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('[role="menuitem"]:has-text("Fill")').first().click();
    await page.waitForTimeout(150);

    await page.keyboard.press('Control+d'); // Edit > Deselect
    await page.waitForTimeout(100);

    await selectTool(page, 'move');
    await openHistoryPanel(page);

    const positionBefore = await activeLayerPosition(page);
    const historyBefore = await getHistoryLabels(page);

    // View > Show Grid
    await page.getByRole('button', { name: 'View' }).click();
    await page.locator('[role="menuitem"]:has-text("Show Grid")').click();

    const slider = page.locator('input[type="range"][class*="gridSlider"]');
    await expect(slider).toBeVisible();

    // Click the slider (not drag) to focus it, the way a user would before
    // using the arrow keys — the click lands mid-track, at the slider's
    // current value, so it does not itself change the value.
    const gridSizeBeforeArrows = await gridSize(page);
    await slider.click();
    await expect(slider).toBeFocused();
    expect(await gridSize(page)).toBe(gridSizeBeforeArrows);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    const gridSizeAfterArrows = await gridSize(page);
    const positionAfter = await activeLayerPosition(page);
    const historyAfter = await getHistoryLabels(page);

    // The native slider handled the arrow keys itself.
    expect(gridSizeAfterArrows).not.toBe(gridSizeBeforeArrows);
    expect(gridSizeAfterArrows).toBeGreaterThan(gridSizeBeforeArrows);

    // The active layer was not nudged, and no phantom "Nudge" entry landed
    // in the undo history.
    expect(positionAfter).toEqual(positionBefore);
    expect(historyAfter).toEqual(historyBefore);
  });
});
