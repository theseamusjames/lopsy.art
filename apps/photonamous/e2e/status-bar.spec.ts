import { expect, test, type Page } from '@playwright/test';
import { waitForReady } from './harness';
import { generatedJpeg, importFiles, tiles } from './library';
import { suiteRenderer } from './gpu-args';

/**
 * The status bar along the bottom of the window (src/components/AppStatusBar):
 * the library's counts or the Edit view's sizes at the left, the renderer
 * and the display at the right, on whichever build the suite runs.
 */

const RENDERER_NAMES = { wgpu: 'WebGPU', webgl: 'WebGL' } as const;

function bar(page: Page) {
  return page.getByTestId('status-bar');
}

async function openLibraryWith(page: Page, files: { name: string; width: number; height: number }[]): Promise<void> {
  await page.goto('/');
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  const made = [];
  for (const [i, f] of files.entries()) made.push({ name: f.name, buffer: await generatedJpeg(page, 40 * i, f.width, f.height) });
  await importFiles(page, made);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(files.length);
}

test('the library: photos shown and selected, the renderer and the display', async ({ page }) => {
  // Not on the start screen.
  await openLibraryWith(page, [
    { name: 'one.jpg', width: 800, height: 600 },
    { name: 'two.jpg', width: 800, height: 600 },
    { name: 'three.jpg', width: 800, height: 600 },
  ]);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('aria-label', 'Status bar');
  await expect(page.getByTestId('status-shown')).toHaveText('3 photos');
  await expect(page.getByTestId('status-selected')).toHaveCount(0);
  await tiles(page).first().click();
  await expect(page.getByTestId('status-selected')).toHaveText('1 selected');
  await tiles(page).nth(2).click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('status-selected')).toHaveText('3 selected');

  // The previews were rendered by the engine, so the build that runs is known; each item says what it is.
  await expect(page.getByTestId('status-renderer')).toHaveText(`Renderer: ${RENDERER_NAMES[suiteRenderer]}`);
  await expect(page.getByTestId('status-display')).toHaveText(/^Display: (sRGB|Display P3)$/);
  // The headless browser's display is sRGB (playwright.config.ts gives it no colour profile).
  await expect(page.getByTestId('status-display')).toHaveText('Display: sRGB');
  // The name is said, not shown.
  const name = await page.getByTestId('status-renderer').getByText('Renderer:').boundingBox();
  expect(name?.width ?? 0).toBeLessThanOrEqual(1);
});

test('the Edit view: the photo size and the working size, then full size', async ({ page }) => {
  test.setTimeout(120_000);
  await openLibraryWith(page, [{ name: 'big.jpg', width: 6000, height: 4000 }]);
  const tile = tiles(page).first();
  await tile.hover();
  await tile.getByRole('button', { name: /^Edit / }).click();
  await waitForReady(page, 60_000);
  await expect(page.getByTestId('status-shown')).toHaveCount(0);
  await expect(page.getByTestId('status-photo-size')).toHaveText('Photo size: 6000 × 4000 px');
  // A 6000 px photo is edited at a working size of at most 4096 px on its long edge (spec 6.10).
  const working = page.getByTestId('status-working-size');
  await expect(working).toHaveText(/^Editing at: \d+ × \d+ px$/);
  const [w = 0, h = 0] = ((await working.textContent()) ?? '').match(/\d+/g)?.map(Number) ?? [];
  expect(w).toBeLessThanOrEqual(4096);
  expect(Math.abs(w / h - 1.5)).toBeLessThan(0.01);
  await expect(page.getByTestId('status-renderer')).toHaveText(`Renderer: ${RENDERER_NAMES[suiteRenderer]}`);

  // 100 % loads the full resolution, and the bar says so.
  await page.getByTestId('edit-view').getByRole('button', { name: 'Full', exact: true }).click();
  await expect(working).toHaveText('Editing at: full size', { timeout: 30_000 });

  // Going back to the library brings its counts back.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-shown')).toHaveText('1 photo', { timeout: 15_000 });
});

test('at 800 px wide and at phone width the bar stays one line, under everything', async ({ page }) => {
  await openLibraryWith(page, [{ name: 'one.jpg', width: 800, height: 600 }]);
  for (const width of [800, 375]) {
    await page.setViewportSize({ width, height: 700 });
    const box = await bar(page).boundingBox();
    expect(box?.height).toBe(24);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(700);
    // The page does not scroll sideways because of it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
