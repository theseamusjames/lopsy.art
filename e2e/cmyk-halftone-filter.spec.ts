import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, getPixelAt, applyFilter } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function paintColorStripes(page: Page, width: number, height: number) {
  await page.evaluate(({ w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const img = new ImageData(w, h);
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 200, 0],
    ];
    const stripeWidth = Math.floor(w / colors.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const ci = Math.min(Math.floor(x / stripeWidth), colors.length - 1);
        img.data[idx] = colors[ci][0];
        img.data[idx + 1] = colors[ci][1];
        img.data[idx + 2] = colors[ci][2];
        img.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, img);
  }, { w: width, h: height });
  await page.waitForTimeout(200);
}

async function paintSolidColor(page: Page, width: number, height: number, r: number, g: number, b: number) {
  await page.evaluate(({ w, h, cr, cg, cb }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const img = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = cr;
      img.data[i * 4 + 1] = cg;
      img.data[i * 4 + 2] = cb;
      img.data[i * 4 + 3] = 255;
    }
    state.updateLayerPixelData(id, img);
  }, { w: width, h: height, cr: r, cg: g, cb: b });
  await page.waitForTimeout(200);
}

test.describe('CMYK Color Halftone Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies CMYK halftone filter and produces color-separated dot pattern', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await paintColorStripes(page, 400, 300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    const beforeCenter = await getPixelAt(page, 50, 150, state.activeLayerId);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cmyk-halftone-before.png') });

    await applyFilter(page, 'CMYK Color Halftone...', {
      'Dot Size': 10,
      'Cyan Angle': 15,
      'Magenta Angle': 75,
      'Yellow Angle': 0,
      'Black Angle': 45,
      'Softness': 1,
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'cmyk-halftone-after.png') });

    const afterCenter = await getPixelAt(page, 50, 150, state.activeLayerId);

    // CMYK halftone transforms solid colors into dot patterns with white paper showing through
    const changed = Math.abs(afterCenter.r - beforeCenter.r) > 5 ||
                    Math.abs(afterCenter.g - beforeCenter.g) > 5 ||
                    Math.abs(afterCenter.b - beforeCenter.b) > 5;
    expect(changed).toBe(true);

    // Sample multiple nearby points to confirm dot pattern variation
    const samples = await Promise.all([
      getPixelAt(page, 50, 150, state.activeLayerId),
      getPixelAt(page, 53, 150, state.activeLayerId),
      getPixelAt(page, 56, 150, state.activeLayerId),
      getPixelAt(page, 50, 153, state.activeLayerId),
      getPixelAt(page, 50, 156, state.activeLayerId),
    ]);

    let hasVariation = false;
    for (let i = 1; i < samples.length; i++) {
      const diff = Math.abs(samples[i].r - samples[0].r) +
                   Math.abs(samples[i].g - samples[0].g) +
                   Math.abs(samples[i].b - samples[0].b);
      if (diff > 20) {
        hasVariation = true;
        break;
      }
    }
    expect(hasVariation).toBe(true);
  });

  test('CMYK halftone preserves layer dimensions', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintSolidColor(page, 200, 200, 180, 60, 200);
    await fitToView(page);
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; width: number; height: number }> } };
      };
      const s = store.getState();
      const layer = s.document.layers.find(l => l.id === s.document.activeLayerId);
      return { activeLayerId: s.document.activeLayerId, width: layer?.width, height: layer?.height };
    });

    await applyFilter(page, 'CMYK Color Halftone...', { 'Dot Size': 6 });
    await page.waitForTimeout(400);

    const afterState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; width: number; height: number }> } };
      };
      const s = store.getState();
      const layer = s.document.layers.find(l => l.id === s.document.activeLayerId);
      return { width: layer?.width, height: layer?.height };
    });

    expect(afterState.width).toBe(state.width);
    expect(afterState.height).toBe(state.height);
  });

  test('CMYK halftone filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintSolidColor(page, 200, 200, 100, 150, 200);
    await fitToView(page);
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    const beforePixel = await getPixelAt(page, 100, 100, state.activeLayerId);

    await applyFilter(page, 'CMYK Color Halftone...', { 'Dot Size': 12, 'Softness': 0.5 });
    await page.waitForTimeout(400);

    const afterPixel = await getPixelAt(page, 100, 100, state.activeLayerId);
    const filterApplied = Math.abs(afterPixel.r - beforePixel.r) > 3 ||
                          Math.abs(afterPixel.g - beforePixel.g) > 3 ||
                          Math.abs(afterPixel.b - beforePixel.b) > 3;
    expect(filterApplied).toBe(true);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const undonePixel = await getPixelAt(page, 100, 100, state.activeLayerId);
    expect(Math.abs(undonePixel.r - beforePixel.r)).toBeLessThan(3);
    expect(Math.abs(undonePixel.g - beforePixel.g)).toBeLessThan(3);
    expect(Math.abs(undonePixel.b - beforePixel.b)).toBeLessThan(3);
  });
});
