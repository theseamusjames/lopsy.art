import { test, expect } from './fixtures';
import { waitForStore, createDocument, docToScreen, getPixelAt, setForegroundColor } from './helpers';

test.describe('Feathered selection fill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('filling a feathered marquee selection produces soft edges beyond the selection rect', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { fitToView: () => void };
      };
      store.getState().fitToView();
    });
    await page.waitForTimeout(300);

    // Select marquee rect tool and set feather to 10
    await page.keyboard.press('m');
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setMarqueeFeather: (v: number) => void };
      };
      store.getState().setMarqueeFeather(10);
    });

    // Draw a 40x40 selection at (30,30)–(70,70)
    const start = await docToScreen(page, 30, 30);
    const end = await docToScreen(page, 70, 70);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Set foreground to black
    await setForegroundColor(page, 0, 0, 0);

    // Switch to fill tool and click inside the selection
    await page.keyboard.press('g');
    await page.waitForTimeout(100);
    const center = await docToScreen(page, 50, 50);
    await page.mouse.click(center.x, center.y);
    await page.waitForTimeout(500);

    // Count non-transparent pixels
    const result = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      const id = store.getState().document.activeLayerId;
      const data = await readFn(id);
      if (!data) return { nonZeroPixels: 0 };

      let nonZeroPixels = 0;
      for (let i = 0; i < data.pixels.length; i += 4) {
        const a = data.pixels[i + 3] ?? 0;
        if (a > 0) nonZeroPixels++;
      }
      return { nonZeroPixels };
    });

    // A 40x40 hard selection = exactly 1600 non-zero pixels.
    // With feather=10, the Gaussian blur extends the mask beyond the rect,
    // so more pixels should receive partial fill.
    expect(result.nonZeroPixels).toBeGreaterThan(1600);

    // Edge pixel at the selection boundary should have partial alpha
    const edgePixel = await getPixelAt(page, 30, 50);
    expect(edgePixel.a).toBeGreaterThan(0);
    expect(edgePixel.a).toBeLessThan(255);
  });
});
