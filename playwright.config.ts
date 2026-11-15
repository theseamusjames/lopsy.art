import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `reuseExistingServer` only checks that *something* listens on the port, not
 * which checkout is behind it. On a fixed port, a dev server left running in
 * another worktree gets silently reused and the whole suite runs against that
 * checkout's code — reporting passes for code it never loaded. Deriving the
 * default from this checkout's path keeps worktrees on separate ports.
 *
 * Reuse within a checkout stays safe: vite serves current disk content, so a
 * warm server always tracks the working tree.
 */
const checkoutRoot = dirname(fileURLToPath(import.meta.url));
const portOffset = createHash('sha256').update(checkoutRoot).digest().readUInt16BE(0) % 1000;
const port = Number(process.env.VITE_PORT ?? 41000 + portOffset);

/**
 * `LOPSY_RENDERER=wgpu` runs the suite on the wgpu build of the engine: the
 * dev server loads it for every page (scripts/vite-plugin-renderer.ts), and
 * headless Chromium needs a flag to offer WebGPU.
 *
 * `LOPSY_GPU=hardware` runs on the machine's GPU instead of SwiftShader, for
 * the specs that measure it (`brush-perf-6k`). The default headless shell has
 * no GPU; the full Chromium binary does.
 */
const isWgpu = process.env.LOPSY_RENDERER === 'wgpu';
const isHardwareGpu = process.env.LOPSY_GPU === 'hardware';
const gpuArgs = isHardwareGpu
  ? ['--ignore-gpu-blocklist', '--enable-gpu', ...(isWgpu ? ['--enable-unsafe-webgpu'] : [])]
  : [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--enable-webgl2-compute-context',
      '--ignore-gpu-blocklist',
      ...(isWgpu ? ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] : []),
    ];

export default defineConfig({
  testDir: './e2e',
  timeout: 600000,
  workers: 2,
  retries: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(isHardwareGpu ? { channel: 'chromium' } : {}),
        launchOptions: { args: gpuArgs },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          // Headless Firefox on Linux reports `pointer: none` and no hover,
          // so mouse-only UI (the blog gallery arrows) never shows. Declare
          // a fine, hovering pointer like a desktop with a mouse.
          firefoxUserPrefs: {
            'ui.primaryPointerCapabilities': 6,
            'ui.allPointerCapabilities': 6,
          },
        },
      },
    },
    {
      name: 'mobile-chrome',
      testMatch: /mobile[-\w]*\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        launchOptions: { args: gpuArgs },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port}`,
    port,
    // Never adopt a server we did not start: if something else holds the port,
    // it is not this checkout's build, and reusing it would test the wrong
    // code. Failing to start is the loud, correct outcome.
    reuseExistingServer: false,
  },
});
