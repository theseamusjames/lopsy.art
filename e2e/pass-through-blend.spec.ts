import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, drawRect, setBlendMode, setActiveLayer } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

/**
 * Read a single pixel from the composited WebGL canvas at the given document
 * coordinates. The WebGL buffer is bottom-up, so the Y-flip is applied here.
 */
async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<PixelSnap | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

/**
 * Get the blend mode of a layer from the store.
 */
async function getLayerBlendMode(page: Page, layerId: string): Promise<string> {
  return page.evaluate(({ lid }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; blendMode: string }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    return layer?.blendMode ?? '';
  }, { lid: layerId });
}

/**
 * Create a new group and return its id. The group ends up selected.
 */
async function addGroup(page: Page, name: string): Promise<string> {
  await page.evaluate(({ n }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addGroup: (name: string) => void };
    };
    store.getState().addGroup(n);
  }, { n: name });
  await page.waitForTimeout(100);
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

/**
 * Set the blend mode on a layer via the store.
 */
async function setLayerBlendMode(page: Page, layerId: string, mode: string): Promise<void> {
  await page.evaluate(({ lid, mode }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        pushHistory: (label: string) => void;
        updateLayerBlendMode: (id: string, mode: string) => void;
      };
    };
    const s = store.getState();
    s.pushHistory('Change Blend Mode');
    s.updateLayerBlendMode(lid, mode);
  }, { lid: layerId, mode });
  await page.waitForTimeout(100);
}

/**
 * Set group adjustments (exposure) via the store. This simulates the AdjustmentsPanel.
 */
async function setGroupExposure(page: Page, groupId: string, exposure: number): Promise<void> {
  await page.evaluate(({ gid, exp }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        pushHistory: (label: string) => void;
        setGroupAdjustments: (id: string, adj: Record<string, number>) => void;
        setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
      };
    };
    const s = store.getState();
    s.setGroupAdjustmentsEnabled(gid, true);
    s.setGroupAdjustments(gid, { exposure: exp });
    s.pushHistory('Set Group Exposure');
  }, { gid: groupId, exp: exposure });
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Pass-through blend mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // 100x100 transparent document for predictable compositing
    await createDocument(page, 100, 100, true);
    await page.waitForTimeout(300);
  });

  test('new groups default to pass-through blend mode', async ({ page }) => {
    const groupId = await addGroup(page, 'TestGroup');
    const mode = await getLayerBlendMode(page, groupId);
    expect(mode).toBe('pass-through');
  });

  test('pass-through group: 50% opacity group with black child over white yields mid-grey', async ({ page }) => {
    // Setup:
    //   Layer A (white, fills canvas) — background
    //   Group at 50% opacity in pass-through mode
    //     Layer B (black, fills canvas)
    //
    // With pass-through: child effective opacity = child opacity * group opacity = 1.0 * 0.5 = 0.5
    // Result: 50% black over white = mid-grey (~127)

    await drawRect(page, 0, 0, 100, 100, { r: 255, g: 255, b: 255 });
    await page.waitForTimeout(200);

    const groupId = await addGroup(page, 'OpacityGroup');

    // Add black layer inside group
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(200);
    await drawRect(page, 0, 0, 100, 100, { r: 0, g: 0, b: 0 });
    await page.waitForTimeout(200);

    // Set group opacity to 50% — group is pass-through by default
    await page.evaluate(({ gid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (label: string) => void;
          updateLayerOpacity: (id: string, opacity: number) => void;
        };
      };
      const s = store.getState();
      s.pushHistory('Change Opacity');
      s.updateLayerOpacity(gid, 0.5);
    }, { gid: groupId });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/pass-through-opacity.png' });

    // Pixel should be mid-grey (50% black over white)
    const pixel = await readCompositedAtDoc(page, 50, 50);
    expect(pixel.r, 'pass-through 50% group: result should be mid-grey').toBeGreaterThan(100);
    expect(pixel.r, 'pass-through 50% group: result should be mid-grey').toBeLessThan(200);
    expect(pixel.g).toBeGreaterThan(100);
    expect(pixel.b).toBeGreaterThan(100);
  });

  test('normal group with adjustments brightens children; pass-through group does not', async ({ page }) => {
    // Setup:
    //   Layer A (mid-grey [128,128,128]) — background
    //   Group with exposure=2.0 (brightening adjustment)
    //     Layer B (mid-grey [128,128,128])
    //
    // Normal group + adjustments registered via setGroupAdjustments:
    //   children composite into group scratch FBO → exposure applied → result is brighter
    //
    // Pass-through group:
    //   syncGroupAdjustments skips it → no scratch FBO → children blend directly
    //   → result is just mid-grey (same as without the group)
    //
    // The pixel brightness in normal mode should be significantly higher than pass-through.

    // Draw mid-grey background on base layer
    await drawRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const groupId = await addGroup(page, 'AdjustGroup');

    // Add mid-grey child inside group
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(200);
    await drawRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    // Switch group to Normal blend mode so adjustments register
    await setLayerBlendMode(page, groupId, 'normal');
    await page.waitForTimeout(200);

    // Enable high exposure on the group
    await setGroupExposure(page, groupId, 2.0);

    // Screenshot: normal group + high exposure = brighter children
    await page.screenshot({ path: 'e2e/screenshots/pass-through-normal-with-adj.png' });

    const normalPixel = await readCompositedAtDoc(page, 50, 50);

    // Switch to pass-through — syncGroupAdjustments will skip this group
    await setLayerBlendMode(page, groupId, 'pass-through');
    await page.waitForTimeout(300);

    // Screenshot: pass-through group + high exposure = exposure NOT applied
    await page.screenshot({ path: 'e2e/screenshots/pass-through-pass-with-adj.png' });

    const passThroughPixel = await readCompositedAtDoc(page, 50, 50);

    // Normal group should be significantly brighter (exposure applied)
    // Pass-through group should show near-original grey
    expect(
      normalPixel.r,
      `normal group with exposure=2.0 should be bright (got ${normalPixel.r})`,
    ).toBeGreaterThan(180);
    expect(
      passThroughPixel.r,
      `pass-through group should not apply exposure, should stay near grey (got ${passThroughPixel.r})`,
    ).toBeLessThan(180);

    const brightnessDiff = normalPixel.r - passThroughPixel.r;
    expect(
      brightnessDiff,
      `normal (${normalPixel.r}) should be noticeably brighter than pass-through (${passThroughPixel.r})`,
    ).toBeGreaterThan(30);
  });

  test('blend mode dropdown shows Pass Through option for group layers', async ({ page }) => {
    const groupId = await addGroup(page, 'DropdownGroup');
    await setActiveLayer(page, groupId);
    await page.waitForTimeout(100);

    // Open the effects drawer for this group via setBlendMode helper which handles opening it
    // We need to trigger the effects drawer to open for the group
    const groupRow = page.locator(`[data-layer-id="${groupId}"]`);
    await groupRow.locator('button[aria-label*="effects"]').click();
    await page.waitForTimeout(300);

    // The blend mode dropdown should have a "Pass Through" option
    const select = page.locator('[aria-labelledby="blend-mode-label"]');
    await expect(select).toBeVisible();

    const passThroughOption = select.locator('option[value="pass-through"]');
    await expect(passThroughOption).toHaveText('Pass Through');

    // Take screenshot showing the blend mode dropdown with pass-through option
    await page.screenshot({ path: 'e2e/screenshots/pass-through-dropdown.png' });
  });

  test('switching group from normal to pass-through disables group adjustments compositing', async ({ page }) => {
    // Verify that once we switch a group from normal→pass-through, the
    // adjustment that was previously brightening its children no longer applies.

    // White background
    await drawRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const groupId = await addGroup(page, 'SwitchGroup');

    // Add child layer
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(200);
    await drawRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    // Set to normal mode + high exposure so adjustment applies
    await setLayerBlendMode(page, groupId, 'normal');
    await setGroupExposure(page, groupId, 2.5);

    const withAdjPixel = await readCompositedAtDoc(page, 50, 50);
    await page.screenshot({ path: 'e2e/screenshots/pass-through-switch-before.png' });

    // Switch to pass-through — adjustment should no longer be registered
    await setLayerBlendMode(page, groupId, 'pass-through');
    await page.waitForTimeout(300);

    const afterSwitchPixel = await readCompositedAtDoc(page, 50, 50);
    await page.screenshot({ path: 'e2e/screenshots/pass-through-switch-after.png' });

    // After switch to pass-through, adjustment is gone → pixels should be darker
    expect(
      withAdjPixel.r,
      `normal group with exposure=2.5 should be bright (got ${withAdjPixel.r})`,
    ).toBeGreaterThan(200);
    expect(
      afterSwitchPixel.r,
      `pass-through group: adjustment no longer applies, should be near grey (got ${afterSwitchPixel.r})`,
    ).toBeLessThan(200);
    expect(
      withAdjPixel.r - afterSwitchPixel.r,
      `brightness should drop after switching to pass-through`,
    ).toBeGreaterThan(30);
  });
});
