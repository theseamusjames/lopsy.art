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
  openColorPanel,
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

  test('Lab conversion preserves appearance — encoded pixels decode back to the same color', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 40, 40, 80, 80, { r: 200, g: 90, b: 40 });
    const before = await readCompositedAtDoc(page, 80, 80);

    await selectColorMode(page, 'Lab Color');
    expect(await getColorMode(page)).toBe('lab');

    // Lab contains sRGB, so the bake is appearance-preserving. What the screen
    // shows must survive the encode + GLSL decode round trip. 8-bit a/b
    // quantization costs a few units.
    const after = await readCompositedAtDoc(page, 80, 80);
    expect(Math.abs(after.r - before.r)).toBeLessThanOrEqual(6);
    expect(Math.abs(after.g - before.g)).toBeLessThanOrEqual(6);
    expect(Math.abs(after.b - before.b)).toBeLessThanOrEqual(6);

    // The layer texture must now hold encoded Lab rather than sRGB. Sample the
    // most common opaque pixel of the drawn layer: if the texture were still
    // sRGB it would equal what the screen shows.
    const raw = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string | null } };
      };
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await read(store.getState().document.activeLayerId ?? undefined);
      const counts = new Map<string, number>();
      for (let i = 0; i < result.pixels.length; i += 4) {
        if ((result.pixels[i + 3] ?? 0) < 250) continue;
        const key = `${result.pixels[i]},${result.pixels[i + 1]},${result.pixels[i + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let bestKey = '';
      let bestCount = 0;
      for (const [key, count] of counts) {
        if (count > bestCount) { bestCount = count; bestKey = key; }
      }
      const [r, g, b] = bestKey.split(',').map(Number);
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, count: bestCount };
    });
    expect(raw.count).toBeGreaterThan(0);
    // Chroma is encoded as an offset from 128, so a/b move off neutral.
    expect(Math.abs(raw.g - 128) + Math.abs(raw.b - 128)).toBeGreaterThan(20);
    // And the stored triple is not the sRGB the screen shows.
    const storedMatchesDisplay =
      Math.abs(raw.r - after.r) <= 4 && Math.abs(raw.g - after.g) <= 4 && Math.abs(raw.b - after.b) <= 4;
    expect(storedMatchesDisplay).toBe(false);

    await undo(page);
    const restored = await readCompositedAtDoc(page, 80, 80);
    expect(Math.abs(restored.r - before.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(restored.g - before.g)).toBeLessThanOrEqual(2);
  });

  test('leaving Lab decodes back to sRGB rather than leaving encoded pixels', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 150, 150, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 30, 30, 70, 70, { r: 40, g: 160, b: 210 });
    const before = await readCompositedAtDoc(page, 60, 60);

    await selectColorMode(page, 'Lab Color');
    await selectColorMode(page, 'RGB Color');
    expect(await getColorMode(page)).toBe('rgb');

    const after = await readCompositedAtDoc(page, 60, 60);
    expect(Math.abs(after.r - before.r)).toBeLessThanOrEqual(6);
    expect(Math.abs(after.g - before.g)).toBeLessThanOrEqual(6);
    expect(Math.abs(after.b - before.b)).toBeLessThanOrEqual(6);
  });

  test('Lab mode shows L/a/b sliders instead of R/G/B', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 120, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await openColorPanel(page);
    const rgbLabels = await page.locator('[class*="sliders"] span[class*="label"]').allTextContents();
    expect(rgbLabels).toContain('R');

    await selectColorMode(page, 'Lab Color');
    await openColorPanel(page);

    const sliderLabels = await page.locator('[class*="sliders"] span[class*="label"]').allTextContents();
    expect(sliderLabels).toContain('L');
    expect(sliderLabels).toContain('a');
    expect(sliderLabels).toContain('b');
    expect(sliderLabels).not.toContain('R');
    expect(sliderLabels).not.toContain('G');
  });

  test('CMYK conversion stores ink channels and renders through the ink model', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 160, 160, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 30, 30, 90, 90, { r: 220, g: 70, b: 60 });
    const before = await readCompositedAtDoc(page, 70, 70);

    await selectColorMode(page, 'CMYK Color');
    expect(await getColorMode(page)).toBe('cmyk');

    // The ink round trip is near-identity for in-gamut sRGB, so the picture
    // survives; what changes is that the pixels are now ink amounts.
    const after = await readCompositedAtDoc(page, 70, 70);
    expect(Math.abs(after.r - before.r)).toBeLessThanOrEqual(4);
    expect(Math.abs(after.g - before.g)).toBeLessThanOrEqual(4);
    expect(Math.abs(after.b - before.b)).toBeLessThanOrEqual(4);

    // Red ink is C=0, M=high, Y=high — the texture holds that, not sRGB.
    const raw = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string | null } };
      };
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await read(store.getState().document.activeLayerId ?? undefined);
      const idx = (Math.floor(result.height / 2) * result.width + Math.floor(result.width / 2)) * 4;
      return {
        c: result.pixels[idx] ?? 0,
        m: result.pixels[idx + 1] ?? 0,
        y: result.pixels[idx + 2] ?? 0,
        k: result.pixels[idx + 3] ?? 0,
      };
    });
    expect(raw.c).toBeLessThan(30);
    expect(raw.m).toBeGreaterThan(120);
    expect(raw.y).toBeGreaterThan(120);

    await undo(page);
    expect(await getColorMode(page)).toBe('rgb');
    const restored = await readCompositedAtDoc(page, 70, 70);
    expect(Math.abs(restored.r - before.r)).toBeLessThanOrEqual(2);
  });

  test('CMYK is a flat ink surface — layers are refused, and leaving decodes back', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 120, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await drawRect(page, 20, 20, 70, 70, { r: 60, g: 140, b: 200 });
    const before = await readCompositedAtDoc(page, 50, 50);

    await selectColorMode(page, 'CMYK Color');
    const flattened = (await getEditorState(page)).document.layers.length;
    await addLayer(page);
    expect((await getEditorState(page)).document.layers.length).toBe(flattened);

    await selectColorMode(page, 'RGB Color');
    expect(await getColorMode(page)).toBe('rgb');
    const after = await readCompositedAtDoc(page, 50, 50);
    expect(Math.abs(after.r - before.r)).toBeLessThanOrEqual(4);
    expect(Math.abs(after.g - before.g)).toBeLessThanOrEqual(4);
    expect(Math.abs(after.b - before.b)).toBeLessThanOrEqual(4);
  });

  test('CMYK mode shows C/M/Y/K sliders', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 120, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await selectColorMode(page, 'CMYK Color');
    await openColorPanel(page);

    const labels = await page.locator('[class*="sliders"] span[class*="label"]').allTextContents();
    expect(labels).toEqual(expect.arrayContaining(['C', 'M', 'Y', 'K']));
    expect(labels).not.toContain('R');
  });
});
