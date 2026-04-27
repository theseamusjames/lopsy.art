import { test, expect } from './fixtures';
import { waitForStore } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

function spiralPath(cx: number, cy: number, maxRadius: number, revolutions: number, numPoints: number) {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const angle = t * revolutions * 2 * Math.PI;
    const r = t * maxRadius;
    pts.push({ x: Math.round(cx + Math.cos(angle) * r), y: Math.round(cy + Math.sin(angle) * r) });
  }
  return pts;
}

test.describe('Brush perf — 1080x1080 profile', () => {
  test.use({ allowConsoleErrors: [/.*/] });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('profile sustained spiral on 1080x1080', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP profiler requires Chromium');
    test.setTimeout(300_000);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(1080, 1080, false);
    });

    await page.keyboard.press('b');
    await page.evaluate(() => {
      const toolStore = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setBrushSize: (s: number) => void; setBrushHardness: (h: number) => void };
      };
      toolStore.getState().setBrushSize(10);
      toolStore.getState().setBrushHardness(80);
    });

    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    const maxRadius = Math.min(box!.width, box!.height) * 0.35;

    const client = await page.context().newCDPSession(page);
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 200 });
    await client.send('Profiler.start');

    const durationMs = 2_000;
    const pointsPerSecond = 60;
    const totalPoints = Math.round((durationMs / 1000) * pointsPerSecond);
    const points = spiralPath(cx, cy, maxRadius, 3, totalPoints);

    const moveTimestamps: number[] = [];
    const overallStart = Date.now();

    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    const strokeStart = Date.now();
    for (let i = 1; i < points.length; i++) {
      await page.mouse.move(points[i]!.x, points[i]!.y);
      moveTimestamps.push(Date.now());
      const elapsed = Date.now() - strokeStart;
      const targetTime = (i / points.length) * durationMs;
      if (targetTime > elapsed) {
        await page.waitForTimeout(Math.min(targetTime - elapsed, 4));
      }
    }
    await page.mouse.up();

    const totalElapsed = Date.now() - overallStart;

    const { profile } = await client.send('Profiler.stop');
    await client.send('Profiler.disable');
    await client.detach();

    interface ProfileNode {
      id: number;
      callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
      hitCount?: number;
      children?: number[];
    }
    const nodes = (profile as { nodes: ProfileNode[] }).nodes;
    const samples = (profile as { samples: number[] }).samples;
    const timeDeltas = (profile as { timeDeltas: number[] }).timeDeltas;

    const selfTime = new Map<number, number>();
    for (let i = 0; i < samples.length; i++) {
      const id = samples[i]!;
      selfTime.set(id, (selfTime.get(id) ?? 0) + (timeDeltas[i]! ?? 0));
    }
    const totalSampleTime = timeDeltas.reduce((a, b) => a + b, 0);

    const hotNodes = nodes
      .map((n) => ({
        name: n.callFrame.functionName || '(anon)',
        url: n.callFrame.url,
        line: n.callFrame.lineNumber,
        self: selfTime.get(n.id) ?? 0,
      }))
      .filter((n) => n.self > 0)
      .sort((a, b) => b.self - a.self)
      .slice(0, 40);

    const moveDeltas: number[] = [];
    for (let i = 1; i < moveTimestamps.length; i++) {
      moveDeltas.push(moveTimestamps[i]! - moveTimestamps[i - 1]!);
    }
    moveDeltas.sort((a, b) => a - b);
    const p50 = moveDeltas[Math.floor(moveDeltas.length * 0.5)] ?? 0;
    const p95 = moveDeltas[Math.floor(moveDeltas.length * 0.95)] ?? 0;
    const p99 = moveDeltas[Math.floor(moveDeltas.length * 0.99)] ?? 0;
    const maxD = moveDeltas[moveDeltas.length - 1] ?? 0;

    const dir = path.join(process.cwd(), 'tests', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const profilePath = path.join(dir, 'brush-spiral-1080.cpuprofile');
    fs.writeFileSync(profilePath, JSON.stringify(profile));

    let report = `Brush Perf — 1080x1080 spiral (${totalElapsed}ms)\n`;
    report += `==========================================\n\n`;
    report += `Profile sample time: ${(totalSampleTime / 1000).toFixed(1)}ms\n`;
    report += `Move events: ${moveTimestamps.length}\n`;
    report += `Move-to-move p50 ${p50}ms p95 ${p95}ms p99 ${p99}ms max ${maxD}ms\n\n`;
    report += `Top 40 self-time functions:\n`;
    for (const n of hotNodes) {
      const pct = ((n.self / totalSampleTime) * 100).toFixed(1);
      const short = n.url.replace(/^https?:\/\/[^/]+\//, '/').replace(/\?.*$/, '');
      report += `  ${(n.self / 1000).toFixed(2)}ms ${pct}%  ${n.name}  ${short}:${n.line}\n`;
    }

    console.log(report);
    fs.writeFileSync(path.join(dir, 'brush-spiral-1080-report.txt'), report);

    expect(moveTimestamps.length).toBeGreaterThan(0);
  });
});
