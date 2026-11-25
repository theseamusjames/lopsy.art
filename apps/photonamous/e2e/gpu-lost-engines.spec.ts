import { expect, test, type Page } from './test';
import { generatedJpeg, importFiles, tiles } from './library';
import { suiteRenderer } from './gpu-args';

/**
 * The export renderer has an engine of its own beside the Edit view's
 * (src/engine/export-renderer.ts). Freeing it after its idle, or losing its
 * GPU, is that engine's business: the Edit view's engine must not take it
 * as its own loss and load the photo again.
 */

/** The export renderer releases its engine this long after its last job (DEFAULT_IDLE_MS), and a little more. */
const PAST_EXPORT_IDLE_MS = 23_000;

async function openInEdit(page: Page, lost: string[]): Promise<void> {
  page.on('console', (message) => {
    if (message.text().includes('the GPU was lost')) lost.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'engines.jpg', buffer: await generatedJpeg(page, 160, 640, 480) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('edit-view')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
}

async function exportOne(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('radio', { name: /^JPEG/ }).check();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await (await download).delete();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
}

async function expectEditViewUntouched(page: Page, lost: readonly string[]): Promise<void> {
  expect(lost).toEqual([]);
  await expect(page.getByTestId('edit-view')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByText('The graphics processor was reset')).toHaveCount(0);
}

test('the export engine freed after its idle leaves the Edit view alone', async ({ page }) => {
  test.setTimeout(120_000);
  const lost: string[] = [];
  await openInEdit(page, lost);
  await exportOne(page);
  // The export renderer frees its engine once idle; nothing else happens meanwhile.
  await page.waitForTimeout(PAST_EXPORT_IDLE_MS);
  await expectEditViewUntouched(page, lost);
});

test('the export engine losing its GPU leaves the Edit view alone', async ({ page }) => {
  test.setTimeout(150_000);
  const lost: string[] = [];
  await openInEdit(page, lost);
  // Past the idle of any engine the import started, so the export makes a new one, the last engine made.
  await page.waitForTimeout(PAST_EXPORT_IDLE_MS);
  await exportOne(page);
  expect(await page.evaluate(() => window.__photonamousEngine?.isScreen)).toBe(false);
  expect(await page.evaluate(() => window.__photonamousEngine?.loseDevice())).toBe(true);
  // The Edit view would say so in the console within a frame or two; give it time to.
  await page.waitForTimeout(3_000);
  await expectEditViewUntouched(page, lost);
  // And the next export runs on a new engine.
  await exportOne(page);
  await expectEditViewUntouched(page, lost);
});

test('an export whose GPU is lost while its read is out ends, and the next export runs', async ({ page }) => {
  test.skip(suiteRenderer !== 'wgpu', 'only a WebGPU read is ever out: a WebGL read answers in the same task');
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'large.jpg', buffer: await generatedJpeg(page, 120, 4000, 3000) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();

  // A full-size 16-bit PNG: the engine's own encoder, one long read.
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('radio', { name: /^PNG/ }).check();
  await page.getByRole('radio', { name: '16-bit', exact: true }).check();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const settled = page.waitForEvent('download', { timeout: 60_000 }).then(
    async (download) => {
      await download.delete();
      return 'downloaded';
    },
    () => 'no download',
  );
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  // Lose the export engine's device the moment one of its reads is out.
  const wasLost = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const started = performance.now();
        const look = () => {
          const engine = window.__photonamousEngine;
          if (engine && !engine.isScreen && (window.__photonamousParkedReads?.() ?? 0) > 0) {
            resolve(engine.loseDevice());
            return;
          }
          if (performance.now() - started > 60_000) resolve(false);
          else setTimeout(look, 0);
        };
        look();
      }),
  );
  expect(wasLost).toBe(true);
  // The job ends one way or the other: a file, or the dialog saying it failed. It must not wait forever.
  const outcome = await Promise.race([
    settled,
    page.getByText(/could not|failed/i).first().waitFor({ timeout: 60_000 }).then(() => 'failed'),
  ]);
  expect(['downloaded', 'failed']).toContain(outcome);

  // The next export runs on a new engine.
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('radio', { name: /^JPEG/ }).check();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const next = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await (await next).delete();
});
