import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('DNG ProRAW import screenshot', async ({ page }) => {
  const filePath = path.resolve(__dirname, 'sample_images/proraw.dng');
  test.skip(!fs.existsSync(filePath), 'sample DNG file not present');
  test.setTimeout(120000);
  // Capture console output before navigation
  const consoleLogs: string[] = [];
  page.on('console', (msg) => consoleLogs.push(msg.text()));

  await page.goto('/');

  // Wait for the app to be ready (new document modal visible)
  await page.waitForSelector('h2:has-text("New Document")', { timeout: 15000 });

  // Use the file chooser to open the DNG
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('button:has-text("Open File")'),
  ]);
  await fileChooser.setFiles(filePath);

  // Wait for the document to load (canvas container appears + loading modal gone)
  await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 30000 });

  // Wait for loading modal to disappear
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][aria-label*="Opening"]'),
    { timeout: 30000 },
  );

  // Give the engine a couple frames to render
  await page.waitForTimeout(2000);

  // Take a screenshot
  await page.screenshot({ path: 'e2e/screenshots/dng-proraw-import.png' });

  // Print DNG pipeline logs
  const dngLogs = consoleLogs.filter((l) => l.includes('[DNG'));
  for (const line of dngLogs) {
    console.log(line);
  }

  // Read the editor state to see what adjustments are set
  const state = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const s = store.getState();
    const doc = s.document as Record<string, unknown>;
    const layers = doc.layers as Array<Record<string, unknown>>;
    const rootGroupId = doc.rootGroupId as string;
    const rootGroup = layers.find((l) => l.id === rootGroupId) as Record<string, unknown> | undefined;

    return {
      width: doc.width,
      height: doc.height,
      name: doc.name,
      layerCount: layers.length,
      rootGroupAdjustments: rootGroup?.adjustments ?? null,
      rootGroupAdjustmentsEnabled: rootGroup?.adjustmentsEnabled ?? null,
      layers: layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        width: l.width,
        height: l.height,
        x: l.x,
        y: l.y,
      })),
    };
  });

  console.log('Document state:', JSON.stringify(state, null, 2));

  // Also sample some pixels from the composited output
  const pixels = await page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, () => Promise<{ width: number; height: number; pixels: number[] }>>).__readCompositedPixels;
    if (!readFn) return null;
    const result = await readFn();
    const w = result.width;
    const h = result.height;
    const px = result.pixels;

    // Sample 5 points across the image
    const samples: Array<{ x: number; y: number; r: number; g: number; b: number; a: number }> = [];
    const points = [
      [Math.floor(w / 4), Math.floor(h / 4)],
      [Math.floor(w / 2), Math.floor(h / 4)],
      [Math.floor(w / 2), Math.floor(h / 2)],
      [Math.floor(3 * w / 4), Math.floor(h / 2)],
      [Math.floor(w / 2), Math.floor(3 * h / 4)],
    ];

    for (const [x, y] of points) {
      // Composited pixels are bottom-up
      const flippedY = h - 1 - y;
      const idx = (flippedY * w + x) * 4;
      samples.push({
        x, y,
        r: px[idx] ?? 0,
        g: px[idx + 1] ?? 0,
        b: px[idx + 2] ?? 0,
        a: px[idx + 3] ?? 0,
      });
    }

    return { width: w, height: h, samples };
  });

  console.log('Pixel samples:', JSON.stringify(pixels, null, 2));
});
