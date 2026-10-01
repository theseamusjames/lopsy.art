import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  closeEffectsPanel,
  createDocument,
  drawRect,
  enableEffect,
  getEditorState,
  setBlendMode,
  setEffectColor,
  setLayerOpacity,
  waitForStore,
} from './helpers';

// #1068: Merge Down reset the lower layer's blend mode to Normal (and threw
// its effects away), so merging even a layer that touches nothing below it
// changed the composite: a Multiply overlap turned from black to blue.

interface Rgb { r: number; g: number; b: number }
interface DocPoint { x: number; y: number }

async function readComposited(page: Page, points: DocPoint[]): Promise<Rgb[]> {
  return page.evaluate(async (pts) => {
    const w = window as unknown as Record<string, unknown>;
    const readFn = w.__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const snap = await readFn();
    if (!snap) return [];
    const state = (w.__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    }).getState();
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const ratio = snap.width / container.clientWidth;
    const cssW = snap.width / ratio;
    const cssH = snap.height / ratio;
    return pts.map(({ x, y }) => {
      const sx = Math.floor(((x + 0.5 - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cssW / 2) * ratio);
      const sy = Math.floor(((y + 0.5 - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cssH / 2) * ratio);
      const idx = ((snap.height - 1 - sy) * snap.width + sx) * 4;
      return { r: snap.pixels[idx] ?? 0, g: snap.pixels[idx + 1] ?? 0, b: snap.pixels[idx + 2] ?? 0 };
    });
  }, points);
}

async function mergeDownFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Merge Down' }).click();
  await page.waitForTimeout(200);
}

function expectClose(actual: Rgb, expected: Rgb, tolerance = 3): void {
  expect(Math.abs(actual.r - expected.r), `r of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g), `g of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b), `b of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
}

async function layerStyle(page: Page, layerId: string) {
  const state = await getEditorState(page);
  const layer = state.document.layers.find((l) => l.id === layerId) as unknown as {
    blendMode: string;
    opacity: number;
    effects: { colorOverlay: { enabled: boolean } };
  };
  return layer;
}

test.describe('Merge Down keeps the lower layer\'s blending (#1068)', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('merging an unrelated layer into a Multiply layer leaves the composite unchanged', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    await addLayer(page);
    await drawRect(page, 50, 50, 200, 200, { r: 255, g: 0, b: 0 });
    const multiplyId = await addLayer(page);
    await drawRect(page, 150, 100, 200, 180, { r: 0, g: 0, b: 255 });
    await setBlendMode(page, 'multiply');
    await closeEffectsPanel(page);
    await addLayer(page);
    await drawRect(page, 300, 20, 80, 60, { r: 0, g: 200, b: 0 });

    // Overlap, blue-only, green-only and the untouched white corner.
    const probes = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 340, y: 50 }, { x: 20, y: 280 }];
    const before = await readComposited(page, probes);
    expectClose(before[0]!, { r: 0, g: 0, b: 0 });
    expectClose(before[1]!, { r: 0, g: 0, b: 255 });
    expectClose(before[2]!, { r: 0, g: 200, b: 0 });
    expectClose(before[3]!, { r: 255, g: 255, b: 255 });

    await mergeDownFromMenu(page);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-blend-mode-1068-multiply.png' });

    const after = await readComposited(page, probes);
    for (let i = 0; i < probes.length; i++) expectClose(after[i]!, before[i]!);

    const state = await getEditorState(page);
    expect(state.document.activeLayerId).toBe(multiplyId);
    expect((await layerStyle(page, multiplyId)).blendMode).toBe('multiply');

    // The drawer's Blend menu shows the surviving layer's mode too.
    await page.locator(`[data-layer-id="${multiplyId}"] button[aria-label*="effects"]`).click();
    await expect(page.locator('[aria-labelledby="blend-mode-label"]')).toHaveValue('multiply');
    await closeEffectsPanel(page);
  });

  test('the lower layer keeps its live effects and opacity, applied to the merged content', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    const lowerId = await addLayer(page);
    await drawRect(page, 40, 40, 120, 120, { r: 255, g: 0, b: 0 });
    await enableEffect(page, 'Color Overlay');
    await setEffectColor(page, 'Overlay color', 0, 0, 255);
    await closeEffectsPanel(page);
    await setLayerOpacity(page, lowerId, 50);
    await page.keyboard.press('Escape');

    await addLayer(page);
    await drawRect(page, 240, 140, 100, 100, { r: 0, g: 200, b: 0 });

    // Lower square: 50% blue overlay over white. Upper square: plain green.
    const probes = [{ x: 100, y: 100 }, { x: 290, y: 190 }, { x: 20, y: 280 }];
    const before = await readComposited(page, probes);
    expectClose(before[0]!, { r: 128, g: 128, b: 255 });
    expectClose(before[1]!, { r: 0, g: 200, b: 0 });

    await mergeDownFromMenu(page);
    await page.screenshot({ path: 'e2e/screenshots/merge-down-blend-mode-1068-effects.png' });

    const after = await readComposited(page, probes);
    // The lower layer's own pixels look exactly as before.
    expectClose(after[0]!, before[0]!);
    expectClose(after[2]!, before[2]!);
    // The merged-in square now belongs to the lower layer, so its overlay
    // and opacity apply to it — as in Photoshop's Merge Down.
    expectClose(after[1]!, { r: 128, g: 128, b: 255 });

    const style = await layerStyle(page, lowerId);
    expect(style.effects.colorOverlay.enabled).toBe(true);
    expect(style.opacity).toBeCloseTo(0.5, 2);
    await expect(page.locator(`[data-layer-id="${lowerId}"] button[aria-label^="Opacity 50%"]`)).toBeVisible();
  });

  test('a Normal lower layer without effects still bakes its opacity', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);

    const lowerId = await addLayer(page);
    await drawRect(page, 40, 40, 120, 120, { r: 255, g: 0, b: 0 });
    await setLayerOpacity(page, lowerId, 50);
    await page.keyboard.press('Escape');
    await addLayer(page);
    await drawRect(page, 240, 140, 100, 100, { r: 0, g: 200, b: 0 });

    const probes = [{ x: 100, y: 100 }, { x: 290, y: 190 }];
    const before = await readComposited(page, probes);
    expectClose(before[0]!, { r: 255, g: 128, b: 128 });
    expectClose(before[1]!, { r: 0, g: 200, b: 0 });

    await mergeDownFromMenu(page);

    expect((await layerStyle(page, lowerId)).opacity).toBe(1);
    const after = await readComposited(page, probes);
    expectClose(after[0]!, before[0]!);
    expectClose(after[1]!, before[1]!);
  });
});
