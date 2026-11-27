/**
 * Opens each DNG and ARW sample (and one RAF, to compare) in the Edit view
 * at its default recipe and saves captures named by the sample:
 * `<stem>-picture.png`, the canvas the photo is drawn in (Fit, the working
 * image); `<stem>-edit-view.png`, the whole window; and
 * `<stem>-full-centre.png`, the canvas at 100 % (Full) on the middle of the
 * full-size picture, where the full-size bands meet. A file the app
 * refuses (the lossy DNGs) is captured with the Edit view saying why. See
 * raw-review.config.ts for how to run it.
 *
 * Output: RAW_REVIEW_OUT, by default
 * samples/linear-pipeline-review/app-renders/raw-path/ at the top of this
 * checkout (git-ignored, as all of samples/ is).
 */
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settledPreview, waitForPreview } from './harness';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.RAW_REVIEW_OUT ?? join(here, '../../../samples/linear-pipeline-review/app-renders/raw-path');

interface Sample {
  readonly dir: string | undefined;
  readonly name: string;
  /** The Edit view refuses it: captured with its message. */
  readonly isRefused?: boolean;
}

const arw = process.env.LOPSY_ARW_SAMPLES;
const proraw = process.env.LOPSY_DNG_SAMPLES;
const adobe = process.env.LOPSY_DNG_ADOBE_SAMPLES;
const raf = process.env.LOPSY_RAF_SAMPLES;

const SAMPLES: readonly Sample[] = [
  { dir: arw, name: 'ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW' },
  { dir: arw, name: 'ILCE-7M4_DSC06673_FullFrame-Raw-Uncompressed.ARW' },
  { dir: arw, name: 'ILCE-7M4_DSC06674_FullFrame-LossLess-Compressed-Large.ARW' },
  { dir: arw, name: 'ILCE-7M3_DSC0009.ARW' },
  { dir: arw, name: 'ILCE-6000_DSC01542.ARW' },
  { dir: arw, name: 'DSC-RX100M3_DSC00734.ARW' },
  { dir: adobe, name: '5D3-adobe-lossless.dng' },
  { dir: adobe, name: '5D3-adobe-uncompressed.dng' },
  { dir: adobe, name: '5D3-adobe-lossless-rgb.dng' },
  { dir: adobe, name: '5D3-adobe-uncompressed-rgb.dng' },
  { dir: adobe, name: '5D3-adobe-lossy.dng', isRefused: true },
  { dir: adobe, name: '5D3-adobe-lossy-rgb.dng', isRefused: true },
  { dir: proraw, name: 'sample_dng_00.dng' },
  { dir: proraw, name: 'sample_dng_01.dng' },
  { dir: raf, name: 'DSCF8078.RAF' },
];

for (const sample of SAMPLES) {
  test(sample.name, async ({ page }) => {
    const path = sample.dir ? join(sample.dir, sample.name) : '';
    test.skip(!sample.dir || !existsSync(path), `needs ${sample.name} in its sample directory`);
    mkdirSync(outDir, { recursive: true });
    const stem = sample.name.replace(/\.[^.]+$/, '');
    await page.goto('/edit-harness.html');
    await expect(page.getByTestId('harness-file')).toBeAttached();
    await page.getByTestId('harness-file').setInputFiles(path);
    if (sample.isRefused) {
      await expect(page.getByRole('alert')).toContainText('This photo could not be opened', { timeout: 120_000 });
      await page.screenshot({ path: join(outDir, `${stem}-edit-view.png`) });
      return;
    }
    await expect(page.getByTestId('edit-view')).toHaveAttribute('data-status', 'ready', { timeout: 5 * 60_000 });
    // The first preview: the default recipe has rendered and settled.
    await waitForPreview(page, 0, 3 * 60_000);
    await settledPreview(page, 0);
    await page.mouse.move(0, 0);
    await page.getByTestId('edit-canvas').screenshot({ path: join(outDir, `${stem}-picture.png`) });
    await page.screenshot({ path: join(outDir, `${stem}-edit-view.png`) });
    // Full: the full-size picture, at 100 % on its middle.
    await page.getByRole('button', { name: 'Full', exact: true }).click();
    await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
    await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 5 * 60_000 });
    await page.waitForTimeout(1500);
    await page.mouse.move(0, 0);
    await page.getByTestId('edit-canvas').screenshot({ path: join(outDir, `${stem}-full-centre.png`) });
  });
}
