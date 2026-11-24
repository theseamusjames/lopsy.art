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

export const suiteRenderer: SuiteRenderer = process.env.PHOTONAMOUS_RENDERER === 'webgl' ? 'webgl' : 'wgpu';

/** The environment a dev server or build for this suite is started with. */
export const rendererEnv = { PHOTONAMOUS_RENDERER: suiteRenderer };

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
