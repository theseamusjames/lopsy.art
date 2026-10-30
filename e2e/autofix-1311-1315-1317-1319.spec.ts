/**
 * #1311 — at fit zoom on a large document, the drawn corner square scales
 *         instead of being swallowed by the rotate handle's hit circle.
 * #1315 — redo of Rasterize Layer Style restores the baked pixels.
 * #1317 — changing a layer's opacity with the keyboard records history.
 * #1319 — redo of Strikethrough on a Google-font text layer redraws the line.
 *
 * Permanent Marker is served offline from engine-rs/crates/lopsy-wasm/tests/fixtures.
 */
import { test, expect, type Page } from './fixtures';
import { serveFontsOffline } from './font-fixtures';
import {
  addLayer,
  configureEffect,
  createDocument,
  docToScreen,
  drawRect,
  getEditorState,
  getPixelAt,
  openEffectsPanel,
  selectTool,
  setActiveLayer,
  setEffectColor,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function layerOpacity(page: Page, layerId: string): Promise<number> {
  const state = await getEditorState(page);
  return state.document.layers.find((l) => l.id === layerId)!.opacity;
}

test.describe('#1317 keyboard opacity change records history', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('arrow keys on the opacity slider are undoable on their own', async ({ page }) => {
    const layerId = await addLayer(page);
    await drawRect(page, 0, 0, 400, 300, { r: 255, g: 0, b: 0 });
    expect((await getPixelAt(page, 200, 150, layerId)).r).toBe(255);

    const row = page.locator(`[data-layer-id="${layerId}"]`);
    await row.locator('button[aria-label*="Opacity"]').click();
    const slider = page.locator('input[type="range"][aria-label$=" opacity"]');
    await slider.waitFor({ state: 'visible' });
    await slider.focus();
    const before = await historyLabels(page);
    for (let i = 0; i < 10; i++) await slider.press('ArrowLeft');
    expect(await layerOpacity(page, layerId)).toBeCloseTo(0.9, 5);

    const after = await historyLabels(page);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)).toBe('Change Opacity');

    await row.locator('button[aria-label*="Opacity"]').click();
    await page.locator('[data-testid="canvas-container"]').focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Only the last arrow step is undone; the red fill stays.
    expect(await layerOpacity(page, layerId)).toBeCloseTo(0.91, 5);
    expect((await getPixelAt(page, 200, 150, layerId)).r).toBe(255);
  });
});

test.describe('#1315 redo of Rasterize Layer Style', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('redo restores the baked overlay, not the pre-bake pixels', async ({ page }) => {
    const layerId = await addLayer(page);
    await drawRect(page, 0, 0, 400, 300, { r: 0, g: 0, b: 0 });
    await setActiveLayer(page, layerId);
    await configureEffect(page, 'Color Overlay', {});
    await setEffectColor(page, 'Overlay color', 238, 98, 48);
    await openEffectsPanel(page);
    await page.getByRole('button', { name: 'Rasterize Layer Style' }).click();
    await page.waitForTimeout(300);

    const baked = await getPixelAt(page, 200, 150, layerId);
    expect(baked).toMatchObject({ r: 238, g: 98, b: 48, a: 255 });

    await page.locator('[data-testid="canvas-container"]').focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await getPixelAt(page, 200, 150, layerId)).toMatchObject({ r: 0, g: 0, b: 0 });

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/rasterize-style-redo-1315.png' });
    const state = await getEditorState(page);
    const layer = state.document.layers.find((l) => l.id === layerId)!;
    expect(layer.effects.colorOverlay.enabled).toBe(false);
    // Before the fix redo restored the pre-bake black pixels.
    expect(await getPixelAt(page, 200, 150, layerId)).toMatchObject({ r: 238, g: 98, b: 48, a: 255 });
  });
});

interface Raster {
  width: number;
  height: number;
  opaque: number;
  hash: number;
}

async function layerRaster(page: Page, layerId: string): Promise<Raster> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await read(id);
    let opaque = 0;
    let hash = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const a = pixels[i] ?? 0;
      if (a > 127) opaque++;
      hash = (Math.imul(hash, 31) + a) | 0;
    }
    return { width, height, opaque, hash };
  }, layerId);
}

/** Dark pixels in the composited canvas: the glyphs plus any decoration line. */
async function compositeDarkCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const { pixels } = await read();
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if ((pixels[i] ?? 255) < 60) dark++;
    return dark;
  });
}

async function selectFont(page: Page, family: string): Promise<void> {
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.locator('input[aria-label="Search fonts"]').fill(family);
  const item = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${family}$`) }).first();
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
  await page.waitForTimeout(200);
}

test.describe('#1319 redo of a decoration toggle on a Google-font layer', () => {
  test.use({ allowConsoleErrors: [/Failed to load resource/] });

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options require the desktop layout');
    await serveFontsOffline(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1000, 400, false);
  });

  for (const decoration of ['strikethrough', 'underline'] as const) {
    test(`redo of ${decoration} redraws the line`, async ({ page }) => {
      await setForegroundColor(page, 0, 0, 0);
      await selectTool(page, 'text');
      await selectFont(page, 'Permanent Marker');
      await page.waitForFunction(
        (f) => {
          const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as ((f: string) => boolean) | undefined;
          return fn ? fn(f) : false;
        },
        'Permanent Marker',
        { timeout: 20000 },
      );
      await setToolOption(page, 'Size', 160);
      const before = new Set((await getEditorState(page)).document.layers.map((l) => l.id));
      const at = await docToScreen(page, 80, 100);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(150);
      await page.keyboard.type('HELLO');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(500);
      const layer = (await getEditorState(page)).document.layers.find((l) => !before.has(l.id));
      expect(layer?.type).toBe('text');
      const layerId = layer!.id;
      expect(layer!.fontFamily).toContain('Permanent Marker');

      const plain = await layerRaster(page, layerId);
      const toggle = page.locator(`[aria-label="Toggle ${decoration}"]`).first();
      await toggle.click();
      await page.waitForTimeout(500);
      const decorated = await layerRaster(page, layerId);
      expect(decorated.opaque).toBeGreaterThan(plain.opaque + 200);
      const decoratedDark = await compositeDarkCount(page);

      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      expect((await layerRaster(page, layerId)).opaque).toBe(plain.opaque);

      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(500);
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      // Before the fix the redone texture was the undecorated one.
      expect(await layerRaster(page, layerId)).toEqual(decorated);
      expect(await compositeDarkCount(page)).toBe(decoratedDark);
      await page.screenshot({ path: `e2e/screenshots/text-${decoration}-redo-1319.png` });
    });
  }
});

test.describe('#1311 corner scale handle at low zoom', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs a mouse');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 2400, 3200, false);
  });

  test('pressing the white corner square scales the selection', async ({ page }) => {
    const zoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });
    expect(zoom).toBeLessThan(0.4);

    await selectTool(page, 'marquee-rect');
    const from = await docToScreen(page, 600, 1200);
    const to = await docToScreen(page, 1400, 2000);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    const bounds = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: { x: number; y: number; width: number; height: number } } };
      };
      return store.getState().selection.bounds;
    });
    const corner = await docToScreen(page, bounds.x + bounds.width, bounds.y + bounds.height);
    await page.mouse.move(corner.x, corner.y);
    await page.waitForTimeout(100);
    const handle = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { activeTransformHandle: string | null };
      };
      return ui.getState().activeTransformHandle;
    });
    expect(handle).toBe('bottom-right');

    await page.mouse.down();
    await page.mouse.move(corner.x + 60, corner.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/corner-scale-low-zoom-1311.png' });

    const transform = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: { scaleX: number; scaleY: number; rotation: number } | null };
      };
      return ui.getState().transform;
    });
    // 60 screen px at ~26% is ~230 doc px on an 800 px box: about 1.29x.
    // Before the fix the press grabbed the rotate handle and the box kept
    // its scale (or turned).
    expect(transform).not.toBeNull();
    expect(transform!.rotation).toBeCloseTo(0, 3);
    expect(transform!.scaleX).toBeGreaterThan(1.15);
    expect(transform!.scaleY).toBeGreaterThan(1.15);
  });
});
