import { test, expect } from '@playwright/test';
import { waitForStore } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate a spiral path of screen-coordinate points.
 * Starts at center and spirals outward.
 */
function spiralPath(
  cx: number,
  cy: number,
  maxRadius: number,
  revolutions: number,
  numPoints: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const angle = t * revolutions * 2 * Math.PI;
    const r = t * maxRadius;
    points.push({
      x: Math.round(cx + Math.cos(angle) * r),
      y: Math.round(cy + Math.sin(angle) * r),
    });
  }
  return points;
}

test.describe('Brush performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('sustained fast spiral painting on 4K canvas', async ({ page }) => {
    test.setTimeout(120_000);

    // Create a large canvas (4K equivalent)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(4032, 3024, false);
    });

    // Set brush tool and size
    await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      uiStore.getState().setActiveTool('brush');

      const toolStore = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setBrushSize: (s: number) => void; setBrushHardness: (h: number) => void };
      };
      toolStore.getState().setBrushSize(40);
      toolStore.getState().setBrushHardness(80);
    });

    // Get the canvas container position
    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    const maxRadius = Math.min(box!.width, box!.height) * 0.35;

    // Start CDP profiling
    const client = await page.context().newCDPSession(page);
    await client.send('Profiler.enable');
    await client.send('Profiler.start');

    // Draw fast spirals for ~10 seconds
    // Multiple spiral strokes, each 2-3 seconds, moving fast
    const durationMs = 10_000;
    const pointsPerSecond = 200;
    const totalPoints = Math.round((durationMs / 1000) * pointsPerSecond);
    const delayPerPoint = durationMs / totalPoints;

    // Generate 3 spirals with different params for variety
    const spirals = [
      spiralPath(centerX, centerY, maxRadius, 5, Math.round(totalPoints * 0.33)),
      spiralPath(centerX - 50, centerY + 30, maxRadius * 0.8, 4, Math.round(totalPoints * 0.33)),
      spiralPath(centerX + 40, centerY - 20, maxRadius * 0.9, 6, Math.round(totalPoints * 0.34)),
    ];

    // Collect per-move timestamps to measure frame drops
    const moveTimestamps: number[] = [];
    const overallStart = Date.now();

    for (const points of spirals) {
      // Mouse down
      await page.mouse.move(points[0]!.x, points[0]!.y);
      await page.mouse.down();

      const strokeStart = Date.now();
      for (let i = 1; i < points.length; i++) {
        const pt = points[i]!;
        await page.mouse.move(pt.x, pt.y);
        moveTimestamps.push(Date.now());

        // Pace to target speed
        const elapsed = Date.now() - strokeStart;
        const targetTime = (i / points.length) * (durationMs / spirals.length);
        if (targetTime > elapsed) {
          await page.waitForTimeout(Math.min(targetTime - elapsed, 5));
        }
      }
      await page.mouse.up();
      // Brief pause between strokes
      await page.waitForTimeout(50);
    }

    const totalElapsed = Date.now() - overallStart;

    // Stop profiling
    const { profile } = await client.send('Profiler.stop');
    await client.send('Profiler.disable');
    await client.detach();

    await page.waitForTimeout(200);

    // Take screenshot
    const screenshotDir = path.join(process.cwd(), 'tests', 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, 'brush-spiral-4k.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    // Save profiler results
    const profilePath = path.join(screenshotDir, 'brush-spiral-4k.cpuprofile');
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

    // Analyze the profile
    interface ProfileNode {
      id: number;
      callFrame: {
        functionName: string;
        url: string;
        lineNumber: number;
        columnNumber: number;
      };
      hitCount?: number;
      children?: number[];
    }

    const nodes = (profile as { nodes: ProfileNode[] }).nodes;
    const samples = (profile as { samples: number[] }).samples;
    const timeDeltas = (profile as { timeDeltas: number[] }).timeDeltas;

    const selfTime = new Map<number, number>();
    for (let i = 0; i < samples.length; i++) {
      const nodeId = samples[i]!;
      const delta = timeDeltas[i]! ?? 0;
      selfTime.set(nodeId, (selfTime.get(nodeId) ?? 0) + delta);
    }

    const hotNodes = nodes
      .map((n) => ({
        name: n.callFrame.functionName || '(anonymous)',
        url: n.callFrame.url,
        line: n.callFrame.lineNumber,
        selfTime: selfTime.get(n.id) ?? 0,
      }))
      .filter((n) => n.selfTime > 0 && n.url.includes('/src/'))
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 30);

    const totalSampleTime = timeDeltas.reduce((a, b) => a + b, 0);

    // Analyze move-to-move timing for hitches
    const moveDeltas: number[] = [];
    for (let i = 1; i < moveTimestamps.length; i++) {
      moveDeltas.push(moveTimestamps[i]! - moveTimestamps[i - 1]!);
    }
    moveDeltas.sort((a, b) => a - b);
    const p50 = moveDeltas[Math.floor(moveDeltas.length * 0.5)] ?? 0;
    const p95 = moveDeltas[Math.floor(moveDeltas.length * 0.95)] ?? 0;
    const p99 = moveDeltas[Math.floor(moveDeltas.length * 0.99)] ?? 0;
    const maxDelta = moveDeltas[moveDeltas.length - 1] ?? 0;
    const hitchCount = moveDeltas.filter((d) => d > 50).length;

    // Write report
    let report = `Brush Performance — 4K Sustained Spiral (${totalElapsed}ms)\n`;
    report += `=======================================================\n\n`;
    report += `Total profile time: ${(totalSampleTime / 1000).toFixed(1)}ms\n`;
    report += `Sample count: ${samples.length}\n`;
    report += `Move events: ${moveTimestamps.length}\n\n`;
    report += `Move-to-move latency:\n`;
    report += `  p50: ${p50}ms\n`;
    report += `  p95: ${p95}ms\n`;
    report += `  p99: ${p99}ms\n`;
    report += `  max: ${maxDelta}ms\n`;
    report += `  hitches (>50ms): ${hitchCount} of ${moveDeltas.length}\n\n`;
    report += `Top 30 hottest functions (by self-time):\n\n`;
    for (const n of hotNodes) {
      const pct = ((n.selfTime / totalSampleTime) * 100).toFixed(1);
      const file = n.url.replace(/.*\/src\//, 'src/');
      report += `  ${(n.selfTime / 1000).toFixed(1)}ms (${pct}%) — ${n.name} @ ${file}:${n.line}\n`;
    }

    const reportPath = path.join(screenshotDir, 'brush-spiral-4k-report.txt');
    fs.writeFileSync(reportPath, report);

    console.log(report);

    // Drawn content analysis
    const drawnPixels = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      const data = state.resolvePixelData(activeId);
      if (!data) return 0;
      let count = 0;
      const d = data.data;
      for (let i = 3; i < d.length; i += 4) {
        if ((d[i] ?? 0) > 0) count++;
      }
      return count;
    });

    expect(drawnPixels).toBeGreaterThan(10000);

    // Perceptible hitches: moves taking >100ms are noticeable to users
    const perceptibleHitchCount = moveDeltas.filter((d) => d > 100).length;
    const perceptibleHitchPct = perceptibleHitchCount / moveDeltas.length;

    report += `\nHitch analysis:\n`;
    report += `  >50ms: ${hitchCount}/${moveDeltas.length} (${(hitchCount / moveDeltas.length * 100).toFixed(1)}%)\n`;
    report += `  >100ms: ${perceptibleHitchCount}/${moveDeltas.length} (${(perceptibleHitchPct * 100).toFixed(1)}%)\n`;
    fs.writeFileSync(reportPath, report);

    console.log(`Hitch rate (>50ms): ${(hitchCount / moveDeltas.length * 100).toFixed(1)}%`);
    console.log(`Hitch rate (>100ms): ${(perceptibleHitchPct * 100).toFixed(1)}%`);

    // No more than 5% of moves should have perceptible hitches (>100ms)
    expect(perceptibleHitchPct).toBeLessThan(0.05);
  });
});
