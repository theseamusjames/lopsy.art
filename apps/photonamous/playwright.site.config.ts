import { defineConfig, devices } from '@playwright/test';
import { chromiumExecutable, withEditSectionsOpen } from './playwright.config';
import { gpuArgs } from './e2e/gpu-args';

/**
 * Photonamous' production build at `/` on its own origin, as on
 * photonamous.com, served from apps/photonamous/dist by
 * scripts/serve-site.mjs the way Cloudflare Pages serves it (`_headers`,
 * `_redirects`): site.spec.ts and offline.spec.ts. `npm run test:e2e:site`
 * builds, runs and cleans up. The build's default renderer is
 * PHOTONAMOUS_RENDERER's when it was built (WebGPU without it); the browser
 * is launched with the flags for the same one (e2e/gpu-args.ts).
 */
const port = Number(process.env.SITE_PORT ?? 4180);

export default defineConfig({
  testDir: './e2e',
  testMatch: ['site.spec.ts', 'offline.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, storageState: withEditSectionsOpen(`http://127.0.0.1:${port}`) },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: gpuArgs,
          executablePath: chromiumExecutable(),
        },
      },
    },
  ],
  webServer: {
    command: `node ../../scripts/serve-site.mjs --dir apps/photonamous/dist --port ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
