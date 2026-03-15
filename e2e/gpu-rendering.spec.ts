import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect, undo, redo } from './helpers';

/** Wait for CanvasKit to finish loading before creating documents. */
async function waitForRenderer(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__rendererStatus,
    { timeout: 15000 },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await waitForRenderer(page);
});

/**
 * Read pixel colors from a Playwright screenshot buffer (PNG).
 * Decodes the PNG via a temporary page canvas and samples pixel locations.
 */
async function getCanvasPixels(page: import('@playwright/test').Page) {
  const container = page.locator('[data-testid="canvas-container"]');
  const screenshot = await container.screenshot();

  // Decode the screenshot PNG in the browser to get pixel data
  return page.evaluate(async (pngBase64: string) => {
    const blob = await fetch(`data:image/png;base64,${pngBase64}`).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width;
    const h = bitmap.height;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);

    const samplePoints = [
      [Math.floor(w / 2), Math.floor(h / 2)],
      [Math.floor(w / 4), Math.floor(h / 4)],
      [Math.floor(3 * w / 4), Math.floor(3 * h / 4)],
      [10, 10],
      [w - 10, h - 10],
    ];
    const samples: { r: number; g: number; b: number; a: number }[] = [];
    for (const [sx, sy] of samplePoints) {
      const idx = (sy! * w + sx!) * 4;
      samples.push({
        r: data.data[idx]!,
        g: data.data[idx + 1]!,
        b: data.data[idx + 2]!,
        a: data.data[idx + 3]!,
      });
    }
    return { width: w, height: h, pixels: samples };
  }, screenshot.toString('base64'));
}

test.describe('GPU Rendering', () => {
  test('gpu pipeline diagnostics', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

    await createDocument(page, 400, 300);
    await page.waitForTimeout(3000);

    const ckLoaded = await page.evaluate(() => {
      const reg = (window as unknown as Record<string, unknown>);
      return {
        hasEditorStore: !!reg.__editorStore,
        rendererStatus: reg.__rendererStatus,
      };
    });
    console.log('Stores:', ckLoaded);

    const canvasInfo = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return 'no container';
      const canvases = container.querySelectorAll('canvas');
      const results: string[] = [];
      canvases.forEach((c, i) => {
        results.push(`canvas[${i}]: ${c.width}x${c.height}`);
      });
      return results.join(', ');
    });
    console.log('Canvas info:', canvasInfo);

    const lopsyLogs = logs.filter(l => l.includes('Lopsy') || l.includes('CanvasKit') || l.includes('GPU') || l.includes('WebGL'));
    console.log('GPU-related logs:', lopsyLogs.length > 0 ? lopsyLogs.join('\n  ') : '(none)');
  });

  test('canvas renders visible content after document creation', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForTimeout(2000);

    const rendererStatus = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__rendererStatus,
    );
    console.log('Renderer:', rendererStatus);

    const result = await getCanvasPixels(page);
    console.log(`Screenshot: ${result.width}x${result.height}`);
    console.log('Sampled pixels (center, TL quarter, BR quarter, near TL, near BR):');
    for (const p of result.pixels) {
      console.log(`  rgba(${p.r}, ${p.g}, ${p.b}, ${p.a})`);
    }

    // The canvas should NOT be uniform — it should have document content
    // (checkerboard, white background, dark gray border area)
    const center = result.pixels[0]!;
    const allSame = result.pixels.every(
      (p) => p.r === center.r && p.g === center.g && p.b === center.b,
    );

    if (allSame) {
      console.log('FAIL: Canvas is uniform color — compositor is not rendering varied content');
    }

    // The center pixel should be in the document area — either white (background layer)
    // or checkerboard pattern, not the dark gray app background (#3c3c3c = rgb(60,60,60))
    expect(center.r).toBeGreaterThan(60);
  });

  test('screenshot shows rendered document', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForTimeout(2000);

    const container = page.locator('[data-testid="canvas-container"]');
    const screenshot = await container.screenshot();
    expect(screenshot.length).toBeGreaterThan(0);
  });

  test('undo reverts rendered canvas content', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForTimeout(1000);

    // Take a screenshot before painting
    const before = await getCanvasPixels(page);
    const centerBefore = before.pixels[0]!;

    // Paint a big red rectangle — use green=0 so we can distinguish from white bg
    await paintRect(page, 50, 50, 300, 200, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(500);

    // Verify red paint is visible (green channel distinguishes red from white)
    const afterPaint = await getCanvasPixels(page);
    const centerAfterPaint = afterPaint.pixels[0]!;
    expect(centerAfterPaint.g).toBeLessThan(80);

    // Undo
    await undo(page);
    await page.waitForTimeout(500);

    // Canvas should revert to pre-paint state (white background, G=255)
    const afterUndo = await getCanvasPixels(page);
    const centerAfterUndo = afterUndo.pixels[0]!;
    expect(centerAfterUndo.g).toBeGreaterThan(200);
    expect(Math.abs(centerAfterUndo.r - centerBefore.r)).toBeLessThan(20);
    expect(Math.abs(centerAfterUndo.g - centerBefore.g)).toBeLessThan(20);
    expect(Math.abs(centerAfterUndo.b - centerBefore.b)).toBeLessThan(20);
  });

  test('redo restores rendered canvas content', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForTimeout(1000);

    // Paint red — use green channel to distinguish from white background
    await paintRect(page, 50, 50, 300, 200, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(500);

    const afterPaint = await getCanvasPixels(page);
    expect(afterPaint.pixels[0]!.g).toBeLessThan(80);

    await undo(page);
    await page.waitForTimeout(500);

    // After undo, white background (G=255)
    const afterUndo = await getCanvasPixels(page);
    expect(afterUndo.pixels[0]!.g).toBeGreaterThan(200);

    await redo(page);
    await page.waitForTimeout(500);

    // After redo, red again (G low)
    const afterRedo = await getCanvasPixels(page);
    expect(afterRedo.pixels[0]!.g).toBeLessThan(80);
  });

  test('pixel changes render within one frame', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForTimeout(1000);

    // Measure time from paint to visible change on canvas
    const timingMs = await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);

      // Fill with red
      for (let y = 50; y < 250; y++) {
        for (let x = 50; x < 350; x++) {
          const idx = (y * data.width + x) * 4;
          data.data[idx] = 255;
          data.data[idx + 1] = 0;
          data.data[idx + 2] = 0;
          data.data[idx + 3] = 255;
        }
      }

      const start = performance.now();
      state.updateLayerPixelData(id, data);

      // Wait for the next frame to complete
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      return performance.now() - start;
    });

    console.log(`Paint-to-render latency: ${timingMs.toFixed(1)}ms`);
    // Should complete within 2 frames at 60fps (33ms). Allow some headroom for CI.
    expect(timingMs).toBeLessThan(100);
  });

  test('pencil drag produces continuous line in pixel data', async ({ page }) => {
    await createDocument(page, 400, 300);
    await page.waitForTimeout(1000);

    // Select pencil tool
    await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (tool: string) => void };
      };
      uiStore.getState().setActiveTool('pencil');
    });

    // Get the canvas container position
    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    expect(box).toBeTruthy();

    // Draw a horizontal line across the middle of the canvas
    const startX = box!.x + 50;
    const endX = box!.x + box!.width - 50;
    const y = box!.y + box!.height / 2;
    const steps = 50;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      const x = startX + (endX - startX) * (i / steps);
      await page.mouse.move(x, y, { steps: 1 });
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Check pixel data for continuity — scan the row where we drew
    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          layerPixelData: Map<string, ImageData>;
        };
      };
      const state = store.getState();
      const data = state.layerPixelData.get(state.document.activeLayerId);
      if (!data) return { error: 'no pixel data', totalFilled: 0, gaps: 0, maxGap: 0, scanRow: -1 };

      // Find the row with the most filled pixels (the drawn line)
      let bestRow = 0;
      let bestCount = 0;
      for (let row = 0; row < data.height; row++) {
        let count = 0;
        for (let x = 0; x < data.width; x++) {
          const idx = (row * data.width + x) * 4;
          if ((data.data[idx + 3] ?? 0) > 0) count++;
        }
        if (count > bestCount) { bestCount = count; bestRow = row; }
      }

      // Scan the best row for gaps
      let inLine = false;
      let firstX = -1;
      let lastX = -1;
      let gaps = 0;
      let maxGap = 0;
      let currentGap = 0;
      for (let x = 0; x < data.width; x++) {
        const idx = (bestRow * data.width + x) * 4;
        const filled = (data.data[idx + 3] ?? 0) > 0;
        if (filled) {
          if (firstX === -1) firstX = x;
          lastX = x;
          if (inLine && currentGap > 0) {
            gaps++;
            maxGap = Math.max(maxGap, currentGap);
          }
          currentGap = 0;
          inLine = true;
        } else if (inLine) {
          currentGap++;
        }
      }

      return {
        scanRow: bestRow,
        totalFilled: bestCount,
        lineSpan: lastX - firstX + 1,
        gaps,
        maxGap,
        firstX,
        lastX,
      };
    });

    console.log('Pencil data continuity:', result);
    // A continuous line should have NO gaps in the pixel data
    expect(result.totalFilled).toBeGreaterThan(50);
    expect(result.gaps).toBe(0);

    // Also check the RENDERED output via Playwright screenshot
    // (in-page drawImage on WebGL canvas fails due to preserveDrawingBuffer:false)
    const canvasContainer = page.locator('[data-testid="canvas-container"]');
    const screenshot = await canvasContainer.screenshot();
    const renderResult = await page.evaluate(async (pngBase64: string) => {
      const blob = await fetch(`data:image/png;base64,${pngBase64}`).then(r => r.blob());
      const bitmap = await createImageBitmap(blob);
      const tmp = document.createElement('canvas');
      tmp.width = bitmap.width;
      tmp.height = bitmap.height;
      const ctx = tmp.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);

      // Find the row with the most dark pixels (the pencil line on white bg)
      let bestRow = 0;
      let bestCount = 0;
      for (let row = 0; row < imgData.height; row++) {
        let count = 0;
        for (let x = 0; x < imgData.width; x++) {
          const idx = (row * imgData.width + x) * 4;
          if (imgData.data[idx]! < 100 && imgData.data[idx + 3]! > 200) count++;
        }
        if (count > bestCount) { bestCount = count; bestRow = row; }
      }

      // Scan that row for gaps
      let inLine = false;
      let gaps = 0;
      let maxGap = 0;
      let currentGap = 0;
      let linePixels = 0;
      for (let x = 0; x < imgData.width; x++) {
        const idx = (bestRow * imgData.width + x) * 4;
        const dark = imgData.data[idx]! < 100 && imgData.data[idx + 3]! > 200;
        if (dark) {
          linePixels++;
          if (inLine && currentGap > 2) {
            gaps++;
            maxGap = Math.max(maxGap, currentGap);
          }
          currentGap = 0;
          inLine = true;
        } else if (inLine) {
          currentGap++;
        }
      }

      return { bestRow, linePixels, gaps, maxGap, canvasW: imgData.width, canvasH: imgData.height };
    }, screenshot.toString('base64'));

    console.log('Rendered pencil continuity:', renderResult);
    expect(renderResult.linePixels).toBeGreaterThan(50);
    expect(renderResult.gaps).toBe(0);
  });
});
