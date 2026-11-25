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

/**
 * LOPSY_PREVIEW=1 (npm run test:e2e:preview, which builds first) also serves
 * the production build with `vite preview` and adds the `preview` project,
 * which runs e2e/build-preview.spec.ts against it: the production build's
 * window.lopsy, without the dev hooks, exists for real only there. Without
 * it the config has no preview server or project.
 */
const isPreview = process.env.LOPSY_PREVIEW === '1';
const previewPort = port + 1000;

const devServer = {
  command: `npx vite --port ${port}`,
  port,
  // Never adopt a server we did not start: if something else holds the port,
  // it is not this checkout's build, and reusing it would test the wrong
  // code. Failing to start is the loud, correct outcome.
  reuseExistingServer: false,
};

const chromium = {
  ...devices['Desktop Chrome'],
  ...(isHardwareGpu ? { channel: 'chromium' } : {}),
  launchOptions: { args: gpuArgs },
};

const PREVIEW_SPEC = /build-preview\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  // Needs a build that names Photonamous' URL; it runs under playwright.photos.config.ts.
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
      testIgnore: PREVIEW_SPEC,
      use: chromium,
    },
    {
      name: 'firefox',
      // The command-API specs test the commands, not the browser: one engine is enough.
      testIgnore: [/e2e[\\/]api[\\/]/, PREVIEW_SPEC],
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
    ...(isPreview
      ? [{
          name: 'preview',
          testMatch: PREVIEW_SPEC,
          use: { ...chromium, baseURL: `http://localhost:${previewPort}` },
        }]
      : []),
  ],
  webServer: isPreview
    ? [devServer, { command: `npx vite preview --port ${previewPort} --strictPort`, port: previewPort, reuseExistingServer: false }]
    : devServer,
});
