import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, paintRect, getPixelAt, applyFilter } from './helpers';

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

async function paintFourQuadrants(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    state.pushHistory('Paint quadrants');
    const w = state.document.width;
    const h = state.document.height;
    const data = new ImageData(w, h);
    const hw = w / 2;
    const hh = h / 2;
    const quads: Array<[number, number, number, number, [number, number, number]]> = [
      [0, 0, hw, hh, [255, 0, 0]],
      [hw, 0, hw, hh, [0, 255, 0]],
      [0, hh, hw, hh, [0, 0, 255]],
      [hw, hh, hw, hh, [255, 255, 0]],
    ];
    for (const [bx, by, bw, bh, [r, g, b]] of quads) {
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const i = (y * w + x) * 4;
          data.data[i] = r;
          data.data[i + 1] = g;
          data.data[i + 2] = b;
          data.data[i + 3] = 255;
        }
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

test.describe('Twirl Distortion Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('twirl displaces off-center pixels while preserving the center', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await paintFourQuadrants(page);

    await fitToView(page);
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    const beforeOffCenter = await getPixelAt(page, 130, 70, state.activeLayerId);
    expect(beforeOffCenter.g).toBeGreaterThan(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'twirl-before.png') });

    await applyFilter(page, 'Twirl...', {
      'Angle': 360,
      'Radius': 80,
      'Falloff': 200,
    });
    await page.waitForTimeout(400);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'twirl-after.png') });

    const afterOffCenter = await getPixelAt(page, 130, 70, state.activeLayerId);
    const channelShift = Math.abs(afterOffCenter.r - beforeOffCenter.r)
      + Math.abs(afterOffCenter.g - beforeOffCenter.g)
      + Math.abs(afterOffCenter.b - beforeOffCenter.b);
    expect(channelShift, 'off-center pixel should shift colour after twirl').toBeGreaterThan(50);
  });

  test('twirl is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    await paintRect(page, 0, 0, 100, 100, { r: 200, g: 50, b: 50, a: 255 });

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    const beforeCorner = await getPixelAt(page, 5, 5, state.activeLayerId);
    expect(beforeCorner.r).toBe(200);

    await applyFilter(page, 'Twirl...', {
      'Angle': 540,
      'Radius': 100,
      'Falloff': 150,
    });
    await page.waitForTimeout(300);

    const afterCorner = await getPixelAt(page, 5, 5, state.activeLayerId);
    expect(afterCorner.a).toBeLessThan(200);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const restoredCorner = await getPixelAt(page, 5, 5, state.activeLayerId);
    expect(restoredCorner.r).toBe(200);
    expect(restoredCorner.a).toBe(255);
  });
});
