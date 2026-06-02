import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.VITE_PORT ?? 5174);

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
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
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-webgl',
            '--enable-webgl2-compute-context',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
    {
      name: 'firefox',
      testIgnore: 'mobile-canvas.spec.ts',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'mobile-chrome',
      testMatch: 'mobile-canvas.spec.ts',
      use: {
        ...devices['iPhone 14'],
        defaultBrowserType: 'chromium',
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-webgl',
            '--enable-webgl2-compute-context',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port}`,
    port,
    reuseExistingServer: true,
  },
});
