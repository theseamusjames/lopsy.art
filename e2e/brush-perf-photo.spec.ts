import { test, expect } from './fixtures';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '..', 'sample.jpg');

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

test('brush perf: 5 rapid strokes on 23MP photo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP required');
  test.skip(!existsSync(samplePath), 'sample.jpg not present');
  test.setTimeout(120_000);

  await page.goto('/');
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
    null,
    { timeout: 30_000 },
  );

  // Open sample.jpg
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('text=Open').first().click(),
  ]);
  await fileChooser.setFiles(samplePath);
  await page.waitForFunction(
    () => (window as unknown as Record<string, { getState: () => { documentReady: boolean } }>).__editorStore?.getState().documentReady,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);

  // Select brush tool, set size
  await page.keyboard.press('b');
  await page.waitForTimeout(300);

  const container = page.locator('[data-testid="canvas-container"]');
  const box = await container.boundingBox();
  if (!box) throw new Error('No canvas container');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Start CDP for performance measurement
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise(r => setTimeout(r, 300));
  const heapBefore = await cdp.send('Runtime.getHeapUsage') as { usedSize: number; totalSize: number };
  const wasmBefore = await page.evaluate(() => {
    const w = window as unknown as Record<string, { getWasmMemoryBytes?: () => number }>;
    return w.__wasmBridge?.getWasmMemoryBytes?.() ?? 0;
  });

  console.log(`\n=== BASELINE (after image load, before strokes) ===`);
  console.log(`  JS Heap: ${formatMB(heapBefore.usedSize)}`);
  console.log(`  WASM:    ${formatMB(wasmBefore)}`);

  // Draw 5 strokes in rapid succession, timing each
  const strokeTimings: number[] = [];
  const strokeGaps = [0, 50, 50, 50, 50]; // ms between strokes

  for (let i = 0; i < 5; i++) {
    if (i > 0) await page.waitForTimeout(strokeGaps[i]!);

    const y = cy - 100 + i * 50;
    const startX = cx - 150;
    const endX = cx + 150;

    const t0 = performance.now();

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(endX, y, { steps: 10 });
    await page.mouse.up();

    const t1 = performance.now();
    strokeTimings.push(t1 - t0);
    console.log(`  Stroke ${i + 1}: ${(t1 - t0).toFixed(0)}ms`);
  }

  // Wait for background compression
  await page.waitForTimeout(3000);

  // Measure after
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise(r => setTimeout(r, 300));
  const heapAfter = await cdp.send('Runtime.getHeapUsage') as { usedSize: number; totalSize: number };
  const wasmAfter = await page.evaluate(() => {
    const w = window as unknown as Record<string, { getWasmMemoryBytes?: () => number }>;
    return w.__wasmBridge?.getWasmMemoryBytes?.() ?? 0;
  });

  const undoInfo = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => {
      undoStack: Array<{ kind: string; gpuSnapshots?: Map<string, number> }>;
    } }>).__editorStore;
    const state = store?.getState();
    if (!state) return { count: 0, handleCount: 0 };
    let handleCount = 0;
    for (const entry of state.undoStack) {
      if (entry.kind !== 'pixels' || !entry.gpuSnapshots) continue;
      for (const handle of entry.gpuSnapshots.values()) {
        if (handle !== 0xFFFFFFFF) handleCount++;
      }
    }
    return { count: state.undoStack.length, handleCount };
  });

  console.log(`\n=== AFTER 5 STROKES ===`);
  console.log(`  JS Heap: ${formatMB(heapAfter.usedSize)} (${formatMB(heapAfter.usedSize - heapBefore.usedSize)} growth)`);
  console.log(`  WASM:    ${formatMB(wasmAfter)} (${formatMB(wasmAfter - wasmBefore)} growth)`);
  console.log(`  Undo stack: ${undoInfo.count} entries, ${undoInfo.handleCount} WASM handles (blobs in WASM memory, not JS)`);

  console.log(`\n=== STROKE TIMINGS ===`);
  const avg = strokeTimings.reduce((a, b) => a + b, 0) / strokeTimings.length;
  console.log(`  Average: ${avg.toFixed(0)}ms`);
  console.log(`  Min:     ${Math.min(...strokeTimings).toFixed(0)}ms`);
  console.log(`  Max:     ${Math.max(...strokeTimings).toFixed(0)}ms`);

  await cdp.detach();

  // Assertions
  expect(avg).toBeLessThan(5000); // SwiftShader is slow; real GPU should be <500ms
  expect(undoInfo.handleCount).toBeGreaterThan(0);
});
