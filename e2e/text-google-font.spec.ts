import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width = 400, height = 300) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
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

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function countOpaquePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i] ?? 0) > 10) count++;
    }
    return count;
  }, layerId);
}

async function getTextLayers(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; name: string; visible: boolean }> } };
    };
    return store.getState().document.layers.filter((l) => l.type === 'text' && l.name.startsWith('Text'));
  });
}

async function selectFont(page: Page, fontFamily: string) {
  // Click the FontPicker trigger
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.waitForTimeout(150);

  // Type in the search box
  const searchInput = page.locator('input[aria-label="Search fonts"]');
  await searchInput.fill(fontFamily);
  await page.waitForTimeout(300);

  // Every row renders the family name as text (in the font's own face where
  // it's available, or the category fallback while it's loading).
  const fontItem = page.locator('[role="option"]')
    .filter({ hasText: new RegExp(`^${fontFamily}`) })
    .first();
  await fontItem.waitFor({ state: 'visible', timeout: 5000 });
  await fontItem.click();
  await page.waitForTimeout(200);
}

async function waitForFontInEngine(page: Page, fontFamily: string, timeoutMs = 15000) {
  await page.waitForFunction(
    (family) => {
      const fn = (window as unknown as Record<string, unknown>).__isFontLoaded as
        ((f: string) => boolean) | undefined;
      return fn ? fn(family) : false;
    },
    fontFamily,
    { timeout: timeoutMs },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Google Font rendering', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 400, 300);
    await page.keyboard.press('t');
  });

  test('different fonts produce different glyphs for the same text', async ({ page }) => {
    // Step 1: Type "LOPSY" with the default font (Inter) and commit
    await clickAtDoc(page, 200, 150);
    await page.keyboard.type('LOPSY');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    const layersAfterInter = await getTextLayers(page);
    expect(layersAfterInter.length).toBe(1);
    const interLayerId = layersAfterInter[0]!.id;

    // Step 2: Hide the Inter layer so clicking won't re-open it for editing
    await page.locator(`[data-layer-id="${interLayerId}"]`)
      .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
      .click();
    await page.waitForTimeout(100);

    // Add a fresh layer so the Inter text layer is no longer the active layer —
    // otherwise changing the font would (correctly) apply to that committed
    // text layer, which this test does not want.
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(100);

    // Step 3: Change the active font to Pacifico using the FontPicker UI.
    // Pacifico is a single-weight handwriting/script font (very different from
    // Inter's geometric sans-serif glyphs) with a stable TTF on jsDelivr.
    await selectFont(page, 'Pacifico');

    // Step 4: Wait for the Pacifico TTF to arrive in the WASM engine's fontdb
    await waitForFontInEngine(page, 'Pacifico');

    // Step 5: Create a second text layer with Pacifico and type the same text
    await clickAtDoc(page, 200, 150);
    await page.keyboard.type('LOPSY');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    const layersAfterPacifico = await getTextLayers(page);
    // Two text layers: the hidden Inter one and the new Pacifico one
    expect(layersAfterPacifico.length).toBe(2);

    const pacificoLayer = layersAfterPacifico.find((l) => l.id !== interLayerId);
    expect(pacificoLayer).toBeDefined();
    const pacificoLayerId = pacificoLayer!.id;

    // Step 6: Read opaque pixel counts from both layers
    const interCount = await countOpaquePixels(page, interLayerId);
    const pacificoCount = await countOpaquePixels(page, pacificoLayerId);

    // Step 7: Take screenshots with both layers visible for the committed baseline
    await page.locator(`[data-layer-id="${interLayerId}"]`)
      .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
      .click();
    await page.waitForTimeout(100);

    await page.screenshot({ path: 'e2e/screenshots/text-google-font-inter-vs-pacifico.png' });

    // Both layers must have rendered content
    expect(interCount).toBeGreaterThan(50);
    expect(pacificoCount).toBeGreaterThan(50);

    // The pixel counts must differ — Inter and Pacifico have visually distinct
    // glyph shapes (geometric sans vs. script/cursive). Identical counts would
    // mean Pacifico silently fell back to Inter (the regression this test catches).
    expect(interCount).not.toBe(pacificoCount);

    // Sanity bounds: neither should be more than 5× the other.
    // (A 5× ratio would indicate stale GPU content, not font rendering.)
    const ratio = Math.max(interCount, pacificoCount) / Math.min(interCount, pacificoCount);
    expect(ratio).toBeLessThan(5);
  });

  test('changing a committed layer font re-renders once the web font downloads', async ({ page }) => {
    // Commit "LOPSY" in the default Inter font; the layer stays selected.
    await clickAtDoc(page, 200, 150);
    await page.keyboard.type('LOPSY');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    const layers = await getTextLayers(page);
    expect(layers.length).toBe(1);
    const layerId = layers[0]!.id;
    const interCount = await countOpaquePixels(page, layerId);
    expect(interCount).toBeGreaterThan(50);

    // Change the committed layer's font to a fresh Google font (not editing).
    await selectFont(page, 'Pacifico');
    await waitForFontInEngine(page, 'Pacifico');

    // The reported bug: the committed layer stuck on the Inter fallback until the
    // size was nudged. The async font-load refresh must re-render the SAME layer
    // to Pacifico on its own — poll until its glyph pixels change.
    await page.waitForFunction(
      async ({ id, baseline }: { id: string; baseline: number }) => {
        const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
          (layerId?: string) => Promise<{ width: number; pixels: number[] } | null>;
        const result = await readFn(id);
        if (!result || result.width === 0) return false;
        let count = 0;
        for (let i = 3; i < result.pixels.length; i += 4) {
          if ((result.pixels[i] ?? 0) > 10) count++;
        }
        return count !== baseline;
      },
      { id: layerId, baseline: interCount },
      { timeout: 15000 },
    );

    const pacificoCount = await countOpaquePixels(page, layerId);
    expect(pacificoCount).toBeGreaterThan(50);
    // Same layer, no size change — the glyphs are now Pacifico, not Inter.
    expect(pacificoCount).not.toBe(interCount);
  });
});
