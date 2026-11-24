import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';
import { gpuArgs, suiteRenderer } from './gpu-args';
import { axeViolations } from './axe';

/**
 * The HDR canvas (src/engine/develop-engine.ts `setCanvasSpace`): on
 * WebGPU, while the display reports high dynamic range, the Edit view asks
 * for an HDR canvas, the status bar says HDR, and its switch turns the HDR
 * view on and off. Chromium's --force-color-profile=hdr10 makes
 * `(dynamic-range: high)` match headless; it cannot show what a person sees
 * on a real HDR display.
 */
test.use({ launchOptions: { args: [...gpuArgs, '--force-color-profile=hdr10'] } });

async function openInEdit(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 200, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const tile = page.locator('[role="gridcell"][title="harbour.jpg"]');
  await tile.hover();
  await tile.getByRole('button', { name: /^Edit / }).click();
  await expect(page.getByTestId('status-photo-size')).toBeVisible({ timeout: 60_000 });
}

test('an HDR display: the status bar says HDR on WebGPU, with the switch; nothing on WebGL', async ({ page }) => {
  test.setTimeout(180_000);
  await openInEdit(page);
  expect(await page.evaluate(() => matchMedia('(dynamic-range: high)').matches)).toBe(true);
  const configured = await page.getByTestId('edit-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gpu = canvas.getContext('webgpu') as unknown as { getConfiguration?: () => { format?: string; toneMapping?: { mode?: string } } | null } | null;
    const config = gpu?.getConfiguration?.();
    return { format: config?.format ?? null, toneMapping: config?.toneMapping?.mode ?? null };
  });
  const hdr = page.getByTestId('status-hdr');
  if (suiteRenderer === 'webgl') {
    expect(configured.format).toBeNull();
    // WebGL's canvas is 8 bits: no HDR, and no switch.
    await expect(page.getByTestId('status-display')).toBeVisible();
    await expect(hdr).toHaveCount(0);
    await expect(page.getByTestId('status-hdr-view')).toHaveCount(0);
    return;
  }
  // The engine configured the canvas for HDR, and screenIsHdr said so.
  expect(configured).toEqual({ format: 'rgba16float', toneMapping: 'extended' });
  await expect(hdr).toHaveText('Dynamic range: HDR');
  const toggle = page.getByRole('button', { name: /^Show highlights in HDR/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // The Edit view with the HDR label and switch passes axe-core (WCAG 2.2 AA), as every view does (accessibility.spec.ts).
  expect(await axeViolations(page)).toEqual([]);
  const box = await toggle.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  // The HDR view on: the histogram draws the HDR rendering with white marked.
  const histogram = page.getByTestId('histogram');
  await expect(histogram).toHaveAttribute('data-hdr', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('histogram-white')).toHaveCount(1);
  await expect(histogram.getByRole('img')).toHaveAccessibleName(/^HDR histogram, white marked at 55 % of the width/);

  // From the keyboard: off shows the ordinary screen's rendering, and the ordinary histogram.
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(histogram).not.toHaveAttribute('data-hdr', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('histogram-white')).toHaveCount(0);
  await expect(histogram.getByRole('img')).toHaveAccessibleName(/^Histogram: /);

  // Space turns it back on, as on any button.
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(histogram).toHaveAttribute('data-hdr', 'true', { timeout: 30_000 });
});
