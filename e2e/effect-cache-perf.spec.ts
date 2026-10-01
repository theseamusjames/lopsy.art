import { test, expect, type Page } from './fixtures';
import { addLayer, closeEffectsPanel, configureEffect, createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

// Benchmark for the live compositor's per-layer effect cache. A 4000×4000
// document with 20 layers that each carry a drop shadow, an outside stroke
// and an outer glow, plus a plain layer on top. Every frame used to rerun
// every layer's blurs, distance fields and dilations, so brushing on the
// plain layer or panning the view crawled. With the cache, those frames
// replay the stored effect images and only the edited layer is
// recomputed.
//
// Runs on the real GPU through ANGLE's Metal backend where it exists (macOS);
// elsewhere Chromium falls back to its default (the renderer is reported).
// Reports
// frame times; the assertions only check that the scenario ran and — when
// the engine exposes the cache — that brushing and panning never had to
// recompute a styled layer's effects.

const DOC = 4000;
const LAYERS = 20;

interface FrameSample {
  interval: number;
  drain: number;
}

interface CacheStats {
  entries: number;
  images: number;
  bytes: number;
  budgetBytes: number;
  hits: number;
  misses: number;
}

test.use({
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  },
});

async function cacheStats(page: Page): Promise<CacheStats | null> {
  return page.evaluate(() => {
    const fn = (window as unknown as { __effectCacheStats?: () => CacheStats | null }).__effectCacheStats;
    return fn ? fn() : null;
  });
}

/**
 * Record every animation frame until `stop` is called: the interval since the
 * previous frame, and how long a 1×1 readPixels on the engine's own context
 * blocked — that drains whatever GPU work the frame queued, so slow GPU
 * frames show up even though the CPU side returns early.
 */
async function startFrameRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('[data-testid="canvas-container"] canvas')) as HTMLCanvasElement[];
    const glCanvas = canvases.find((c) => !/overlayCanvas/.test(c.className));
    const gl = glCanvas?.getContext('webgl2') ?? null;
    const px = new Uint8Array(4);
    const samples: Array<{ interval: number; drain: number }> = [];
    const w = window as unknown as { __perfFrames: typeof samples; __perfRunning: boolean };
    w.__perfFrames = samples;
    w.__perfRunning = true;
    let last = performance.now();
    const tick = () => {
      if (!w.__perfRunning) return;
      const t0 = performance.now();
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t1 = performance.now();
      samples.push({ interval: t0 - last, drain: t1 - t0 });
      last = t1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameRecorder(page: Page): Promise<FrameSample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __perfFrames: FrameSample[]; __perfRunning: boolean };
    w.__perfRunning = false;
    return w.__perfFrames;
  });
}

function summarize(label: string, wallMs: number, frames: FrameSample[]): string {
  const totals = frames.map((f) => f.interval + f.drain).sort((a, b) => a - b);
  const pct = (p: number) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))] ?? 0;
  const recorded = totals.reduce((a, b) => a + b, 0);
  return `${label}: ${(wallMs / 60).toFixed(1)} ms per input event (${wallMs.toFixed(0)} ms for 60), ` +
    `${frames.length} frames at ${(frames.length / (recorded / 1000)).toFixed(1)} fps, ` +
    `frame time incl. GPU drain p50 ${pct(0.5).toFixed(1)} / p95 ${pct(0.95).toFixed(1)} / max ${(totals[totals.length - 1] ?? 0).toFixed(1)} ms`;
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('Effect cache perf — 4000x4000, 20 styled layers', () => {
  test.use({ allowConsoleErrors: [/.*/] });

  test('brushing on a plain layer and panning reuse cached effects', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'GPU timing via readPixels is measured on Chromium');
    test.setTimeout(1_800_000);

    await page.goto('/');
    await waitForStore(page);
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    test.skip(renderer === null, 'WebGL2 not available');

    await createDocument(page, DOC, DOC, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // One styled square, filled the way a user would, then duplicated.
    const first = await addLayer(page);
    await setForegroundColor(page, 220, 40, 40);
    await selectTool(page, 'marquee-rect');
    await dragDoc(page, 300, 300, 800, 800);
    await page.getByRole('button', { name: /^Edit$/ }).click();
    await page.getByRole('menuitem', { name: /^Fill$/ }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    await configureEffect(page, 'Drop Shadow', { 'Offset X': 25, 'Offset Y': 25, Blur: 30 });
    await configureEffect(page, 'Stroke', { Width: 8 });
    await configureEffect(page, 'Outer Glow', { Size: 40 });
    await closeEffectsPanel(page);

    for (let i = 1; i < LAYERS; i++) {
      await page.locator('[aria-label="Duplicate Layer"]').click();
      await page.waitForTimeout(250);
    }
    const plain = await addLayer(page);

    const layers = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number; width: number; height: number; effects?: { dropShadow?: { enabled: boolean } } }> } };
      };
      return store.getState().document.layers.map((l) => ({
        id: l.id, x: l.x, y: l.y, w: l.width, h: l.height, shadow: !!l.effects?.dropShadow?.enabled,
      }));
    });
    const styled = layers.filter((l) => l.shadow);
    expect(styled.length).toBe(LAYERS);
    expect(layers.some((l) => l.id === first)).toBe(true);

    // Settle: the first frames fill the cache.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => (window as unknown as { __readCompositedPixels: () => Promise<unknown> }).__readCompositedPixels());
    }

    // --- Full recomposite (what every pan frame does), timed with a drain ---
    const recomposite: number[] = [];
    for (let i = 0; i < 5; i++) {
      recomposite.push(await page.evaluate(async () => {
        const t0 = performance.now();
        await (window as unknown as { __readCompositedPixels: () => Promise<unknown> }).__readCompositedPixels();
        return performance.now() - t0;
      }));
    }
    recomposite.sort((a, b) => a - b);

    // --- Brush on the plain top layer ---
    const statsBeforeBrush = await cacheStats(page);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 40);
    const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
    await startFrameRecorder(page);
    const brushStart = Date.now();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) {
      const t = i / 60;
      await page.mouse.move(box.x + box.width * (0.2 + 0.6 * t), box.y + box.height * (0.3 + 0.4 * Math.sin(t * Math.PI)));
    }
    await page.mouse.up();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const brushWall = Date.now() - brushStart;
    const brushFrames = await stopFrameRecorder(page);
    const statsAfterBrush = await cacheStats(page);

    // --- Pan with the wheel ---
    await startFrameRecorder(page);
    const panStart = Date.now();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(i % 20 < 10 ? 25 : -25, i % 30 < 15 ? 15 : -15);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const panWall = Date.now() - panStart;
    const panFrames = await stopFrameRecorder(page);
    const statsAfterPan = await cacheStats(page);

    const sizes = styled.slice(0, 3).map((l) => `${l.w}x${l.h}@${l.x},${l.y}`).join(' ');
    let report = `Effect cache perf — ${DOC}x${DOC}, ${LAYERS} layers with shadow + stroke + glow\n`;
    report += `Renderer: ${renderer}\n`;
    report += `Styled layer textures (first 3): ${sizes}\n`;
    report += `Full recomposite + readback: p50 ${recomposite[2]!.toFixed(1)} ms (min ${recomposite[0]!.toFixed(1)}, max ${recomposite[4]!.toFixed(1)})\n`;
    report += summarize('Brush on plain layer', brushWall, brushFrames) + '\n';
    report += summarize('Wheel pan', panWall, panFrames) + '\n';
    if (statsAfterBrush && statsAfterPan) {
      // 20 lookups per full composite; a pan that only re-presents does none.
      report += `Full composites during the pan: ${((statsAfterPan.hits + statsAfterPan.misses - statsAfterBrush.hits - statsAfterBrush.misses) / LAYERS).toFixed(0)}\n`;
    }
    report += `Cache: ${JSON.stringify(statsAfterPan)}\n`;
    console.log(report);
    const outDir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'effect-cache-perf.txt'), report);

    expect(brushFrames.length).toBeGreaterThan(0);
    expect(panFrames.length).toBeGreaterThan(0);
    expect(plain).not.toBe(first);

    if (statsBeforeBrush && statsAfterBrush && statsAfterPan) {
      // Every styled layer is cached, and neither brushing on another layer
      // nor panning recomputed any of them.
      expect(statsAfterPan.entries).toBe(LAYERS);
      expect(statsAfterBrush.misses).toBe(statsBeforeBrush.misses);
      expect(statsAfterPan.misses).toBe(statsAfterBrush.misses);
      expect(statsAfterPan.hits).toBeGreaterThan(statsBeforeBrush.hits);
      expect(statsAfterPan.bytes).toBeLessThanOrEqual(statsAfterPan.budgetBytes);
    }
  });
});
