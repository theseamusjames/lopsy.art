import { test, expect } from './fixtures';
import { createDocument, waitForStore, drawRect, getPixelAt } from './helpers';

// #668: the Add Noise filter used to expose only Color vs Mono. It now
// also exposes a Distribution selector with Uniform (previous behavior)
// and Gaussian. Gaussian uses Box-Muller and produces a softer, more
// realistic sensor / film grain.

test.describe('#668 Add Noise Distribution parameter', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'filter dialogs are desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, true);
    // A flat mid-grey patch so noise is easy to measure.
    await drawRect(page, 20, 20, 160, 160, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(150);
  });

  test('dialog exposes Distribution selector with Uniform + Gaussian', async ({ page }) => {
    await page.click('text=Filter');
    await page.waitForTimeout(150);
    await page.click('text=Add Noise...');
    await page.waitForTimeout(300);

    // Locate the Distribution label rendered by FilterDialog.
    const label = page.locator('text=Distribution');
    await expect(label).toBeVisible({ timeout: 3000 });

    // The FilterDialog exposes options as buttons — verify both are present.
    await expect(page.getByRole('button', { name: 'Uniform', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gaussian', exact: true })).toBeVisible();

    // Cancel out — this test just verifies UI presence.
    await page.locator('button:has-text("Cancel")').click();
  });

  test('Gaussian distribution produces a narrower channel spread than Uniform', async ({ page }) => {
    async function applyNoise(mode: 'Uniform' | 'Gaussian') {
      await page.click('text=Filter');
      await page.waitForTimeout(150);
      await page.click('text=Add Noise...');
      await page.waitForTimeout(300);

      // Set amount to 60 so both distributions produce a clearly measurable spread.
      const sliders = page.locator('input[type="range"]');
      await sliders.first().fill('60');
      await page.waitForTimeout(50);

      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.waitForTimeout(50);
      await page.locator('button:has-text("Apply")').click();
      await page.waitForTimeout(300);
    }

    // Round 1: Uniform.
    await applyNoise('Uniform');
    const uniformSpread = await measureSpread(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Round 2: Gaussian.
    await applyNoise('Gaussian');
    const gaussianSpread = await measureSpread(page);

    // Both should have added visible noise (variance > 0).
    expect(uniformSpread.variance).toBeGreaterThan(50);
    expect(gaussianSpread.variance).toBeGreaterThan(20);

    // Gaussian noise is scaled so ±3σ fits inside the amplitude — that
    // pushes the tails past the [0,255] clamp less often than uniform
    // noise, so the observed distribution is narrower.
    expect(gaussianSpread.variance).toBeLessThan(uniformSpread.variance);
  });
});

async function measureSpread(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  // Sample a 50x50 patch inside the grey rectangle and compute the
  // variance of the red channel — a tight bell curve should have a
  // meaningfully lower spread than a flat uniform distribution.
  const samples: number[] = [];
  for (let y = 40; y < 90; y += 2) {
    for (let x = 40; x < 90; x += 2) {
      const p = await getPixelAt(page, x, y);
      samples.push(p.r);
    }
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return { mean, variance };
}
