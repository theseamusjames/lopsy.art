/**
 * The renderer the suite runs on, and the Chromium arguments for it, as
 * lopsy-web's e2e/gpu-args.ts has them for Lopsy.
 *
 * `PHOTONAMOUS_RENDERER` is `wgpu` (WebGPU, the app's default and the
 * suite's) or `webgl`. The dev server reads the same variable for the
 * default it builds the page with (vite.config.ts), so every page runs that
 * build; `renderer.spec.ts` checks that it does. Headless Chromium has no
 * GPU: WebGL runs on SwiftShader through ANGLE, and WebGPU needs flags to be
 * offered there, also on SwiftShader.
 */
export type SuiteRenderer = 'wgpu' | 'webgl';

/**
 * The browser engine the suite runs in: `PHOTONAMOUS_BROWSER` is
 * `chromium` (the default), `firefox` or `webkit`, Playwright's own builds
 * of each. Chromium's flags below are for Chromium only; the other two are
 * launched with the options in `engineLaunchOptions`.
 */
export type SuiteBrowser = 'chromium' | 'firefox' | 'webkit';

function parseBrowser(value: string | undefined): SuiteBrowser {
  if (value === undefined || value === '' || value === 'chromium') return 'chromium';
  if (value === 'firefox' || value === 'webkit') return value;
  throw new Error(`PHOTONAMOUS_BROWSER must be chromium, firefox or webkit, not ${value}`);
}

export const suiteBrowser: SuiteBrowser = parseBrowser(process.env.PHOTONAMOUS_BROWSER);

/** Whether the suite runs in Chromium, for the specs that drive Chromium-only flags or CDP. */
export const isChromium = suiteBrowser === 'chromium';

/**
 * The build the pages run. In Chromium, the one PHOTONAMOUS_RENDERER names
 * (WebGPU by default, through the flags below). Playwright's Firefox and
 * WebKit hand out no WebGPU adapter (Firefox's `requestAdapter` answers
 * "WebGPU is disabled by blocklist" on macOS, and its blocklist preferences
 * do not change that; Playwright's WebKit has no `navigator.gpu`), so the
 * app falls back to WebGL there, as it would for a person whose browser
 * has none, and the suite expects WebGL.
 */
export const suiteRenderer: SuiteRenderer =
  suiteBrowser === 'chromium' && process.env.PHOTONAMOUS_RENDERER !== 'webgl' ? 'wgpu' : 'webgl';

if (suiteBrowser !== 'chromium' && process.env.PHOTONAMOUS_RENDERER === 'wgpu') {
  throw new Error(`Playwright’s ${suiteBrowser} offers no WebGPU adapter: run it without PHOTONAMOUS_RENDERER=wgpu`);
}

/**
 * `PHOTONAMOUS_GPU=hardware` runs on the machine's GPU instead of
 * SwiftShader (`hardwareGpuArgs`, and the full Chromium binary, which has
 * one: the headless shell does not), for the specs that measure it
 * (`edit-speed.spec.ts`). Those specs skip themselves without it.
 */
export const isHardwareGpu = process.env.PHOTONAMOUS_GPU === 'hardware';

/**
 * The environment a dev server or build for this suite is started with.
 * Outside Chromium the server keeps the production default (WebGPU) unless
 * WebGL is asked for, so the page probes for an adapter and falls back as
 * it does for that browser's users.
 */
export const rendererEnv = {
  PHOTONAMOUS_RENDERER: suiteBrowser === 'chromium' || process.env.PHOTONAMOUS_RENDERER === 'webgl' ? suiteRenderer : 'wgpu',
};

/**
 * Firefox's preferences for the suite. Headless Firefox can report
 * `pointer: none` and no hover (Lopsy's config has the same fix), so the
 * pointer is declared fine and hovering, like a desktop with a mouse.
 * WebGL needs nothing: headless Firefox draws on the machine's GPU.
 */
export const firefoxUserPrefs: Record<string, number> = {
  'ui.primaryPointerCapabilities': 6,
  'ui.allPointerCapabilities': 6,
};

const webgpuArgs = ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'];

/** Headless, on SwiftShader. */
export const gpuArgs: string[] = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--enable-webgl2-compute-context',
  '--ignore-gpu-blocklist',
  ...(suiteRenderer === 'wgpu' ? webgpuArgs : []),
];

/** On the machine's GPU (the demo reel, recorded on macOS through Metal). */
export const hardwareGpuArgs: string[] = [
  '--use-angle=metal',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  ...(suiteRenderer === 'wgpu' ? ['--enable-unsafe-webgpu'] : []),
];
