import { test, expect } from '@playwright/test';
import { waitForStore } from './helpers';

test('RAF import renders a recognizable image', async ({ page }) => {
  test.setTimeout(180000);

  const consoleLogs: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    consoleLogs.push(msg.text());
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');
  await waitForStore(page);

  // The sample RAF is 83 MB and lives outside the repo. Skip the test
  // if the dev server can't serve it (most CI envs). Check content-type
  // to avoid false positives from Vite's SPA fallback (serves index.html
  // for unknown routes with text/html content-type).
  const sampleAvailable = await page.evaluate(async () => {
    try {
      const head = await fetch('/test-sample.raf', { method: 'HEAD' });
      if (!head.ok) return false;
      const ct = head.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) return false;
      return true;
    } catch { return false; }
  });
  test.skip(!sampleAvailable, 'samples/sample.RAF not present (local dev only)');

  const importResult = await page.evaluate(async () => {
    try {
      const resp = await fetch('/test-sample.raf');
      if (!resp.ok) return { ok: false, error: `fetch: ${resp.status}` };
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const importFn = (window as unknown as Record<string, (data: Uint8Array, name: string) => Promise<void>>).__importRafFile;
      if (!importFn) return { ok: false, error: '__importRafFile not exposed' };
      await importFn(bytes, 'sample');
      return { ok: true, error: '' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  if (!importResult.ok) {
    console.log('Import error:', importResult.error);
    for (const l of consoleLogs.filter((l) => l.includes('[RAF'))) console.log(l);
    for (const e of consoleErrors) console.log('ERR:', e);
    await page.screenshot({ path: 'e2e/screenshots/raf-import-error.png' });
  }
  expect(importResult.ok, `Import failed: ${importResult.error}`).toBe(true);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/raf-import.png' });

  for (const line of consoleLogs.filter((l) => l.includes('[RAF'))) console.log(line);

  const pixels = await page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, () => Promise<{ width: number; height: number; pixels: number[] }>>).__readCompositedPixels;
    if (!readFn) return null;
    const result = await readFn();
    const w = result.width;
    const h = result.height;
    const px = result.pixels;

    const samples: Array<{ x: number; y: number; r: number; g: number; b: number; a: number }> = [];
    for (const [x, y] of [
      [Math.floor(w / 4), Math.floor(h / 4)],
      [Math.floor(w / 2), Math.floor(h / 4)],
      [Math.floor(w / 2), Math.floor(h / 2)],
      [Math.floor(3 * w / 4), Math.floor(h / 2)],
      [Math.floor(w / 2), Math.floor(3 * h / 4)],
    ]) {
      const flippedY = h - 1 - y;
      const idx = (flippedY * w + x) * 4;
      samples.push({ x, y, r: px[idx] ?? 0, g: px[idx + 1] ?? 0, b: px[idx + 2] ?? 0, a: px[idx + 3] ?? 0 });
    }

    let nonBlack = 0;
    let total = 0;
    for (let i = 0; i < px.length; i += 4) {
      total++;
      if ((px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0) > 30) nonBlack++;
    }

    return { width: w, height: h, samples, nonBlackPercent: Math.round(nonBlack / total * 100) };
  });

  console.log('Pixel data:', JSON.stringify(pixels, null, 2));
  expect(pixels).not.toBeNull();
  if (pixels) {
    expect(pixels.nonBlackPercent).toBeGreaterThan(30);
  }
});
