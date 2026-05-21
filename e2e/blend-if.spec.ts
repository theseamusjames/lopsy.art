import { test, expect } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  getEditorState,
  addLayer,
  openEffectsPanel,
  closeEffectsPanel,
} from './helpers';

async function readCompositedPixelAt(
  page: import('@playwright/test').Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ docX, docY }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn();
      if (!result) return { r: 0, g: 0, b: 0, a: 0 };

      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      if (!container) return { r: 0, g: 0, b: 0, a: 0 };

      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
      const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;

      const px = Math.round(screenX);
      const py = result.height - 1 - Math.round(screenY);

      if (px < 0 || px >= result.width || py < 0 || py >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      const idx = (py * result.width + px) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { docX, docY },
  );
}

async function enableBlendIf(page: import('@playwright/test').Page) {
  await openEffectsPanel(page);
  const checkbox = page.locator('[aria-label="Enable Blend If"]');
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.waitFor({ state: 'visible', timeout: 3000 });
  if (!(await checkbox.isChecked())) {
    await checkbox.click();
  }
  const row = page.locator('[role="option"]').filter({ hasText: 'Blend If' });
  await row.click();
  await page.waitForTimeout(100);
}

async function paintFullLayer(
  page: import('@playwright/test').Page,
  layerId: string,
  width: number,
  height: number,
  fillFn: string,
) {
  await page.evaluate(({ layerId, width, height, fillFn }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; width: number; height: number }> };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
      setState: (partial: Record<string, unknown>) => void;
    };
    const s = store.getState();
    s.pushHistory('Paint layer');
    const data = new ImageData(width, height);
    const fill = new Function('data', 'x', 'y', 'idx', fillFn);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        fill(data.data, x, y, idx);
      }
    }
    const layers = s.document.layers.map((l: { id: string; width: number; height: number }) => {
      if (l.id === layerId) return { ...l, width, height };
      return l;
    });
    store.setState({ document: { ...s.document, layers } } as Record<string, unknown>);
    s.updateLayerPixelData(layerId, data);
  }, { layerId, width, height, fillFn });
}

test.describe('Blend If', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
  });

  test('hides dark pixels on This Layer when Blend If black is raised', async ({ page }) => {
    const state = await getEditorState(page);
    const bgLayerId = state.document.layers[0].id;

    // Paint the background layer solid white
    await paintFullLayer(page, bgLayerId, 200, 200,
      'data[idx]=255; data[idx+1]=255; data[idx+2]=255; data[idx+3]=255;');

    // Add a top layer: dark left half (30), bright right half (220)
    const topLayerId = await addLayer(page);
    await paintFullLayer(page, topLayerId, 200, 200,
      'if(x<100){data[idx]=30;data[idx+1]=30;data[idx+2]=30;}else{data[idx]=220;data[idx+1]=220;data[idx+2]=220;} data[idx+3]=255;');

    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/blend-if-before.png' });

    // Verify dark region is dark before Blend If
    const beforeDark = await readCompositedPixelAt(page, 50, 100);
    expect(beforeDark.r).toBeLessThan(60);

    // Enable Blend If and set Black=80, Black Feather=80 to hide dark pixels
    await enableBlendIf(page);

    // Set Black Feather first (constraint: black ≤ blackFeather), then Black
    const drawer = page.getByTestId('effects-drawer');
    const blackFeatherInput = drawer.locator('[aria-label="Black Feather value"]').first();
    await blackFeatherInput.waitFor({ state: 'visible', timeout: 3000 });
    await blackFeatherInput.fill('80');
    await blackFeatherInput.press('Enter');

    const blackInput = drawer.locator('[aria-label="Black value"]').first();
    await blackInput.waitFor({ state: 'visible', timeout: 3000 });
    await blackInput.fill('80');
    await blackInput.press('Enter');

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/blend-if-after.png' });

    // Dark region (lum ~30) is below Black=80, so it should be fully hidden,
    // revealing the white background underneath.
    const afterDark = await readCompositedPixelAt(page, 25, 100);
    expect(afterDark.r).toBeGreaterThan(200);
    expect(afterDark.g).toBeGreaterThan(200);
    expect(afterDark.b).toBeGreaterThan(200);

    // Bright region should still be visible
    const afterBright = await readCompositedPixelAt(page, 150, 100);
    expect(afterBright.r).toBeLessThan(240);
    expect(afterBright.r).toBeGreaterThan(190);

    await closeEffectsPanel(page);
  });

  test('hides layer over bright underlying pixels with Underlying White control', async ({ page }) => {
    const state = await getEditorState(page);
    const bgLayerId = state.document.layers[0].id;

    // Paint background: left half bright (240), right half dark (40)
    await paintFullLayer(page, bgLayerId, 200, 200,
      'if(x<100){data[idx]=240;data[idx+1]=240;data[idx+2]=240;}else{data[idx]=40;data[idx+1]=40;data[idx+2]=40;} data[idx+3]=255;');

    // Add a solid red overlay layer
    const topLayerId = await addLayer(page);
    await paintFullLayer(page, topLayerId, 200, 200,
      'data[idx]=255; data[idx+1]=0; data[idx+2]=0; data[idx+3]=255;');

    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/blend-if-underlying-before.png' });

    // Both halves should show red
    const beforeLeft = await readCompositedPixelAt(page, 50, 100);
    expect(beforeLeft.r).toBeGreaterThan(200);
    expect(beforeLeft.g).toBeLessThan(30);

    // Enable Blend If and set Underlying White=100, White Feather=100
    await enableBlendIf(page);

    const drawer = page.getByTestId('effects-drawer');

    const underlyingWhiteFeather = drawer.locator('[aria-label="White Feather value"]').last();
    await underlyingWhiteFeather.waitFor({ state: 'visible', timeout: 3000 });
    await underlyingWhiteFeather.fill('100');
    await underlyingWhiteFeather.press('Enter');

    const underlyingWhite = drawer.locator('[aria-label="White value"]').last();
    await underlyingWhite.waitFor({ state: 'visible', timeout: 3000 });
    await underlyingWhite.fill('100');
    await underlyingWhite.press('Enter');

    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/blend-if-underlying-after.png' });

    // Left half (bright underlying at 240) should now show background, not red
    const afterLeft = await readCompositedPixelAt(page, 50, 100);
    expect(afterLeft.g).toBeGreaterThan(150);

    // Right half (dark underlying at 40) should still show red
    const afterRight = await readCompositedPixelAt(page, 150, 100);
    expect(afterRight.r).toBeGreaterThan(200);
    expect(afterRight.g).toBeLessThan(30);

    await closeEffectsPanel(page);
  });
});
