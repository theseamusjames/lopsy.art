import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEditSectionsOpen } from '../playwright.config';
import { hardwareGpuArgs, rendererEnv } from './gpu-args';

/**
 * Makes the site's social preview image (public/og-image.jpg) from the
 * app: the Edit view with the trailer's photo in its split before and
 * after. Not a test.
 * From apps/photonamous:
 *
 *   OG_RAW=<DSCF8078.RAF> VITE_PORT=5189 npx playwright test -c e2e/og-image.config.ts
 *
 * og-image.record.ts says what it does and what else it reads;
 * docs/photonamous-setup.md has the recipe. Needs Playwright's full
 * Chromium (`npx playwright install chromium`), which draws with the
 * machine's GPU: a 40 MP RAW at full size needs it. OG_WORK moves
 * Playwright's own output (default test-results/og-image-work).
 */

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VITE_PORT ?? 5189);

export default defineConfig({
  testDir: '.',
  testMatch: 'og-image.record.ts',
  outputDir: process.env.OG_WORK ?? join(here, '../test-results/og-image-work'),
  timeout: 30 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, headless: true, actionTimeout: 60_000, storageState: withEditSectionsOpen(`http://localhost:${port}`) },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        // The card's shape; og-image.record.ts sets the window it captures. Two device pixels to the CSS pixel:
        // captured at twice the card's size and scaled down, so the interface's text comes out at its natural size.
        viewport: { width: 1200, height: 630 },
        deviceScaleFactor: 2,
        // sRGB, what social sites expect: the Edit view then draws for an sRGB display, and the capture is sRGB.
        launchOptions: { args: [...hardwareGpuArgs, '--force-color-profile=srgb'] },
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
