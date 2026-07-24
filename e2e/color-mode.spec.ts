/**
 * Document Color Mode
 *
 * Verifies the Image > Mode submenu, the status-bar mode badge, the destructive
 * per-mode pixel bake and its undo, paint-time color snapping, per-mode
 * adjustment gating, and save/load persistence of the mode.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  drawRect,
  undo,
  getEditorState,
  getRootGroupId,
  openGroupEffectsPanel,
  addLayer,
} from './helpers';

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

/** Read one composited pixel at a document coordinate (buffer is bottom-up). */
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

async function openImageModeSubmenu(page: Page): Promise<void> {
  await page.click('nav button:has-text("Image")');
  await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
  await page.hover('[role="menuitem"]:has-text("Mode")');
  await page.waitForSelector('[role="menuitem"]:has-text("RGB Color")', { timeout: 5_000 });
}

async function selectColorMode(page: Page, label: string): Promise<void> {
  await openImageModeSubmenu(page);
  await page.click(`[role="menuitem"]:has-text("${label}")`);
}

/** Drive Image > Mode > Indexed Color... through its conversion dialog. */
async function convertToIndexed(page: Page, colors: number, dither = false): Promise<void> {
  await selectColorMode(page, 'Indexed Color');
  const dialog = page.locator('[role="dialog"][aria-label="Indexed Color"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('#indexed-colors').fill(String(colors));
  if (dither) await dialog.locator('input[type="checkbox"]').check();
  await dialog.locator('button:has-text("Convert")').click();
  await expect(dialog).toHaveCount(0);
}

async function getColorMode(page: Page): Promise<string> {
  const state = await getEditorState(page);
  return (state.document as { colorMode: string }).colorMode;
}

test.describe('Document color mode', () => {
  test('Image > Mode lists all modes with RGB checked by default', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await openImageModeSubmenu(page);

    for (const label of ['RGB Color', 'Grayscale', 'Indexed Color', 'CMYK Color', 'Lab Color']) {
      await expect(page.locator(`[role="menuitem"]:has-text("${label}")`)).toBeVisible();
    }

    // RGB is the active mode → its item carries the checkmark; the others don't.
    await expect(page.locator('[role="menuitem"]:has-text("RGB Color")')).toContainText('✓');
    await expect(page.locator('[role="menuitem"]:has-text("Grayscale")')).not.toContainText('✓');
  });

  test('converting to Grayscale updates the store + status bar, and undo reverts', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    expect(await getColorMode(page)).toBe('rgb');
    // RGB shows no dedicated mode badge.
    await expect(page.locator('[aria-label="Status bar"]')).not.toContainText('Grayscale');

    await selectColorMode(page, 'Grayscale');

    expect(await getColorMode(page)).toBe('grayscale');
    await expect(page.locator('[aria-label="Status bar"]')).toContainText('Grayscale');

    // The checkmark now follows the active mode.
    await openImageModeSubmenu(page);
    await expect(page.locator('[role="menuitem"]:has-text("Grayscale")')).toContainText('✓');
    await page.keyboard.press('Escape');

    await undo(page);
    expect(await getColorMode(page)).toBe('rgb');
    await expect(page.locator('[aria-label="Status bar"]')).not.toContainText('Grayscale');
  });

  test('converting to Grayscale bakes layer pixels to neutral, and undo restores color', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Pure red at doc (80, 80): Rec.709 luma → 0.2126*255 ≈ 54 on all channels.
    await drawRect(page, 40, 40, 80, 80, { r: 255, g: 0, b: 0 });
    const before = await readCompositedAtDoc(page, 80, 80);
    expect(before.r).toBeGreaterThan(200);
    expect(before.g).toBeLessThan(60);

    await selectColorMode(page, 'Grayscale');

    const after = await readCompositedAtDoc(page, 80, 80);
    expect(Math.abs(after.r - after.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.g - after.b)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.r - 54)).toBeLessThanOrEqual(4);

    await undo(page);
    const restored = await readCompositedAtDoc(page, 80, 80);
    expect(restored.r).toBeGreaterThan(200);
    expect(restored.g).toBeLessThan(60);
  });

  test('painting in Grayscale snaps the color even when a chromatic hex is typed', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await selectColorMode(page, 'Grayscale');
    // drawRect types a hex into the color panel — grayscale must clamp it.
    await drawRect(page, 40, 40, 80, 80, { r: 0, g: 0, b: 255 });

    const px = await readCompositedAtDoc(page, 80, 80);
    expect(Math.abs(px.r - px.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(px.g - px.b)).toBeLessThanOrEqual(2);
    // Pure blue's luma is ~18 — a non-snapped blue would read b≈255.
    expect(px.b).toBeLessThan(60);
  });

  test('RGB offers chroma adjustments in the Add menu', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await openGroupEffectsPanel(page, await getRootGroupId(page));
    await page.locator('[aria-label="Add Adjustment"]').click();

    await expect(page.locator('[role="menuitem"]:has-text("Hue")')).toBeVisible();
    await expect(page.locator('[role="menuitem"]:has-text("Color Balance")')).toBeVisible();
    await expect(page.locator('[role="menuitem"]:has-text("Exposure")')).toBeVisible();
  });

  test('Grayscale hides chroma adjustments but keeps luminance ones', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await selectColorMode(page, 'Grayscale');

    await openGroupEffectsPanel(page, await getRootGroupId(page));
    await page.locator('[aria-label="Add Adjustment"]').click();

    await expect(page.locator('[role="menuitem"]:has-text("Exposure")')).toBeVisible();
    await expect(page.locator('[role="menuitem"]:has-text("Hue")')).toHaveCount(0);
    await expect(page.locator('[role="menuitem"]:has-text("Color Balance")')).toHaveCount(0);
    await expect(page.locator('[role="menuitem"]:has-text("Channel Mixer")')).toHaveCount(0);
  });

  test('color mode survives a save/load round-trip', async ({ page, allowConsoleErrors }) => {
    (allowConsoleErrors as RegExp[]).push(/403|404|Failed to load resource|WebSocket connection/);
    test.setTimeout(120_000);

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 120, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await selectColorMode(page, 'Grayscale');
    expect(await getColorMode(page)).toBe('grayscale');

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
      const saveFn = (window as unknown as Record<string, unknown>).__saveProject as () => Promise<void>;
      await saveFn();
    });
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const lopsyBase64 = Buffer.concat(chunks).toString('base64');

    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });

    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], 'color-mode.lopsy', { type: 'application/octet-stream' });
      const loadFn = (window as unknown as Record<string, unknown>).__loadProject as (f: File) => Promise<void>;
      await loadFn(file);
    }, lopsyBase64);

    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 20_000 });
    await page.waitForTimeout(400);

    expect(await getColorMode(page)).toBe('grayscale');
    await expect(page.locator('[aria-label="Status bar"]')).toContainText('Grayscale');
  });

  test('Indexed conversion flattens, builds a palette, and constrains painting to it', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 20, 20, 60, 60, { r: 255, g: 0, b: 0 });
    await drawRect(page, 110, 20, 60, 60, { r: 0, g: 0, b: 255 });

    await convertToIndexed(page, 4);

    const state = await getEditorState(page);
    const doc = state.document as { colorMode: string; indexedPalette?: unknown[] };
    expect(doc.colorMode).toBe('indexed');
    expect(doc.indexedPalette?.length).toBeGreaterThan(0);
    expect(doc.indexedPalette?.length).toBeLessThanOrEqual(4);

    // Flattened to a single pixel layer (plus the root group).
    const rasterCount = (state.document as { layers: { type: string }[] }).layers
      .filter((l) => l.type !== 'group').length;
    expect(rasterCount).toBe(1);

    // Every composited pixel now comes from the palette.
    const palette = (doc.indexedPalette ?? []) as { r: number; g: number; b: number }[];
    for (const [x, y] of [[50, 50], [140, 50], [180, 180]] as const) {
      const px = await readCompositedAtDoc(page, x, y);
      const hit = palette.some((p) => Math.abs(p.r - px.r) <= 2 && Math.abs(p.g - px.g) <= 2 && Math.abs(p.b - px.b) <= 2);
      expect(hit, `pixel (${x},${y}) rgb(${px.r},${px.g},${px.b}) is not a palette color`).toBe(true);
    }

    await expect(page.getByTestId('indexed-palette')).toBeVisible();
  });

  test('Indexed mode refuses new layers and undo restores the layer stack', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 120, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await addLayer(page);
    const beforeLayers = (await getEditorState(page)).document.layers.length;

    await convertToIndexed(page, 16);
    const flattened = (await getEditorState(page)).document.layers.length;
    expect(flattened).toBeLessThan(beforeLayers);

    await addLayer(page);
    expect((await getEditorState(page)).document.layers.length).toBe(flattened);

    // Flatten + convert is a single undo step.
    await undo(page);
    const restored = await getEditorState(page);
    expect((restored.document as { colorMode: string }).colorMode).toBe('rgb');
    expect(restored.document.layers.length).toBe(beforeLayers);
  });
});
