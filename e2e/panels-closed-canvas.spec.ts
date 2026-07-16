import { test, expect } from './fixtures';
import { createDocument, waitForStore, drawRect } from './helpers';

// Regression test for #669: closing all side panels used to leave the canvas
// blank until the user interacted with the layers panel again. Setting
// canvas.width/height (from the ResizeObserver) wipes the WebGL drawing
// buffer, but the engine's `needs_recomposite` flag stayed false because
// its tracked viewport size already matched. The fix forces a recomposite
// after the buffer wipe.

test.describe('#669 canvas visible after closing all side panels', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'panel toolbar is hidden on touch layouts');
    await page.goto('/');
    await waitForStore(page);
  });

  test('canvas still renders after every side panel is closed', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    // Draw a red rectangle so we have something visible on the canvas.
    await drawRect(page, 50, 50, 200, 150, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(200);

    // Toggle off every side panel via the PanelToolbar buttons — this
    // is what the user does; we don't reach into the store.
    const panels = ['Navigator', 'Info', 'Color', 'Layers', 'Channels', 'History', 'Paths'];
    for (const label of panels) {
      const isActive = await page.evaluate((id) => {
        const store = (window as unknown as Record<string, unknown>).__uiStore as {
          getState: () => { visiblePanels: Set<string> };
        };
        return store.getState().visiblePanels.has(id);
      }, label.toLowerCase());
      if (isActive) {
        const btn = page.locator(`[role="toolbar"][aria-label="Panel visibility"] button[aria-label="${label}"]`);
        await btn.click();
        await page.waitForTimeout(80);
      }
    }
    await page.waitForTimeout(300);

    // Force the render loop to composite + read back through the same rAF
    // path other e2e tests use — this avoids relying on readPixels from the
    // browser after the drawing buffer has been presented.
    const result = await page.evaluate(() => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      return readFn();
    });

    expect(result).not.toBeNull();
    // Count non-transparent pixels. If the fix regresses, the compositor
    // skips its work after the ResizeObserver wipes the drawing buffer and
    // this will be zero.
    let nonZero = 0;
    for (let i = 3; i < result!.pixels.length; i += 4) {
      if ((result!.pixels[i] ?? 0) > 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(1000);
  });
});
