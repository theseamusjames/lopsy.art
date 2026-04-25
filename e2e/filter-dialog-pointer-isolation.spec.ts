/**
 * Regression surfaced by the store-refactor pass:
 *
 *   With the move tool active, opening Filter > Pixelate and dragging the
 *   block-size slider (especially with Preview enabled) caused pointer events
 *   to leak through the modal overlay to the canvas handler — the active
 *   layer would get moved while the user was just trying to adjust the
 *   filter. The FilterDialog needs to stop pointer events inside its
 *   overlay/modal from reaching the window-level tool handlers.
 */
import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
  );
}

async function createDocument(page: Page, width: number, height: number, transparent: boolean) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function fillActiveLayerBlack(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        notifyRender: () => void;
      };
    };
    const state = store.getState();
    const { width, height } = state.document;
    const imgData = new ImageData(width, height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 0;
      imgData.data[i + 1] = 0;
      imgData.data[i + 2] = 0;
      imgData.data[i + 3] = 255;
    }
    state.updateLayerPixelData(state.document.activeLayerId, imgData);
    state.notifyRender();
  });
  await page.waitForTimeout(100);
}

async function getActiveLayerPosition(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          activeLayerId: string;
          layers: Array<{ id: string; x: number; y: number }>;
        };
      };
    };
    const state = store.getState();
    const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
    return { x: layer?.x ?? 0, y: layer?.y ?? 0 };
  });
}

test.describe('FilterDialog pointer isolation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await fillActiveLayerBlack(page);
  });

  test('dragging the pixelate slider does not move the active layer', async ({ page }) => {
    // Switch to the move tool — this is the tool that was getting kicked
    // off by the leaked events.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('move');
    });
    await page.waitForTimeout(50);

    const posBefore = await getActiveLayerPosition(page);

    // Open Filter > Pixelate and enable Preview.
    await page.click('text=Filter');
    await page.click('text=Pixelate...');
    await expect(page.locator('h2:has-text("Pixelate")')).toBeVisible({ timeout: 3000 });

    const dialog = page.locator('h2:has-text("Pixelate")').locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    await dialog.locator('text=Preview').click();
    await page.waitForTimeout(200);

    // Drag the slider using real pointer events — this is what reproduces
    // the leak. `.fill()` bypasses the pointer path and would never catch it.
    const slider = dialog.locator('input[type="range"]');
    await expect(slider).toHaveCount(1);
    const sliderBox = await slider.boundingBox();
    expect(sliderBox).not.toBeNull();
    if (!sliderBox) return;

    // Start mid-track, drag to the right along the track.
    const startX = sliderBox.x + sliderBox.width * 0.3;
    const y = sliderBox.y + sliderBox.height / 2;
    const endX = sliderBox.x + sliderBox.width * 0.8;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(startX + (endX - startX) * t, y);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The layer MUST NOT have moved. If the pointer leaked, the move tool
    // would have shifted the layer by (endX - startX) in document units —
    // clearly non-zero.
    const posAfter = await getActiveLayerPosition(page);
    expect(posAfter.x).toBe(posBefore.x);
    expect(posAfter.y).toBe(posBefore.y);

    // Close the dialog so the test cleans up predictably.
    await dialog.locator('button:has-text("Cancel")').click();
    await expect(page.locator('h2:has-text("Pixelate")')).toHaveCount(0, { timeout: 3000 });
  });

  test('clicking the dialog backdrop does not move the active layer', async ({ page }) => {
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('move');
    });
    await page.waitForTimeout(50);

    const posBefore = await getActiveLayerPosition(page);

    await page.click('text=Filter');
    await page.click('text=Pixelate...');
    await expect(page.locator('h2:has-text("Pixelate")')).toBeVisible({ timeout: 3000 });

    // Click-and-drag on the overlay backdrop (outside the modal box). This
    // also covers the canvas and would leak to the move tool if the overlay
    // doesn't isolate pointer events.
    const overlay = page.locator('h2:has-text("Pixelate")').locator('xpath=ancestor::*[contains(@class,"overlay")][1]');
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    if (!overlayBox) return;

    // Pick a point near the top-left of the overlay, well outside the modal
    // content (the modal is centered, so the corner is pure backdrop).
    const bgX = overlayBox.x + 30;
    const bgY = overlayBox.y + 30;
    await page.mouse.move(bgX, bgY);
    await page.mouse.down();
    await page.mouse.move(bgX + 100, bgY + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const posAfter = await getActiveLayerPosition(page);
    expect(posAfter.x).toBe(posBefore.x);
    expect(posAfter.y).toBe(posBefore.y);

    // The dialog may or may not have dismissed itself on backdrop click —
    // both are defensible behaviors; we only care about the canvas. If still
    // open, cancel it to keep the page clean.
    const stillOpen = await page.locator('h2:has-text("Pixelate")').count();
    if (stillOpen > 0) {
      await page.keyboard.press('Escape');
    }
  });
});
