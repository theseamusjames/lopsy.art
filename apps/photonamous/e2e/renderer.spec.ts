import { expect, test, type Page } from '@playwright/test';
import { openFlatImage, waitForReady } from './harness';
import { suiteRenderer } from './gpu-args';

/**
 * Which build of the engine the page runs (src/engine/renderer-choice.ts),
 * and the parts of the Edit view that differ by build: the pixel readout,
 * and what happens when the GPU is lost. The rest of the suite runs on
 * whichever build PHOTONAMOUS_RENDERER names; the first test makes sure
 * that is the one it ran on.
 */

async function openFlat(page: Page, color: string, search = ''): Promise<void> {
  await page.goto(`/edit-harness.html${search}`);
  await expect(page.getByTestId('harness-file')).toBeAttached();
  await openFlatImage(page, color);
  await waitForReady(page);
}

function runningRenderer(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__photonamousEngine?.rendererName());
}

async function readoutAtCentre(page: Page): Promise<number[]> {
  const box = await page.getByTestId('edit-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 2);
  const readout = page.getByTestId('pixel-readout');
  await expect(readout).toBeVisible();
  return ((await readout.textContent()) ?? '').match(/\d+/g)?.map(Number) ?? [];
}

test('the page runs the renderer the suite was started for, and fetches only its wasm', async ({ page }) => {
  await openFlat(page, '#808080');
  expect(await runningRenderer(page)).toBe(suiteRenderer);
  const wasm = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      // `?import` is the dev server's module for a `?url` import: the file's name, not the file.
      .filter((name) => name.includes('.wasm') && !name.includes('?import')),
  );
  expect(wasm.length).toBeGreaterThan(0);
  // The dev server serves each build from its own package directory.
  const build = suiteRenderer === 'wgpu' ? '/pkg-wgpu/' : '/pkg/';
  expect(wasm.every((name) => name.includes(build))).toBe(true);
});

test('?renderer=webgl chooses WebGL for one page load', async ({ page }) => {
  await openFlat(page, '#808080', '?renderer=webgl');
  expect(await runningRenderer(page)).toBe('webgl');
});

test('?renderer=wgpu runs WebGPU where the browser has it, and WebGL with no error where it does not', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFlat(page, '#808080', '?renderer=wgpu');
  // The WebGL suite's browser is launched without WebGPU (e2e/gpu-args.ts).
  expect(await runningRenderer(page)).toBe(suiteRenderer);
  expect(errors).toEqual([]);
});

test('the pixel readout reads the photo, not the clipping warning painted over it', async ({ page }) => {
  await openFlat(page, '#ffffff');
  await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('clip-highlights').click();
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('aria-pressed', 'true');
  const [r = 0, g = 0, b = 0] = await readoutAtCentre(page);
  expect(r).toBeGreaterThan(245);
  expect(g).toBeGreaterThan(245);
  expect(b).toBeGreaterThan(245);
});

test('a lost GPU starts the engine again and loads the photo again', async ({ page }) => {
  await openFlat(page, '#3c78b4');
  const lost: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('the GPU was lost')) lost.push(message.text());
  });
  expect(await page.evaluate(() => window.__photonamousEngine?.loseDevice())).toBe(true);
  // The harness shows no toasts; the Edit view says it lost the GPU in the console.
  await expect.poll(() => lost.length).toBe(1);
  await waitForReady(page);
  expect(await runningRenderer(page)).toBe(suiteRenderer);
  const [r = 0, g = 0, b = 0] = await readoutAtCentre(page);
  expect(Math.abs(r - 0x3c)).toBeLessThan(8);
  expect(Math.abs(g - 0x78)).toBeLessThan(8);
  expect(Math.abs(b - 0xb4)).toBeLessThan(8);
});
