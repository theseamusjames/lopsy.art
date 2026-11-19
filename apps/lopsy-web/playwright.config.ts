import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpuArgs, isHardwareGpu } from './e2e/gpu-args';

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

export default defineConfig({
  testDir: './e2e',
  // Needs a build that ships Photonamous; it runs under playwright.photos.config.ts.
  testIgnore: [/photos-(handoff|grade)\.spec\.ts$/],
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
