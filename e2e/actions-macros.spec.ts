/**
 * Actions / Macros — E2E spec
 *
 * Records a filter application, replays it on the same image, and asserts
 * that the filter was applied a second time.
 *
 * Strategy: "Invert" is the simplest filter (no dialog, no params).  We
 * paint a solid red layer, record an Invert application, undo back to red,
 * then play the recorded action and verify the layer is no longer red.
 */

import { test, expect } from './fixtures';
import { waitForStore, createDocument, getPixelAt } from './helpers';

async function openActionsPanel(page: Parameters<typeof waitForStore>[0]): Promise<void> {
  await page.locator('[aria-label="Actions"]').click();
  await page.waitForTimeout(100);
}

async function paintSolidRed(page: Parameters<typeof waitForStore>[0]): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    state.pushHistory('Paint red');
    const { width: w, height: h } = state.document;
    const data = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      data.data[i * 4] = 255;     // R
      data.data[i * 4 + 1] = 0;   // G
      data.data[i * 4 + 2] = 0;   // B
      data.data[i * 4 + 3] = 255; // A
    }
    state.updateLayerPixelData(id, data);
  });
}

test.describe('Actions / Macros', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('record a filter step, play it back, and verify the filter applied', async ({ page }) => {
    await createDocument(page, 30, 30, true);
    await paintSolidRed(page);

    // Verify the initial state — layer should be solid red.
    const beforeRecord = await getPixelAt(page, 15, 15);
    expect(beforeRecord.r, 'initial r').toBe(255);
    expect(beforeRecord.g, 'initial g').toBe(0);
    expect(beforeRecord.b, 'initial b').toBe(0);

    // Open the Actions panel.
    await openActionsPanel(page);
    await expect(page.locator('[aria-label="Actions panel"]')).toBeVisible({ timeout: 3000 });

    // Start recording.
    await page.locator('[aria-label="Start recording"]').click();
    await expect(page.locator('[aria-label="Stop recording"]')).toBeVisible({ timeout: 2000 });

    // Apply Filter → Invert (no dialog — instant apply).
    await page.click('text=Filter');
    await page.click('text=Invert');
    await page.waitForTimeout(200);

    // Verify the filter was applied: red → cyan (255,0,0) → (0,255,255).
    const afterInvert = await getPixelAt(page, 15, 15);
    expect(afterInvert.r, 'after invert r').toBe(0);
    expect(afterInvert.g, 'after invert g').toBe(255);
    expect(afterInvert.b, 'after invert b').toBe(255);

    // Stop recording — a name form appears.
    await page.locator('[aria-label="Stop recording"]').click();
    await expect(page.locator('[aria-label="Action name"]')).toBeVisible({ timeout: 2000 });

    // Type a name and save.
    await page.locator('[aria-label="Action name"]').fill('Invert action');
    await page.locator('button:has-text("Save")').click();
    await page.waitForTimeout(100);

    // Verify the action appears in the panel.
    await expect(page.locator('[data-action-id]')).toHaveCount(1, { timeout: 2000 });

    // Undo the filter to restore the red layer.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    const afterUndo = await getPixelAt(page, 15, 15);
    expect(afterUndo.r, 'after undo r').toBe(255);
    expect(afterUndo.g, 'after undo g').toBe(0);
    expect(afterUndo.b, 'after undo b').toBe(0);

    // Take screenshot of current state for the reviewer.
    await page.screenshot({ path: 'e2e/screenshots/actions-macros-before-playback.png' });

    // Play the recorded action by clicking its Play button.
    await page.locator('[data-action-id]').locator('[aria-label*="Play"]').click();
    // Wait for playback to complete (50ms delay per step + buffer).
    await page.waitForTimeout(500);

    // Take screenshot after playback.
    await page.screenshot({ path: 'e2e/screenshots/actions-macros-after-playback.png' });

    // Verify the filter was re-applied: layer should be cyan again.
    const afterPlayback = await getPixelAt(page, 15, 15);
    expect(afterPlayback.r, 'after playback r').toBe(0);
    expect(afterPlayback.g, 'after playback g').toBe(255);
    expect(afterPlayback.b, 'after playback b').toBe(255);
  });

  test('cancel recording discards steps and saves no action', async ({ page }) => {
    await createDocument(page, 30, 30, true);

    await openActionsPanel(page);
    await expect(page.locator('[aria-label="Actions panel"]')).toBeVisible({ timeout: 3000 });

    // Start recording.
    await page.locator('[aria-label="Start recording"]').click();
    await expect(page.locator('[aria-label="Stop recording"]')).toBeVisible({ timeout: 2000 });

    // Apply a filter.
    await page.click('text=Filter');
    await page.click('text=Invert');
    await page.waitForTimeout(200);

    // Verify step count shows 1 step.
    await expect(page.getByRole('status')).toContainText('1 step', { timeout: 2000 });

    // Stop recording, then cancel on the name form.
    await page.locator('[aria-label="Stop recording"]').click();
    await expect(page.locator('[aria-label="Action name"]')).toBeVisible({ timeout: 2000 });
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(100);

    // No actions should have been saved.
    await expect(page.locator('[data-action-id]')).toHaveCount(0);
    await expect(page.locator('text=No actions saved')).toBeVisible();
  });

  test('delete action removes it from the list', async ({ page }) => {
    await createDocument(page, 30, 30, true);
    await paintSolidRed(page);

    await openActionsPanel(page);
    await expect(page.locator('[aria-label="Actions panel"]')).toBeVisible({ timeout: 3000 });

    // Record an action.
    await page.locator('[aria-label="Start recording"]').click();
    await page.click('text=Filter');
    await page.click('text=Invert');
    await page.waitForTimeout(200);
    await page.locator('[aria-label="Stop recording"]').click();
    await page.locator('[aria-label="Action name"]').fill('To delete');
    await page.locator('button:has-text("Save")').click();
    await page.waitForTimeout(100);

    await expect(page.locator('[data-action-id]')).toHaveCount(1);

    // Delete the action.
    await page.locator('[data-action-id]').locator('[aria-label*="Delete"]').click();
    await page.waitForTimeout(100);

    await expect(page.locator('[data-action-id]')).toHaveCount(0);
    await expect(page.locator('text=No actions saved')).toBeVisible();
  });

  test('expand action row shows step details', async ({ page }) => {
    await createDocument(page, 30, 30, true);
    await paintSolidRed(page);

    await openActionsPanel(page);
    await expect(page.locator('[aria-label="Actions panel"]')).toBeVisible({ timeout: 3000 });

    // Record an invert step.
    await page.locator('[aria-label="Start recording"]').click();
    await page.click('text=Filter');
    await page.click('text=Invert');
    await page.waitForTimeout(200);
    await page.locator('[aria-label="Stop recording"]').click();
    await page.locator('[aria-label="Action name"]').fill('Invert steps');
    await page.locator('button:has-text("Save")').click();
    await page.waitForTimeout(100);

    // Steps are hidden by default.
    await expect(page.locator('[aria-label*="Steps in"]')).not.toBeVisible();

    // Click the expand button (the action name button).
    await page.locator('[aria-label*="Expand Invert steps"]').click();
    await page.waitForTimeout(100);

    // The step list should now be visible and contain "invert".
    await expect(page.locator('[aria-label*="Steps in"]')).toBeVisible();
    await expect(page.locator('text=Filter: invert')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/actions-macros-expanded-steps.png' });
  });
});
