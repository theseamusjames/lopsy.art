import { test, expect } from './fixtures';
import { waitForStore } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

function hatchingStrokes(
  left: number,
  top: number,
  width: number,
  height: number,
  count: number,
): Array<Array<{ x: number; y: number }>> {
  const strokes: Array<{ x: number; y: number }>[] = [];
  const stepY = height / count;
  const strokeLen = 40;

  for (let i = 0; i < count; i++) {
    const y = top + i * stepY;
    const xBase = left + (i % 7) * (width / 7) + Math.random() * (width / 10);
    const forward = i % 2 === 0;

    const x0 = Math.round(xBase);
    const y0 = Math.round(y);
    const dx = forward ? strokeLen : -strokeLen;
    const dy = strokeLen * 0.6;

    strokes.push([
      { x: x0, y: y0 },
      { x: Math.round(x0 + dx * 0.5), y: Math.round(y0 + dy * 0.5) },
      { x: Math.round(x0 + dx), y: Math.round(y0 + dy) },
    ]);
  }

  return strokes;
}

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

function analyzeProfile(profile: {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}): { hotNodes: { name: string; url: string; line: number; self: number }[]; totalSampleTime: number } {
  const { nodes, samples, timeDeltas } = profile;
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
  return { hotNodes, totalSampleTime };
}

function formatProfile(
  hotNodes: { name: string; url: string; line: number; self: number }[],
  totalSampleTime: number,
): string {
  let out = '';
  for (const n of hotNodes) {
    const pct = ((n.self / totalSampleTime) * 100).toFixed(1);
    const short = n.url.replace(/^https?:\/\/[^/]+\//, '/').replace(/\?.*$/, '');
    out += `  ${(n.self / 1000).toFixed(2)}ms ${pct}%  ${n.name}  ${short}:${n.line}\n`;
  }
  return out;
}

test.use({
  launchOptions: {
    args: ['--enable-webgl', '--enable-webgl2-compute-context', '--ignore-gpu-blocklist'],
  },
});

test.describe('Brush perf — 6000x4000 cross-hatch', () => {
  test.use({ allowConsoleErrors: [/.*/] });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('rapid cross-hatch strokes on 6000x4000', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP profiler requires Chromium');
    test.setTimeout(600_000);

    const outDir = path.join(process.cwd(), 'tests', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });

    // --- create 6000x4000 document ---
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(6000, 4000, false);
    });
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 60000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="canvas-container"]');
      return el && el.getBoundingClientRect().width > 0;
    }, { timeout: 60000 });

    // --- brush tool, small brush for hatching ---
    await page.keyboard.press('b');
    await page.evaluate(() => {
      const toolStore = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setBrushSize: (s: number) => void;
          setBrushHardness: (h: number) => void;
        };
      };
      toolStore.getState().setBrushSize(12);
      toolStore.getState().setBrushHardness(90);
    });

    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    const margin = 40;
    const strokes = hatchingStrokes(
      box!.x + margin,
      box!.y + margin,
      box!.width - margin * 2,
      box!.height - margin * 2,
      100,
    );

    // ================================================================
    // PHASE 1: Brush hatching (profiled)
    // ================================================================
    const client = await page.context().newCDPSession(page);
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 });
    await client.send('Profiler.start');

    const strokeTimestamps: Array<{ start: number; end: number }> = [];
    const interStrokeGaps: number[] = [];
    const overallStart = Date.now();
    let prevEnd = 0;

    for (const pts of strokes) {
      const sStart = Date.now();
      if (prevEnd > 0) interStrokeGaps.push(sStart - prevEnd);

      await page.mouse.move(pts[0]!.x, pts[0]!.y);
      await page.mouse.down();
      for (let i = 1; i < pts.length; i++) {
        await page.mouse.move(pts[i]!.x, pts[i]!.y);
      }
      await page.mouse.up();

      const sEnd = Date.now();
      strokeTimestamps.push({ start: sStart, end: sEnd });
      prevEnd = sEnd;
    }

    const brushElapsed = Date.now() - overallStart;

    const { profile: brushProfile } = await client.send('Profiler.stop');

    // --- brush report ---
    const strokeDurations = strokeTimestamps.map((s) => s.end - s.start);
    strokeDurations.sort((a, b) => a - b);
    const pctl = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0;

    interStrokeGaps.sort((a, b) => a - b);

    const bp = analyzeProfile(brushProfile as { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] });

    let report = `PHASE 1: Brush Hatching — 6000x4000 (${brushElapsed}ms)\n`;
    report += `============================================================\n\n`;
    report += `Strokes: ${strokes.length} | Strokes/sec: ${(strokes.length / (brushElapsed / 1000)).toFixed(1)}\n`;
    report += `Per-stroke p50: ${pctl(strokeDurations, 0.5)}ms  p95: ${pctl(strokeDurations, 0.95)}ms  max: ${strokeDurations[strokeDurations.length - 1]}ms\n\n`;
    report += `Top 40 self-time:\n${formatProfile(bp.hotNodes, bp.totalSampleTime)}\n`;

    // ================================================================
    // PHASE 2: Select layer content → marching ants animation
    // ================================================================

    // Cmd+click the layer thumbnail to select layer alpha
    await page.evaluate(() => {
      const { selectLayerAlpha } = (window as unknown as Record<string, unknown>)
        .__layerSelectionModule as { selectLayerAlpha: (id: string) => void } | undefined ?? {};
      if (selectLayerAlpha) {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { document: { activeLayerId: string } };
        };
        selectLayerAlpha(store.getState().document.activeLayerId);
        return;
      }
    });

    // If the module isn't exposed, try clicking with meta key
    const hasSelection = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });

    if (!hasSelection) {
      const thumb = page.locator('[class*="thumbnailCanvas"]').first();
      await thumb.click({ modifiers: ['Meta'] });
      await page.waitForTimeout(200);
    }

    // Confirm selection is active
    const selectionActive = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean; maskWidth: number; maskHeight: number } };
      };
      const sel = store.getState().selection;
      return { active: sel.active, maskW: sel.maskWidth, maskH: sel.maskHeight };
    });
    console.log('Selection state:', JSON.stringify(selectionActive));

    // Start profiling the marching ants animation
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 });
    await client.send('Profiler.start');

    // Measure frame rate during marching ants for 3 seconds
    const antsFrameData = await page.evaluate(() => {
      return new Promise<{ frameTimes: number[]; elapsed: number }>((resolve) => {
        const frameTimes: number[] = [];
        let lastTime = performance.now();
        const startTime = lastTime;
        const duration = 3000;

        function tick() {
          const now = performance.now();
          frameTimes.push(now - lastTime);
          lastTime = now;

          if (now - startTime < duration) {
            requestAnimationFrame(tick);
          } else {
            resolve({ frameTimes, elapsed: now - startTime });
          }
        }
        requestAnimationFrame(tick);
      });
    });

    const { profile: antsProfile } = await client.send('Profiler.stop');

    // --- analyze marching ants profile ---
    const ap = analyzeProfile(antsProfile as { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] });

    const ft = antsFrameData.frameTimes;
    ft.sort((a, b) => a - b);
    const avgFps = 1000 / (ft.reduce((a, b) => a + b, 0) / ft.length);
    const slowFrames = ft.filter((t) => t > 33).length;
    const verySlowFrames = ft.filter((t) => t > 100).length;

    report += `\nPHASE 2: Marching Ants Animation — ${antsFrameData.elapsed.toFixed(0)}ms\n`;
    report += `============================================================\n\n`;
    report += `Selection: ${selectionActive.maskW}x${selectionActive.maskH}\n`;
    report += `Frames: ${ft.length} | Avg FPS: ${avgFps.toFixed(1)}\n`;
    report += `Frame time p50: ${pctl(ft, 0.5).toFixed(1)}ms  p95: ${pctl(ft, 0.95).toFixed(1)}ms  max: ${ft[ft.length - 1]?.toFixed(1)}ms\n`;
    report += `Slow frames (>33ms): ${slowFrames}/${ft.length} (${((slowFrames / ft.length) * 100).toFixed(1)}%)\n`;
    report += `Very slow frames (>100ms): ${verySlowFrames}/${ft.length} (${((verySlowFrames / ft.length) * 100).toFixed(1)}%)\n\n`;
    report += `Top 40 self-time:\n${formatProfile(ap.hotNodes, ap.totalSampleTime)}\n`;

    // ================================================================
    // PHASE 3: Move tool drag with active selection
    // ================================================================

    // Switch to move tool
    await page.keyboard.press('v');
    await page.waitForTimeout(100);

    // Profile two separate drags to see first-move cost
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 });
    await client.send('Profiler.start');

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Two separate drags with timestamps for each event
    const allEvents: Array<{ label: string; time: number }> = [];

    for (let drag = 0; drag < 2; drag++) {
      const startX = cx + drag * 50;
      const startY = cy + drag * 50;
      const dragPts = Array.from({ length: 16 }, (_, i) => ({
        x: startX + (i + 1) * 15,
        y: startY + ((i % 2) * 10 - 5),
      }));

      await page.mouse.move(startX, startY);
      allEvents.push({ label: `drag${drag + 1}:mousedown`, time: Date.now() });
      await page.mouse.down();
      allEvents.push({ label: `drag${drag + 1}:after-down`, time: Date.now() });

      for (let i = 0; i < dragPts.length; i++) {
        await page.mouse.move(dragPts[i]!.x, dragPts[i]!.y);
        allEvents.push({ label: `drag${drag + 1}:move${i}`, time: Date.now() });
      }

      allEvents.push({ label: `drag${drag + 1}:before-up`, time: Date.now() });
      await page.mouse.up();
      allEvents.push({ label: `drag${drag + 1}:after-up`, time: Date.now() });

      await page.waitForTimeout(50);
    }

    const moveElapsed = allEvents[allEvents.length - 1]!.time - allEvents[0]!.time;

    const { profile: moveProfile } = await client.send('Profiler.stop');
    await client.send('Profiler.disable');
    await client.detach();

    await page.screenshot({
      path: path.join(outDir, 'brush-6k-move-selection.png'),
      fullPage: false,
    });

    fs.writeFileSync(path.join(outDir, 'brush-6k-crosshatch.cpuprofile'), JSON.stringify(brushProfile));
    fs.writeFileSync(path.join(outDir, 'brush-6k-marching-ants.cpuprofile'), JSON.stringify(antsProfile));
    fs.writeFileSync(path.join(outDir, 'brush-6k-move.cpuprofile'), JSON.stringify(moveProfile));

    const mp = analyzeProfile(moveProfile as { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] });

    // Build per-event timeline
    report += `\nPHASE 3: Move Tool Drag with Selection — ${moveElapsed}ms\n`;
    report += `============================================================\n\n`;
    report += `Event timeline (ms since start):\n`;
    const t0 = allEvents[0]!.time;
    let prevTime = t0;
    for (const ev of allEvents) {
      const delta = ev.time - prevTime;
      const abs = ev.time - t0;
      report += `  ${abs.toString().padStart(6)}ms (+${delta.toString().padStart(4)}ms)  ${ev.label}\n`;
      prevTime = ev.time;
    }
    report += `\n`;
    report += `Top 40 self-time:\n${formatProfile(mp.hotNodes, mp.totalSampleTime)}\n`;

    console.log(report);
    fs.writeFileSync(path.join(outDir, 'brush-6k-full-report.txt'), report);

    // --- assertions ---
    expect(strokes.length).toBe(100);
    expect(selectionActive.active).toBe(true);
    expect(ft.length).toBeGreaterThan(0);
  });
});
