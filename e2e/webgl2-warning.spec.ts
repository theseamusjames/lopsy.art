import { test, expect } from './fixtures';

// Disable WebGL2 before the page initializes by monkey-patching getContext
// so that any call for 'webgl2' returns null — identical to what a browser
// with hardware acceleration turned off would return.
async function disableWebGL2(page: ReturnType<typeof test['info']> extends never ? never : Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error overriding overloaded native method
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl2') return null;
      // @ts-expect-error forwarding rest args
      return original.call(this, type, ...args);
    };
  });
}

test.describe('WebGL2 warning', () => {
  test('shows warning with Chrome instructions when WebGL2 is unavailable', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chrome-specific instructions test');
    await disableWebGL2(page);
    await page.goto('/');

    await expect(page.getByText('WebGL 2 is not available')).toBeVisible();
    await expect(page.getByText(/Lopsy requires WebGL 2/)).toBeVisible();
    await expect(page.getByText(/chrome:\/\/settings\/system/i)).toBeVisible();
    await expect(page.locator('[data-testid="canvas-container"]')).not.toBeVisible();
  });

  test('shows warning with Firefox instructions when WebGL2 is unavailable', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox-specific instructions test');
    await disableWebGL2(page);
    await page.goto('/');

    await expect(page.getByText('WebGL 2 is not available')).toBeVisible();
    await expect(page.getByText(/Lopsy requires WebGL 2/)).toBeVisible();
    await expect(page.getByText(/about:config/i)).toBeVisible();
    await expect(page.getByText(/webgl\.disabled/i)).toBeVisible();
    await expect(page.locator('[data-testid="canvas-container"]')).not.toBeVisible();
  });

  test('shows fallback tip for unsupported browsers', async ({ page }) => {
    await disableWebGL2(page);
    // Override user agent to something unrecognised
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'MyUnknownBrowser/1.0',
        configurable: true,
      });
    });
    await page.goto('/');

    await expect(page.getByText('WebGL 2 is not available')).toBeVisible();
    // Generic instructions should mention trying Chrome or Firefox
    await expect(page.getByText(/Chrome, Firefox, or Edge/i)).toBeVisible();
  });

  test('does not show warning when WebGL2 is available', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('WebGL 2 is not available')).not.toBeVisible();
    // New Document modal should be shown instead of the warning
    await expect(page.getByRole('heading', { name: 'New Document' })).toBeVisible();
  });
});
