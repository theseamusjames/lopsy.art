/**
 * The Chromium arguments every spec's browser is launched with. In a file
 * of its own so a spec that needs one more (`hdr-canvas`) can launch with
 * these plus its own: `test.use({ launchOptions })` replaces the list.
 *
 * `LOPSY_RENDERER=wgpu` runs the suite on the wgpu build of the engine: the
 * dev server loads it for every page (scripts/vite-plugin-renderer.ts), and
 * headless Chromium needs a flag to offer WebGPU.
 *
 * `LOPSY_GPU=hardware` runs on the machine's GPU instead of SwiftShader, for
 * the specs that measure it (`brush-perf-6k`). The default headless shell has
 * no GPU; the full Chromium binary does.
 */
export const isWgpu = process.env.LOPSY_RENDERER === 'wgpu';
export const isHardwareGpu = process.env.LOPSY_GPU === 'hardware';

export const gpuArgs: string[] = isHardwareGpu
  ? ['--ignore-gpu-blocklist', '--enable-gpu', ...(isWgpu ? ['--enable-unsafe-webgpu'] : [])]
  : [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--enable-webgl2-compute-context',
      '--ignore-gpu-blocklist',
      ...(isWgpu ? ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] : []),
    ];
