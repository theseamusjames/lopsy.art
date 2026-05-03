/**
 * E2E tests for Fill Layer type.
 *
 * Tests cover:
 * 1. Solid color fill layer creation — appears in layer panel and renders correctly
 * 2. Gradient fill layer creation — renders a gradient (different colors at ends)
 * 3. Editing a fill layer's color — canvas updates to reflect the new color
 */
import { test, expect } from './fixtures';
import { waitForStore, createDocument, getEditorState, getPixelAt } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fill layer via the store (no UI dialog path for parameterised creation). */
async function addFillLayer(
  page: import('@playwright/test').Page,
  fill: Record<string, unknown>,
) {
  await page.evaluate((fillConfig) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addFillLayer: (f: unknown) => void };
    };
    store.getState().addFillLayer(fillConfig);
  }, fill);
}

/** Update a fill layer's config via the store. */
async function updateFillConfig(
  page: import('@playwright/test').Page,
  layerId: string,
  fill: Record<string, unknown>,
) {
  await page.evaluate(
    ({ id, fillConfig }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateFillConfig: (id: string, f: unknown) => void };
      };
      store.getState().updateFillConfig(id, fillConfig);
    },
    { id: layerId, fillConfig: fill },
  );
}

/** Read a pixel from a specific layer's GPU texture at a doc-space coordinate. */
async function readLayerPixelAt(
  page: import('@playwright/test').Page,
  layerId: string,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return getPixelAt(page, docX, docY, layerId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 200, 200, false);
});

test('solid color fill layer appears in layers panel', async ({ page }) => {
  await addFillLayer(page, {
    type: 'solid-color',
    color: { r: 255, g: 0, b: 0, a: 1 },
  });

  // Wait a frame for the layer panel to update
  await page.waitForTimeout(100);

  const state = await getEditorState(page);
  const fillLayer = state.document.layers.find(
    (l) => (l as Record<string, unknown>).type === 'fill',
  );
  expect(fillLayer).toBeDefined();
  expect(fillLayer!.name).toBe('Solid Color');

  // The layer row should appear in the panel
  const layerRow = page.locator(`[data-layer-id="${fillLayer!.id}"]`);
  await expect(layerRow).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/fill-layer-solid-color-panel.png' });
});

test('solid color fill layer renders the correct color on canvas', async ({ page }) => {
  await addFillLayer(page, {
    type: 'solid-color',
    color: { r: 255, g: 0, b: 0, a: 1 },
  });

  // Wait for the fill layer pixels to be uploaded and rendered
  await page.waitForTimeout(300);

  const state = await getEditorState(page);
  const fillLayer = state.document.layers.find(
    (l) => (l as Record<string, unknown>).type === 'fill',
  );
  expect(fillLayer).toBeDefined();

  await page.screenshot({ path: 'e2e/screenshots/fill-layer-solid-color-canvas.png' });

  // Read a pixel from the fill layer's GPU texture at the center of the document
  const pixel = await readLayerPixelAt(page, fillLayer!.id, 100, 100);

  // Red fill should be visible at the center of the document.
  expect(pixel.r).toBeGreaterThan(200);
  expect(pixel.g).toBeLessThan(50);
  expect(pixel.b).toBeLessThan(50);
  expect(pixel.a).toBeGreaterThan(200);
});

test('gradient fill layer renders different colors at opposite ends', async ({ page }) => {
  await addFillLayer(page, {
    type: 'gradient',
    gradientType: 'linear',
    angle: 90, // left-to-right
    reverse: false,
    stops: [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ],
  });

  await page.waitForTimeout(300);

  const state = await getEditorState(page);
  const fillLayer = state.document.layers.find(
    (l) => (l as Record<string, unknown>).type === 'fill',
  );
  expect(fillLayer).toBeDefined();

  // Left edge should be red-ish (start stop); right edge should be blue-ish (end stop)
  // Document is 200×200, fill layer starts at (0,0)
  const leftPixel = await readLayerPixelAt(page, fillLayer!.id, 5, 100);
  const rightPixel = await readLayerPixelAt(page, fillLayer!.id, 195, 100);

  await page.screenshot({ path: 'e2e/screenshots/fill-layer-gradient-canvas.png' });

  // Left side: more red than blue
  expect(leftPixel.r).toBeGreaterThan(leftPixel.b);
  // Right side: more blue than red
  expect(rightPixel.b).toBeGreaterThan(rightPixel.r);
});

test('editing a solid color fill layer updates the canvas', async ({ page }) => {
  await addFillLayer(page, {
    type: 'solid-color',
    color: { r: 255, g: 0, b: 0, a: 1 }, // red
  });
  await page.waitForTimeout(300);

  const state = await getEditorState(page);
  const fillLayer = state.document.layers.find(
    (l) => (l as Record<string, unknown>).type === 'fill',
  );
  expect(fillLayer).toBeDefined();

  const pixelBefore = await readLayerPixelAt(page, fillLayer!.id, 100, 100);
  await page.screenshot({ path: 'e2e/screenshots/fill-layer-edit-before.png' });

  // Change fill color to green
  await updateFillConfig(page, fillLayer!.id, {
    type: 'solid-color',
    color: { r: 0, g: 255, b: 0, a: 1 },
  });
  await page.waitForTimeout(300);

  const pixelAfter = await readLayerPixelAt(page, fillLayer!.id, 100, 100);
  await page.screenshot({ path: 'e2e/screenshots/fill-layer-edit-after.png' });

  // Before: was reddish
  expect(pixelBefore.r).toBeGreaterThan(pixelBefore.g);

  // After: should be greenish
  expect(pixelAfter.g).toBeGreaterThan(pixelAfter.r);
  expect(pixelAfter.g).toBeGreaterThan(200);
});

test('fill layer is visible via the Layer menu', async ({ page }) => {
  // Open the Layer menu via the menu bar button (aria-haspopup="menu")
  await page.locator('button[aria-haspopup="menu"]:has-text("Layer")').click();

  await expect(page.locator('button:has-text("New Solid Color Fill...")')).toBeVisible();
  await expect(page.locator('button:has-text("New Gradient Fill...")')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/fill-layer-menu.png' });

  // Close the menu
  await page.keyboard.press('Escape');
});

test('solid color fill dialog creates a fill layer', async ({ page }) => {
  // Open the Solid Color fill dialog via the Layer menu
  await page.locator('button[aria-haspopup="menu"]:has-text("Layer")').click();
  await page.locator('button:has-text("New Solid Color Fill...")').click();

  // Dialog should be visible
  await expect(page.locator('[role="dialog"][aria-label="Solid Color Fill"]')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/fill-layer-solid-dialog.png' });

  // Click OK to apply with default color
  await page.locator('[role="dialog"] button:has-text("OK")').click();

  // Wait for layer panel to update
  await page.waitForTimeout(200);

  const state = await getEditorState(page);
  const fillLayer = state.document.layers.find(
    (l) => (l as Record<string, unknown>).type === 'fill',
  );
  expect(fillLayer).toBeDefined();
  expect(fillLayer!.name).toBe('Solid Color');
});
