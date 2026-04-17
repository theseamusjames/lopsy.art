import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, paintRect } from './helpers';

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

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

/** Set levels on the root group and ensure adjustments are enabled. */
async function setGroupLevels(
  page: Page,
  levels: {
    rgb: { inputBlack: number; inputWhite: number; gamma: number; outputBlack: number; outputWhite: number };
    r: { inputBlack: number; inputWhite: number; gamma: number; outputBlack: number; outputWhite: number };
    g: { inputBlack: number; inputWhite: number; gamma: number; outputBlack: number; outputWhite: number };
    b: { inputBlack: number; inputWhite: number; gamma: number; outputBlack: number; outputWhite: number };
  },
): Promise<void> {
  await page.evaluate(({ lv }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { rootGroupId: string };
        setGroupAdjustments: (id: string, adj: Record<string, unknown>) => void;
        setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
      };
    };
    const state = store.getState();
    const groupId = state.document.rootGroupId;
    state.setGroupAdjustmentsEnabled(groupId, true);
    state.setGroupAdjustments(groupId, {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      whites: 0, blacks: 0, vignette: 0, saturation: 0, vibrance: 0,
      levels: lv,
    });
  }, { lv: levels });
}

/** Toggle adjustmentsEnabled on the root group. */
async function toggleGroupAdjustmentsEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(({ en }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { rootGroupId: string };
        setGroupAdjustmentsEnabled: (id: string, enabled: boolean) => void;
      };
    };
    const state = store.getState();
    state.setGroupAdjustmentsEnabled(state.document.rootGroupId, en);
  }, { en: enabled });
}

const IDENTITY_CHANNEL = { inputBlack: 0, inputWhite: 1, gamma: 1, outputBlack: 0, outputWhite: 1 };

test.describe('Levels visibility toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
  });

  test('toggling adjustments off removes levels, toggling back on restores them', async ({ page }) => {
    // Paint a white rect so we have known pixel content.
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 255, b: 255, a: 255 });
    await page.waitForTimeout(200);

    // Baseline: pixel at (0,0) should be white.
    const baseline = await readCompositedAtDoc(page, 0, 0);
    expect(baseline.r, 'baseline should be white').toBeGreaterThan(250);

    // Set levels with inputBlack=1.0 on master — maps everything to black.
    await setGroupLevels(page, {
      rgb: { inputBlack: 1, inputWhite: 1, gamma: 1, outputBlack: 0, outputWhite: 0 },
      r: IDENTITY_CHANNEL,
      g: IDENTITY_CHANNEL,
      b: IDENTITY_CHANNEL,
    });
    await page.waitForTimeout(300);

    // Step 1: Pixel should now be black.
    const withLevels = await readCompositedAtDoc(page, 0, 0);
    expect(withLevels.r, 'with levels inputBlack=255, pixel should be black').toBeLessThan(5);
    expect(withLevels.g).toBeLessThan(5);
    expect(withLevels.b).toBeLessThan(5);

    // Step 2: Toggle adjustments OFF — levels should be removed, pixel white.
    await toggleGroupAdjustmentsEnabled(page, false);
    await page.waitForTimeout(300);

    const disabled = await readCompositedAtDoc(page, 0, 0);
    expect(disabled.r, 'with adjustments disabled, pixel should be white').toBeGreaterThan(250);
    expect(disabled.g).toBeGreaterThan(250);
    expect(disabled.b).toBeGreaterThan(250);

    // Step 3: Toggle adjustments back ON — levels should be restored, pixel black.
    await toggleGroupAdjustmentsEnabled(page, true);
    await page.waitForTimeout(300);

    const reEnabled = await readCompositedAtDoc(page, 0, 0);
    expect(reEnabled.r, 'with adjustments re-enabled, pixel should be black again').toBeLessThan(5);
    expect(reEnabled.g).toBeLessThan(5);
    expect(reEnabled.b).toBeLessThan(5);
  });
});
