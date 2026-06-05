import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForStore } from './helpers';

/**
 * Decode samples/sample.RAF, export the document as JPG, and write to
 * /tmp/lopsy_out.jpg. A companion Python script then compares this against
 * /tmp/target.jpg (the camera-rendered reference) to drive decoder tuning.
 */
test('RAF decode → export JPG for comparison', async ({ page }) => {
  test.setTimeout(240000);

  const consoleLogs: string[] = [];
  page.on('console', (msg) => consoleLogs.push(msg.text()));
  page.on('pageerror', (err) => consoleLogs.push('PAGEERROR: ' + err.message));

  await page.goto('/');
  await waitForStore(page);

  // Skip if local-only sample isn't present.
  const sampleAvailable = await page.evaluate(async () => {
    try {
      const head = await fetch('/test-sample.raf', { method: 'HEAD' });
      if (!head.ok) return false;
      const ct = head.headers.get('content-type') ?? '';
      return !ct.includes('text/html');
    } catch { return false; }
  });
  test.skip(!sampleAvailable, 'samples/sample.RAF not present (local dev only)');

  // Import the RAF
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
  expect(importResult.ok, `Import failed: ${importResult.error}`).toBe(true);

  // Give a couple of frames for the engine to fully render
  await page.waitForTimeout(2000);

  // Composite at full document size and return as JPG base64.
  const jpegB64 = await page.evaluate(async () => {
    const exportFn = (window as unknown as { __exportDocAsJpg?: (le: number, q: number) => Promise<{width: number; height: number; b64: string} | null> }).__exportDocAsJpg;
    if (!exportFn) return null;
    return exportFn(1620, 0.92);
  });
  console.log('Export result:', jpegB64 ? `${jpegB64.width}x${jpegB64.height}, ${jpegB64.b64.length} b64 chars` : 'null');

  expect(jpegB64, 'export failed').toBeTruthy();
  expect((jpegB64 as Record<string, unknown>).b64, 'no b64 in export result').toBeTruthy();
  const result = jpegB64 as { width: number; height: number; b64: string };
  const buf = Buffer.from(result.b64, 'base64');
  const outPath = path.resolve('/tmp/lopsy_out.jpg');
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${buf.length} bytes to ${outPath} (${result.width}×${result.height})`);

  // Brief log
  for (const l of consoleLogs.filter((l) => l.includes('[RAF') || l.startsWith('PAGEERROR'))) {
    console.log(l);
  }
});
