import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isHardwareGpu, suiteRenderer } from './gpu-args';
import { waitForReady } from './harness';
import { tiles, toast } from './library';
import { newMask } from './masks';

/**
 * Speed of the develop chain on the machine's GPU (docs/photonamous-linear-plan.md
 * section 7, Speed): the new linear chain against the old one
 * (`?develop=legacy`, src/engine/develop-override.ts), in one build, on
 * the renderer the run is started with. Measures how long a RAF takes to
 * show and to reach full resolution, one edit frame at the working size
 * and at 100 % for a set of recipes, and full-size exports.
 *
 * Runs only with PHOTONAMOUS_GPU=hardware and LOPSY_RAF_SAMPLES, one
 * renderer per run (docs/photonamous-setup.md, "Measuring on the real GPU"):
 *
 *   PHOTONAMOUS_GPU=hardware LOPSY_RAF_SAMPLES=<dir> VITE_PORT=5184 npx playwright test e2e/edit-speed.spec.ts
 *
 * SPEED_OUT=<file> appends every series as a line of JSON. SPEED_CHAINS
 * (linear,legacy), SPEED_PARTS (load,frames,zoom,export), SPEED_RECIPES
 * (a,b,c,d), SPEED_SLIDERS (Exposure,Large details), SPEED_SAMPLES and
 * SPEED_EXPORT_SAMPLES (file names) and SPEED_CHANGES (30) narrow a run.
 *
 * An edit frame is one step of a drag on a slider, a draft: the Edit view
 * renders the screen and nothing else for it. Each frame is
 * timed in the page from the pointer event to the GPU having finished the
 * frame's work: on WebGPU every queue the render submitted to answers
 * `onSubmittedWorkDone()`; on WebGL a one-pixel `readPixels` on the
 * canvas's context returns (Chromium's `finish()` does not wait). `render` is from the start of the engine's render call to the
 * same point, without the wait for the animation frame.
 */

const samples = process.env.LOPSY_RAF_SAMPLES;
const list = (name: string, fallback: string): string[] =>
  (process.env[name] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
const CHAINS = list('SPEED_CHAINS', 'linear,legacy') as ('linear' | 'legacy')[];
const PARTS = new Set(list('SPEED_PARTS', 'load,frames,zoom,export'));
const SAMPLES = list('SPEED_SAMPLES', 'DSCF8005.RAF,DSCF7795.RAF');
const EXPORT_SAMPLES = list('SPEED_EXPORT_SAMPLES', 'DSCF8005.RAF');
const CHANGES = Number(process.env.SPEED_CHANGES ?? 30);
const RECIPES = new Set(list('SPEED_RECIPES', 'a,b,c,d'));

/**
 * The sliders dragged, and the recipe path each sets. Dragging Exposure
 * leaves sharpening, noise reduction and local contrast out until it is
 * let go (the Edit view's `setInteractive`, spec 6.10); dragging Large
 * details keeps them in, so its frame is the whole chain.
 */
const SLIDERS: Readonly<Record<string, string>> = { Exposure: 'tone.exposure', 'Large details': 'localContrast.large' };
const SLIDER_NAMES = list('SPEED_SLIDERS', 'Exposure,Large details');
const OUT = process.env.SPEED_OUT;

type Chain = 'linear' | 'legacy';
type Changes = Record<string, number | string | boolean | { x: number; y: number }[] | null>;

/** (b): the tone sliders and Vibrance. */
const TONE: Changes = {
  'tone.exposure': 0.3,
  'tone.contrast': 25,
  'tone.highlights': -40,
  'tone.shadows': 30,
  'color.vibrance': 20,
};

/** What (c), the heavy case, adds to (b). */
const HEAVY: Changes = {
  'colorByHue.orange.hue': 10,
  'colorByHue.orange.saturation': -15,
  'colorByHue.orange.luminance': 10,
  'colorByHue.blue.saturation': 20,
  'colorByHue.blue.luminance': -10,
  'colorGrading.shadows.hue': 215,
  'colorGrading.shadows.saturation': 20,
  'colorGrading.highlights.hue': 45,
  'colorGrading.highlights.saturation': 15,
  'curves.luminance': [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.2 },
    { x: 0.75, y: 0.82 },
    { x: 1, y: 1 },
  ],
  'localContrast.large': 30,
  'localContrast.small': 25,
  'localContrast.haze': 15,
  'noise.luminance': 30,
  'noise.color': 25,
  'sharpness.amount': 60,
  'finish.vignette': 30,
  'finish.grain.amount': 20,
};

interface FrameTimes {
  /** Pointer event to the GPU done, ms. */
  readonly latency: number;
  /** Start of the engine's render call to the GPU done, ms. */
  readonly render: number;
  /** The render call itself, on the main thread (wasm encoding and submitting the passes), ms. */
  readonly call: number;
  /** WebGPU only: render passes the frame encoded, and the megapixels of their targets (0 on WebGL). */
  readonly passes: number;
  readonly megapixels: number;
}

interface Series {
  readonly renderer: string;
  readonly chain: Chain;
  readonly sample: string;
  readonly what: string;
  readonly run: number;
  readonly at: string;
  readonly [key: string]: unknown;
}

function record(series: Series): void {
  console.log(`SPEED ${JSON.stringify(series)}`);
  if (OUT) appendFileSync(OUT, `${JSON.stringify(series)}\n`);
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

const round = (n: number): number => Math.round(n * 10) / 10;
const now = (): string => new Date().toTimeString().slice(0, 8);

/**
 * In every page, before the app: notes each pointer move, the queues each
 * WebGPU submit goes to, and the time each live-view render starts (by
 * wrapping the render counts' `screen` field once they exist).
 */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Speed {
      lastMove: number;
      queues: Set<{ onSubmittedWorkDone: () => Promise<void> }>;
      onScreen: ((at: number) => void) | null;
      isHooked: boolean;
      passes: number;
      pixels: number;
    }
    const speed: Speed = { lastMove: 0, queues: new Set(), onScreen: null, isHooked: false, passes: 0, pixels: 0 };
    (window as unknown as { __speed: Speed }).__speed = speed;
    addEventListener('pointermove', (event) => (speed.lastMove = event.timeStamp), { capture: true });
    const queue = (globalThis as unknown as { GPUQueue?: { prototype: { submit: (...args: unknown[]) => unknown } } }).GPUQueue;
    if (queue) {
      const submit = queue.prototype.submit;
      queue.prototype.submit = function (this: { onSubmittedWorkDone: () => Promise<void> }, ...args: unknown[]) {
        speed.queues.add(this);
        return submit.apply(this, args);
      };
    }
    // WebGPU: the render passes a frame encodes and the pixels their first targets hold, as the engine
    // has no timing of its own per stage. A view is traced back to its texture for the size.
    type Sized = { width: number; height: number };
    const gpu = globalThis as unknown as {
      GPUTexture?: { prototype: { createView: (...args: unknown[]) => unknown } };
      GPUCommandEncoder?: { prototype: { beginRenderPass: (desc: { colorAttachments: ({ view: unknown } | null)[] }) => unknown } };
    };
    const viewTexture = new WeakMap<object, Sized>();
    if (gpu.GPUTexture && gpu.GPUCommandEncoder) {
      const createView = gpu.GPUTexture.prototype.createView;
      gpu.GPUTexture.prototype.createView = function (this: Sized, ...args: unknown[]) {
        const view = createView.apply(this, args);
        if (typeof view === 'object' && view !== null) viewTexture.set(view, this);
        return view;
      };
      const beginRenderPass = gpu.GPUCommandEncoder.prototype.beginRenderPass;
      gpu.GPUCommandEncoder.prototype.beginRenderPass = function (this: unknown, desc) {
        speed.passes += 1;
        const view = desc.colorAttachments[0]?.view;
        const texture = typeof view === 'object' && view !== null ? viewTexture.get(view) : undefined;
        if (texture) speed.pixels += texture.width * texture.height;
        return beginRenderPass.call(this, desc);
      };
    }
  });
}

/** Wraps the render counts' `screen` so the page knows when each live-view render starts. */
async function hookScreenRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const speed = (window as unknown as { __speed: { onScreen: ((at: number) => void) | null; isHooked: boolean } }).__speed;
    if (speed.isHooked) return;
    const counts = (window as unknown as { __lopsyRenderCounts?: Record<string, number> }).__lopsyRenderCounts;
    if (!counts) throw new Error('render counts are not on the window (a development build is needed)');
    let screen = counts.screen ?? 0;
    Object.defineProperty(counts, 'screen', {
      configurable: true,
      enumerable: true,
      get: () => screen,
      set: (value: number) => {
        screen = value;
        speed.onScreen?.(performance.now());
      },
    });
    speed.isHooked = true;
  });
}

/** Arms the page to time the next live-view render, then runs `act`, then answers that frame's times (null when none came). */
async function timeFrame(page: Page, act: () => Promise<void>): Promise<FrameTimes | null> {
  await page.evaluate((renderer) => {
    interface Speed {
      lastMove: number;
      queues: Set<{ onSubmittedWorkDone: () => Promise<void> }>;
      onScreen: ((at: number) => void) | null;
      frame: Promise<{ latency: number; render: number; call: number; passes: number; megapixels: number } | null>;
      passes: number;
      pixels: number;
    }
    const speed = (window as unknown as { __speed: Speed }).__speed;
    speed.frame = new Promise((resolve) => {
      const timer = setTimeout(() => {
        speed.onScreen = null;
        resolve(null);
      }, 5000);
      speed.onScreen = (renderAt: number) => {
        speed.onScreen = null;
        clearTimeout(timer);
        speed.queues.clear();
        speed.passes = 0;
        speed.pixels = 0;
        // The counter is set just before the engine's render call: this runs once that call has returned.
        void Promise.resolve().then(async () => {
          const returned = performance.now();
          const passes = speed.passes;
          const megapixels = speed.pixels / 1e6;
          if (renderer === 'wgpu') {
            await Promise.all([...speed.queues].map((q) => q.onSubmittedWorkDone()));
          } else {
            const canvas = document.querySelector('[data-testid="edit-canvas"]');
            const gl = canvas instanceof HTMLCanvasElement ? canvas.getContext('webgl2') : null;
            if (!gl) throw new Error('no WebGL context on the Edit view canvas');
            // Chromium's finish() does not wait for the GPU; a one-pixel read does. It reads whatever the
            // engine left bound, in that target's own read format, so no engine state changes.
            if (gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) !== null) throw new Error('a pixel pack buffer is bound');
            const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;
            const format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
            const pixel = type === gl.FLOAT ? new Float32Array(4) : type === gl.HALF_FLOAT ? new Uint16Array(4) : new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, format, type, pixel);
            const error = gl.getError();
            if (error !== gl.NO_ERROR) throw new Error(`the one-pixel read failed (GL error ${error})`);
          }
          const done = performance.now();
          resolve({ latency: done - speed.lastMove, render: done - renderAt, call: returned - renderAt, passes, megapixels });
        });
      };
    });
  }, suiteRenderer);
  await act();
  return page.evaluate(() => (window as unknown as { __speed: { frame: Promise<FrameTimes | null> } }).__speed.frame);
}

/** Waits until nothing renders or encodes for `quietMs`: the edit has settled. */
async function settle(page: Page, quietMs = 2500, timeout = 300_000): Promise<void> {
  const started = Date.now();
  let last = '';
  let since = Date.now();
  while (Date.now() - started < timeout) {
    const counts = await page.evaluate(() => JSON.stringify((window as unknown as { __lopsyRenderCounts?: unknown }).__lopsyRenderCounts ?? {}));
    if (counts !== last) {
      last = counts;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('the Edit view did not settle');
}

/** `changes` committed to the open photo's recipe as one History step, the way the Edit view sends its own. */
async function editRecipe(page: Page, changes: Changes, label: string): Promise<void> {
  await page.evaluate(
    async ({ changes, label }) => {
      const { useUi } = await import('/src/app/store.ts');
      const { connection, editing } = useUi.getState();
      if (!connection || !editing) throw new Error('No photo is open in the Edit view');
      connection.session.editRecipe(editing.versionId, changes, label);
    },
    { changes, label },
  );
}

/** The open photo's current values at `paths`, to put back later. */
async function recipeValues(page: Page, paths: readonly string[]): Promise<Changes> {
  return page.evaluate(async (paths) => {
    const { useUi } = await import('/src/app/store.ts');
    const { connection, editing } = useUi.getState();
    if (!connection || !editing) throw new Error('No photo is open in the Edit view');
    const recipe: unknown = connection.session.getView().versions.get(editing.versionId)?.recipe;
    const out: Record<string, unknown> = {};
    for (const path of paths) {
      let at: unknown = recipe;
      for (const key of path.split('.')) at = typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined;
      out[path] = at ?? null;
    }
    return out;
  }, paths) as Promise<Changes>;
}

async function areaIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { useUi } = await import('/src/app/store.ts');
    const { connection, editing } = useUi.getState();
    if (!connection || !editing) throw new Error('No photo is open in the Edit view');
    const areas = connection.session.getView().versions.get(editing.versionId)?.recipe.areas ?? {};
    return Object.keys(areas).sort();
  });
}

/** The Edit panel, not the Mask panel (whose selected mask has sliders of the same names). */
async function openEditPanel(page: Page): Promise<void> {
  const panel = page.getByTestId('edit-panel');
  if ((await panel.getAttribute('data-panel')) !== 'edit') await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(panel).toHaveAttribute('data-panel', 'edit');
  await expect(panel.getByRole('slider', { name: 'Exposure', exact: true })).toBeVisible();
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
}

/** Self time by function in a CDP CPU profile, the largest first. */
function hotFunctions(profile: { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] }, count = 15): { name: string; ms: number }[] {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i] ?? -1);
    if (!node) continue;
    const { functionName, url, lineNumber } = node.callFrame;
    const name = `${functionName || '(anonymous)'} ${url.replace(/^.*\//, '')}:${lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + (deltas[i] ?? 0) / 1000);
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, ms]) => ({ name, ms: round(ms) }));
}

/** For each slider, two series of `CHANGES` drag steps, each its own frame; the slider's value is put back after. */
async function frameSeries(page: Page, base: Omit<Series, 'run' | 'at'>, recipe: string): Promise<void> {
  if (!RECIPES.has(recipe)) return;
  for (const name of SLIDER_NAMES) {
    const path = SLIDERS[name];
    if (!path) throw new Error(`no recipe path for ${name}`);
    const before = await recipeValues(page, [path]);
    await sliderSeries(page, { ...base, what: `${base.what} [drag ${name}]` }, name);
    await editRecipe(page, before, 'Speed: put back');
  }
  await settle(page);
}

async function sliderSeries(page: Page, base: Omit<Series, 'run' | 'at'>, name: string): Promise<void> {
  await openEditPanel(page);
  await hookScreenRenders(page);
  const slider = page.getByTestId('edit-panel').getByRole('slider', { name, exact: true });
  await slider.scrollIntoViewIfNeeded();
  for (let run = 1; run <= 2; run++) {
    await settle(page);
    const at = now();
    // With SPEED_PARTS including profile, the first series runs under the CPU profiler (its times are then perturbed).
    const cdp = PARTS.has('profile') && run === 1 ? await page.context().newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    const box = await slider.boundingBox();
    if (!box) throw new Error(`no ${name} slider`);
    const y = box.y + box.height / 2;
    const xs = [box.x + box.width * 0.55, box.x + box.width * 0.6];
    await page.mouse.move(xs[0] ?? 0, y);
    await page.mouse.down();
    // An untimed first step: the drag has started and drawn before the timed ones.
    await page.mouse.move(xs[1] ?? 0, y);
    await page.waitForTimeout(400);
    const frames: FrameTimes[] = [];
    const misses: number[] = [];
    for (let i = 0; i < CHANGES; i++) {
      const x = xs[i % 2] ?? 0;
      const frame = await timeFrame(page, () => page.mouse.move(x, y));
      if (frame) frames.push(frame);
      else misses.push(i);
      await page.waitForTimeout(80);
    }
    await page.mouse.up();
    let hot: { name: string; ms: number }[] | null = null;
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      hot = hotFunctions(profile as unknown as { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] });
      await cdp.detach();
    }
    const latency = frames.map((f) => f.latency);
    const render = frames.map((f) => f.render);
    const call = frames.map((f) => f.call);
    record({
      ...base,
      what: hot ? `${base.what} (profiled)` : base.what,
      ...(hot ? { hot } : {}),
      run,
      at,
      unit: 'ms',
      frames: frames.length,
      misses,
      latencyMedian: round(quantile(latency, 0.5)),
      latencyP90: round(quantile(latency, 0.9)),
      renderMedian: round(quantile(render, 0.5)),
      renderP90: round(quantile(render, 0.9)),
      callMedian: round(quantile(call, 0.5)),
      callP90: round(quantile(call, 0.9)),
      passesMedian: quantile(frames.map((f) => f.passes), 0.5),
      megapixelsMedian: round(quantile(frames.map((f) => f.megapixels), 0.5)),
      latencies: latency.map(round),
    });
  }
  await settle(page);
}

/** The canvas's drawing-buffer size and the zoom readout. */
async function screenState(page: Page): Promise<{ canvas: string; zoom: string; sizes: string }> {
  const canvas = await page.getByTestId('edit-canvas').evaluate((c: HTMLCanvasElement) => `${c.width}×${c.height}`);
  const zoom = await page.getByTestId('zoom-readout').inputValue();
  const sizes = await page.evaluate(async () => {
    const { useUi } = await import('/src/app/store.ts');
    return JSON.stringify(useUi.getState().editSizes);
  });
  return { canvas, zoom, sizes };
}

/** Peak JS heap (CDP) and peak resident memory of the browser's processes (ps), sampled while `work` runs. */
async function withMemory<T>(page: Page, work: () => Promise<T>): Promise<{ result: T; heapMB: number; rssMB: number | null }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  // The browser's own process list (SystemInfo.getProcessInfo) names every process it runs: those are summed.
  const browser = page.context().browser();
  const browserCdp = browser ? await browser.newBrowserCDPSession() : null;
  let heap = 0;
  let rss: number | null = null;
  let isRunning = true;
  const sample = async () => {
    while (isRunning) {
      try {
        const { metrics } = await cdp.send('Performance.getMetrics');
        const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
        heap = Math.max(heap, used);
      } catch {
        // The page is busy encoding; the next sample reads it.
      }
      if (browserCdp) {
        try {
          const info = (await browserCdp.send('SystemInfo.getProcessInfo')) as unknown as { processInfo: { id: number }[] };
          const pids = info.processInfo.map((p) => String(p.id));
          const table = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')]).toString();
          const kb = table
            .trim()
            .split('\n')
            .reduce((sum: number, line: string) => sum + (Number(line.trim()) || 0), 0);
          rss = Math.max(rss ?? 0, kb / 1024);
        } catch {
          // A process that ended between the list and ps; the next sample reads the rest.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  const sampling = sample();
  try {
    const result = await work();
    return { result, heapMB: round(heap / 1024 / 1024), rssMB: rss === null ? null : round(rss) };
  } finally {
    isRunning = false;
    await sampling;
    await cdp.detach();
    await browserCdp?.detach();
  }
}

/** Exports the selected photo at full size and answers the wall-clock time from the click to the file. */
async function exportOnce(page: Page, format: 'jpeg' | 'tiff' | 'hdr-jpeg' | 'hdr-png'): Promise<{ ms: number; bytes: number; name: string }> {
  await page.getByRole('banner').getByRole('button', { name: /^Export 1/ }).click();
  const radio = {
    jpeg: page.getByRole('radio', { name: /^JPEG/ }),
    tiff: page.getByRole('radio', { name: /^TIFF, 16-bit/ }),
    'hdr-jpeg': page.getByRole('radio', { name: /^HDR JPEG/ }),
    'hdr-png': page.getByRole('radio', { name: /^HDR PNG/ }),
  }[format];
  await expect(radio).toBeVisible({ timeout: 30_000 });
  await radio.check();
  const size = page.getByRole('combobox', { name: 'Size' });
  if (await size.isEnabled()) await size.selectOption('original');
  const colours = page.getByRole('combobox', { name: 'Colours' });
  if ((await colours.count()) > 0) await colours.selectOption('srgb');
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const download = page.waitForEvent('download', { timeout: 900_000 });
  const started = Date.now();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const ms = Date.now() - started;
  const path = await file.path();
  const bytes = Number(execFileSync('stat', ['-f', '%z', path]).toString().trim());
  const name = file.suggestedFilename();
  await file.delete();
  await expect(page.getByText(/^Exported \d+ photos?\.$/)).toBeVisible({ timeout: 900_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  return { ms, bytes, name };
}

function search(chain: Chain): string {
  return chain === 'legacy' ? '?develop=legacy' : '';
}

async function checkPage(page: Page, chain: Chain): Promise<string> {
  const adapter = await page.evaluate(async (renderer) => {
    if (renderer === 'wgpu') {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ info?: Record<string, string> } | null> } }).gpu;
      const found = await gpu?.requestAdapter();
      const info = found?.info ?? {};
      return `WebGPU: ${info.vendor ?? ''} / ${info.architecture ?? ''} / ${info.device ?? ''} / ${info.description ?? ''}`;
    }
    return '';
  }, suiteRenderer);
  const gl = await page.evaluate(() => {
    const context = document.createElement('canvas').getContext('webgl2');
    const ext = context?.getExtension('WEBGL_debug_renderer_info');
    return `WebGL: ${ext && context ? String(context.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no renderer string'}`;
  });
  const adapterAndGl = [adapter, gl].filter((s) => s.length > 0).join('; ');
  expect(adapterAndGl.toLowerCase(), `a software adapter: ${adapterAndGl}`).not.toMatch(/swiftshader|llvmpipe|software|basic render/);
  const engine = await page.evaluate(() => window.__photonamousEngine ? { renderer: window.__photonamousEngine.rendererName(), isWorkingSpace: window.__photonamousEngine.isWorkingSpace } : null);
  if (engine) {
    expect(engine.renderer).toBe(suiteRenderer);
    expect(engine.isWorkingSpace).toBe(chain === 'linear');
  }
  return adapterAndGl;
}

test.describe('Edit speed on the real GPU', () => {
  test.skip(!isHardwareGpu, 'Set PHOTONAMOUS_GPU=hardware to measure on the machine’s GPU');
  test.skip(!samples || !SAMPLES.every((s) => existsSync(join(samples, s))), 'Set LOPSY_RAF_SAMPLES to a directory holding the samples');
  test.setTimeout(90 * 60_000);

  for (const chain of CHAINS) {
    test(`${chain} chain`, async ({ page }) => {
      const dir = samples ?? '';
      await instrument(page);
      page.on('pageerror', (error) => console.log(`Page error: ${error.message}`));
      const base = { renderer: suiteRenderer, chain };

      if (PARTS.has('load')) {
        for (const sample of SAMPLES) {
          for (let run = 1; run <= 2; run++) {
            await page.goto(`/edit-harness.html${search(chain)}`);
            await expect(page.getByTestId('harness-file')).toBeAttached();
            const at = now();
            const started = Date.now();
            await page.getByTestId('harness-file').setInputFiles(join(dir, sample));
            await waitForReady(page, 300_000);
            const firstMs = Date.now() - started;
            const adapter = await checkPage(page, chain);
            const fullStarted = Date.now();
            await page.getByRole('button', { name: 'Full', exact: true }).click();
            await expect(page.getByTestId('loading-badge')).toHaveText('Loading full resolution…', { timeout: 30_000 });
            await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 10 * 60_000 });
            const fullMs = Date.now() - fullStarted;
            record({ ...base, sample, what: 'load', run, at, unit: 'ms', firstPicture: firstMs, fullAfterFull: fullMs, fullFromChoose: firstMs + fullMs, adapter, ...(await screenState(page)) });
          }
        }
      }

      if (!PARTS.has('frames') && !PARTS.has('zoom') && !PARTS.has('export')) return;

      await page.goto(`/${search(chain)}`);
      await page.getByRole('button', { name: /This browser/ }).click();
      await expect(page.getByText('Your library is empty')).toBeVisible();
      await page.getByRole('button', { name: /Import photos/ }).first().click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('menuitem', { name: /Choose photos/ }).click();
      await (await chooser).setFiles(SAMPLES.map((s) => join(dir, s)));
      await page.getByRole('button', { name: new RegExp(`^Import ${SAMPLES.length} photo`) }).click();
      await expect(toast(page, new RegExp(`^Imported ${SAMPLES.length} photo`))).toBeVisible({ timeout: 900_000 });
      await page.getByRole('button', { name: /^All photos/ }).click();
      await expect(tiles(page)).toHaveCount(SAMPLES.length, { timeout: 60_000 });

      const assetOf = (fileName: string) =>
        page.evaluate(async (fileName) => {
          const { useUi } = await import('/src/app/store.ts');
          const connection = useUi.getState().connection;
          if (!connection) throw new Error('no library');
          for (const asset of connection.session.getView().assets.values()) if (asset.fileName === fileName) return asset.id;
          throw new Error(`no asset for ${fileName}`);
        }, fileName);

      const openInEdit = async (sample: string) => {
        await page.locator(`[data-asset-id="${await assetOf(sample)}"]`).click();
        await page.keyboard.press('Enter');
        await waitForReady(page, 300_000);
        await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 300_000 });
      };
      const leaveEdit = async () => {
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('edit-view')).toHaveCount(0);
      };

      for (const sample of SAMPLES) {
        const heavyPaths = Object.keys(HEAVY);
        const tonePaths = Object.keys(TONE);
        let original: Changes | null = null;
        if (PARTS.has('frames') || PARTS.has('zoom')) {
          await openInEdit(sample);
          const adapter = await checkPage(page, chain);
          original = await recipeValues(page, [...tonePaths, ...heavyPaths]);
          if (PARTS.has('frames')) {
            await frameSeries(page, { ...base, sample, what: 'frame (a) defaults', adapter, ...(await screenState(page)) }, 'a');
            await editRecipe(page, TONE, 'Speed: tone');
            await frameSeries(page, { ...base, sample, what: 'frame (b) tone', ...(await screenState(page)) }, 'b');
            await editRecipe(page, HEAVY, 'Speed: heavy');
            await frameSeries(page, { ...base, sample, what: 'frame (c) heavy', ...(await screenState(page)) }, 'c');
            // (d): two masks, the second with colour grading and local contrast of its own.
            await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Mask', exact: true }).click();
            await newMask(page, 'Linear');
            await newMask(page, 'Radial');
            const [first, second] = await areaIds(page);
            if (!first || !second) throw new Error('the masks were not made');
            await editRecipe(
              page,
              {
                [`areas.${first}.adjustments.exposure`]: -0.5,
                [`areas.${first}.adjustments.contrast`]: 15,
                [`areas.${second}.adjustments.exposure`]: 0.4,
                [`areas.${second}.adjustments.saturation`]: 10,
                [`areas.${second}.fx.colorGrading.midtones.hue`]: 30,
                [`areas.${second}.fx.colorGrading.midtones.saturation`]: 20,
                [`areas.${second}.fx.localContrast.large`]: 25,
                [`areas.${second}.fx.localContrast.small`]: 20,
              },
              'Speed: masks',
            );
            await frameSeries(page, { ...base, sample, what: 'frame (d) heavy + 2 masks', masks: [first, second], ...(await screenState(page)) }, 'd');
            await editRecipe(page, { [`areas.${first}.deleted`]: true, [`areas.${second}.deleted`]: true }, 'Speed: no masks');
            expect(await areaIds(page)).toEqual([]);
          } else {
            await editRecipe(page, { ...TONE, ...HEAVY }, 'Speed: heavy');
          }

          if (PARTS.has('zoom')) {
            await openEditPanel(page);
            await settle(page);
            const started = Date.now();
            await page.getByRole('button', { name: 'Full', exact: true }).click();
            await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
            await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 10 * 60_000 });
            const fullMs = Date.now() - started;
            await frameSeries(page, { ...base, sample, what: 'frame 100% (c) heavy', fullAfterFull: fullMs, ...(await screenState(page)) }, 'c');
            const back: Changes = {};
            for (const path of heavyPaths) back[path] = original[path] ?? null;
            await editRecipe(page, back, 'Speed: tone only');
            await frameSeries(page, { ...base, sample, what: 'frame 100% (b) tone', ...(await screenState(page)) }, 'b');
            await editRecipe(page, HEAVY, 'Speed: heavy');
          }
          await settle(page);
          await leaveEdit();
        }

        if (PARTS.has('export') && EXPORT_SAMPLES.includes(sample)) {
          if (!original) {
            await openInEdit(sample);
            await editRecipe(page, { ...TONE, ...HEAVY }, 'Speed: heavy');
            await settle(page);
            await leaveEdit();
          }
          await page.locator(`[data-asset-id="${await assetOf(sample)}"]`).click();
          const formats = chain === 'linear' ? (['jpeg', 'tiff', 'hdr-jpeg', 'hdr-png'] as const) : (['jpeg', 'tiff'] as const);
          for (const format of formats) {
            for (let run = 1; run <= 2; run++) {
              const at = now();
              // With SPEED_PARTS including profile, each format's first export runs under the CPU profiler.
              const cdp = PARTS.has('profile') && run === 1 ? await page.context().newCDPSession(page) : null;
              if (cdp) {
                await cdp.send('Profiler.enable');
                await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
                await cdp.send('Profiler.start');
              }
              const { result, heapMB, rssMB } = await withMemory(page, () => exportOnce(page, format));
              let hot: { name: string; ms: number }[] | null = null;
              if (cdp) {
                const { profile } = await cdp.send('Profiler.stop');
                hot = hotFunctions(profile as unknown as { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] }, 20);
                await cdp.detach();
              }
              record({ ...base, sample, what: `export ${format} (c)${hot ? ' (profiled)' : ''}`, run, at, unit: 'ms', ms: result.ms, bytes: result.bytes, file: result.name, peakHeapMB: heapMB, peakRssMB: rssMB, ...(hot ? { hot } : {}) });
            }
          }
        }
      }
    });
  }
});
