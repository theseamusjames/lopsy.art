import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumExecutable, withEditSectionsOpen } from '../playwright.config';
import { gpuArgs, hardwareGpuArgs, isHardwareGpu, rendererEnv } from './gpu-args';

/**
 * Renders every DNG and ARW sample (and a RAF to compare) in the Edit view
 * at its defaults, for a person to look at. Not a test, and not in the
 * default run. From apps/photonamous:
 *
 *   LOPSY_ARW_SAMPLES=<dir> LOPSY_DNG_SAMPLES=<dir> LOPSY_DNG_ADOBE_SAMPLES=<dir> \
 *     LOPSY_DNG_CAMERA_SAMPLES=<dir> LOPSY_RAF_SAMPLES=<dir> \
 *     VITE_PORT=5186 npx playwright test -c e2e/raw-review.config.ts
 *
 * raw-review.record.ts says what it saves and where. WebGPU unless
 * PHOTONAMOUS_RENDERER=webgl; the machine's GPU with
 * PHOTONAMOUS_GPU=hardware, as for the suite (gpu-args.ts).
 */

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VITE_PORT ?? 5186);

export default defineConfig({
  testDir: '.',
  testMatch: 'raw-review.record.ts',
  outputDir: join(here, '../test-results/raw-review-work'),
  timeout: 10 * 60_000,
  expect: { timeout: 60_000 },
  workers: 2,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, headless: true, actionTimeout: 60_000, storageState: withEditSectionsOpen(`http://localhost:${port}`) },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        // sRGB: the Edit view then draws for an sRGB display, and the captures are sRGB.
        ...(isHardwareGpu
          ? { channel: 'chromium', launchOptions: { args: [...hardwareGpuArgs, '--force-color-profile=srgb'] } }
          : { launchOptions: { args: [...gpuArgs, '--force-color-profile=srgb'], executablePath: chromiumExecutable() } }),
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: join(here, '..'),
    port,
    env: rendererEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
