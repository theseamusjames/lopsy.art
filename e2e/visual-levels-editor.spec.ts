import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  drawRect,
  getRootGroupId,
  addAdjustment,
  openGroupEffectsPanel,
  setGroupBlendMode,
} from './helpers';

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

/**
 * Drag a Levels handle along its horizontal track. The handle and the
 * track are both selected by data-testid so the test isn't sensitive to
 * styling changes. Coordinates are computed from the track bounding
 * box, not the handle, because the handle moves while we drag.
 */
async function dragHandleAlongTrack(
  page: Page,
  trackTestId: string,
  handleTestId: string,
  targetFraction: number,
): Promise<void> {
  const handle = page.getByTestId(handleTestId);
  const track = page.getByTestId(trackTestId);
  await handle.waitFor({ state: 'visible' });
  await track.waitFor({ state: 'visible' });

  // The effects drawer can render past the viewport on small windows;
  // mouse.move does not auto-scroll the way locator.click does, so make
  // sure the track is on-screen before we issue manual mouse events.
  await track.scrollIntoViewIfNeeded();

  const trackBox = await track.boundingBox();
  const handleBox = await handle.boundingBox();
  if (!trackBox || !handleBox) throw new Error(`Missing bounding box for ${handleTestId}`);

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const targetX = trackBox.x + trackBox.width * Math.min(1, Math.max(0, targetFraction));
  const targetY = trackBox.y + trackBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('Visual levels editor', () => {
  // Google Fonts are reached over HTTPS in dev; the sandboxed e2e network
  // returns a CERT_AUTHORITY_INVALID for them. Not related to the feature.
  test.use({
    allowConsoleErrors: [/ERR_CERT_AUTHORITY_INVALID|Failed to load resource/],
    // The full Levels editor doesn't fit in the default 720px-tall viewport
    // once the effects drawer is open. Bump the viewport so screenshots
    // capture all of it without scrolling artefacts.
    viewport: { width: 1280, height: 1000 },
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);
  });

  test('handle drag remaps pixels and renders histogram + handles in panel', async ({ page }) => {
    // Mid-gray fill so the histogram has a single dominant column and
    // a handle drag has a deterministic effect on the rendered pixels.
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const rootGroupId = await getRootGroupId(page);
    await setGroupBlendMode(page, rootGroupId, 'normal');
    await openGroupEffectsPanel(page, rootGroupId);
    await addAdjustment(page, rootGroupId, 'levels');
    await page.waitForTimeout(400);

    // Sanity: histogram + handles are present.
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer.getByTestId('levels-editor')).toBeVisible();
    await expect(drawer.getByTestId('levels-histogram')).toBeVisible();
    await expect(drawer.getByTestId('levels-input-black-handle')).toBeVisible();
    await expect(drawer.getByTestId('levels-input-gamma-handle')).toBeVisible();
    await expect(drawer.getByTestId('levels-input-white-handle')).toBeVisible();
    await expect(drawer.getByTestId('levels-output-black-handle')).toBeVisible();
    await expect(drawer.getByTestId('levels-output-white-handle')).toBeVisible();

    // There must be no Slider components in the levels editor any more.
    await expect(drawer.getByTestId('levels-editor').locator('input[type="range"]')).toHaveCount(0);
    await expect(drawer.getByTestId('levels-editor').locator('input[type="number"]')).toHaveCount(0);

    // Baseline: pixel at (100,100) is mid-gray.
    const baseline = await readCompositedAtDoc(page, 100, 100);
    expect(baseline.r).toBeGreaterThan(110);
    expect(baseline.r).toBeLessThan(145);

    // Drag input white handle to ~50% — input value 128 now maps to ~255.
    await dragHandleAlongTrack(
      page,
      'levels-input-track',
      'levels-input-white-handle',
      0.5,
    );

    // The readout reflects the new input-white value.
    const inputWhiteText = await drawer.getByTestId('levels-input-white-value').textContent();
    const inputWhiteValue = Number((inputWhiteText ?? '').trim());
    expect(inputWhiteValue).toBeLessThan(160);
    expect(inputWhiteValue).toBeGreaterThan(110);

    // The composited pixel is significantly brighter than before.
    const brightened = await readCompositedAtDoc(page, 100, 100);
    expect(brightened.r).toBeGreaterThan(baseline.r + 50);
    expect(brightened.g).toBeGreaterThan(baseline.g + 50);
    expect(brightened.b).toBeGreaterThan(baseline.b + 50);

    // Isolated snapshot of just the editor — keeps the screenshot stable
    // against changes elsewhere in the app chrome.
    await drawer.getByTestId('levels-editor').screenshot({
      path: 'e2e/screenshots/visual-levels-editor-after-drag.png',
    });

    // Drag output black handle right — clamps darks higher, brightening
    // even further. Combined with the white drag the pixel should be
    // very bright or saturated.
    await dragHandleAlongTrack(
      page,
      'levels-output-track',
      'levels-output-black-handle',
      0.4,
    );

    const outBlackText = await drawer.getByTestId('levels-output-black-value').textContent();
    const outBlackValue = Number((outBlackText ?? '').trim());
    expect(outBlackValue).toBeGreaterThan(60);

    await drawer.getByTestId('levels-editor').screenshot({
      path: 'e2e/screenshots/visual-levels-editor-with-output-clamped.png',
    });

    // Reset button restores identity — pixel returns close to baseline.
    await drawer.getByTestId('levels-reset').click();
    await page.waitForTimeout(200);
    const afterReset = await readCompositedAtDoc(page, 100, 100);
    expect(Math.abs(afterReset.r - baseline.r)).toBeLessThan(8);

    await drawer.getByTestId('levels-editor').screenshot({
      path: 'e2e/screenshots/visual-levels-editor-identity.png',
    });
  });

  test('switching channel tabs updates the active handle values', async ({ page }) => {
    await drawRect(page, 0, 0, 200, 200, { r: 200, g: 80, b: 40 });
    await page.waitForTimeout(200);

    const rootGroupId = await getRootGroupId(page);
    await setGroupBlendMode(page, rootGroupId, 'normal');
    await openGroupEffectsPanel(page, rootGroupId);
    await addAdjustment(page, rootGroupId, 'levels');
    await page.waitForTimeout(300);

    const drawer = page.getByTestId('effects-drawer');

    // On the RGB tab, drag input black inward, then verify the R tab
    // shows the identity readouts (the edit was scoped to RGB only).
    await drawer.getByTestId('levels-channel-tab-rgb').click();
    await dragHandleAlongTrack(
      page,
      'levels-input-track',
      'levels-input-black-handle',
      0.3,
    );
    const rgbBlack = Number((await drawer.getByTestId('levels-input-black-value').textContent() ?? '').trim());
    expect(rgbBlack).toBeGreaterThan(40);

    await drawer.getByTestId('levels-channel-tab-r').click();
    const rBlack = Number((await drawer.getByTestId('levels-input-black-value').textContent() ?? '').trim());
    const rWhite = Number((await drawer.getByTestId('levels-input-white-value').textContent() ?? '').trim());
    expect(rBlack).toBe(0);
    expect(rWhite).toBe(255);
  });
});
