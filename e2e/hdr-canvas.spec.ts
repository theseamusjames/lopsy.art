import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { gpuArgs, isWgpu } from './gpu-args';

// On a display with high dynamic range the WebGPU canvas is HDR: 16-bit
// float with extended tone mapping, so what the document's adjustments push
// above white shows brighter than white. The WebGL canvas is 8-bit and
// never is.
//
// Headless Chromium has no HDR display. Forcing its colour profile makes
// `(dynamic-range: high)` match, which is all the app goes by. What a
// browser can read back from a canvas is clipped at white, so this checks
// that the canvas is set up for HDR and still shows the document; that an
// adjustment keeps what goes over white is tested in the engine
// (`adjustments_keep_what_goes_over_white_only_when_asked`).
test.use({ launchOptions: { args: [...gpuArgs, '--force-color-profile=hdr10'] } });

interface CanvasSetup {
  format: string;
  colorSpace: string;
  toneMapping: string;
}

test.describe('HDR canvas', () => {
  test.beforeEach(({ browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'the HDR colour profile is forced with a Chromium flag');
    test.skip(isMobile, 'reads the desktop status bar');
  });

  test('WebGPU drives an HDR canvas on an HDR display; WebGL does not', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200, false);
    expect(await page.evaluate(() => matchMedia('(dynamic-range: high)').matches)).toBe(true);

    const statusBar = page.locator('[aria-label="Status bar"]');
    const setup = await page.evaluate((): CanvasSetup | null => {
      interface GpuCanvasContext {
        getConfiguration(): { format: string; colorSpace: string; toneMapping?: { mode?: string } } | null;
      }
      for (const canvas of document.querySelectorAll('canvas')) {
        let context: GpuCanvasContext | null = null;
        try {
          context = canvas.getContext('webgpu') as unknown as GpuCanvasContext | null;
        } catch {
          context = null;
        }
        const config = context?.getConfiguration();
        if (config) {
          return { format: config.format, colorSpace: config.colorSpace, toneMapping: config.toneMapping?.mode ?? 'standard' };
        }
      }
      return null;
    });

    if (isWgpu) {
      await expect(statusBar).toContainText('WebGPU');
      await expect(statusBar).toContainText('HDR');
      expect(setup?.format).toBe('rgba16float');
      expect(setup?.toneMapping).toBe('extended');
    } else {
      await expect(statusBar).toContainText('WebGL');
      await expect(statusBar).not.toContainText('HDR');
      expect(setup).toBeNull();
    }

    // The document still shows: its white background is white on screen.
    const centre = await page.evaluate(async () => {
      const read = (window as unknown as {
        __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      }).__readCompositedPixels;
      const shot = await read();
      if (!shot) return null;
      const at = ((shot.height >> 1) * shot.width + (shot.width >> 1)) * 4;
      return shot.pixels.slice(at, at + 4);
    });
    expect(centre).not.toBeNull();
    for (const channel of centre ?? []) expect(channel).toBeGreaterThanOrEqual(250);
    await page.screenshot({ path: 'e2e/screenshots/hdr-canvas.png' });
  });
});
