import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';
import { clickMenu, toasts } from './surface-helpers';
import { makePngInPage, watchDialogs } from './surface-helpers-file';
import { isWgpu } from './gpu-args';

/**
 * A file Lopsy refuses or cannot open sends one `file_error` event to the
 * page's analytics (src/app/report-open-failure.ts), naming the kind of
 * failure, a general reason, the format from a fixed list and, for a size,
 * the limit: never the file's name. In production the analytics is
 * Cloudflare Zaraz, added at the edge; here a stand-in installed before the
 * page loads records the calls. The files are named like reasons and like
 * a person, so a name that leaked would show.
 */

interface Tracked {
  name: string;
  properties: unknown;
}

type AnalyticsWindow = Window & { __tracked?: Tracked[] };

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'File > Open and the start screen need the desktop layout');
  await page.addInitScript(() => {
    const tracked: Tracked[] = [];
    (window as AnalyticsWindow).__tracked = tracked;
    window.zaraz = {
      track: (name: string, properties?: Record<string, unknown>) => {
        tracked.push({ name, properties });
        return Promise.resolve();
      },
    };
  });
});

async function fileErrors(page: Page): Promise<Tracked[]> {
  const all = await page.evaluate(() => (window as AnalyticsWindow).__tracked ?? []);
  return all.filter((t) => t.name === 'file_error');
}

/** The events once they have stopped arriving: one more would arrive within the wait. */
async function settledFileErrors(page: Page, expected: number): Promise<Tracked[]> {
  await expect.poll(async () => (await fileErrors(page)).length, { timeout: 20_000 }).toBe(expected);
  await page.waitForTimeout(500);
  return fileErrors(page);
}

/** The largest document side here: the GPU's largest texture as the running engine has it, at most 16,384. */
async function documentLimit(page: Page): Promise<number> {
  const gpu = await page.evaluate(async (wgpu) => {
    if (wgpu) {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<{ limits: { maxTextureDimension2D: number } } | null> } }).gpu.requestAdapter();
      return adapter?.limits.maxTextureDimension2D ?? 0;
    }
    const gl = document.createElement('canvas').getContext('webgl2');
    const size = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return size ?? 0;
  }, isWgpu);
  expect(gpu).toBeGreaterThan(0);
  return Math.min(gpu, 16384);
}

async function openWithFileMenu(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickMenu(page, 'File', 'Open...')]);
  await chooser.setFiles(file);
}

const NAME_PARTS = /Ada|Lovelace|notes|holiday/i;

test.describe('file_error events', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an image too large for this device sends one too-large event with the limit, and nothing of its name', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200);
    watchDialogs(page, true);
    const limit = await documentLimit(page);

    const name = 'Image height exceeded 1 Ada Lovelace.png';
    await openWithFileMenu(page, { name, mimeType: 'image/png', buffer: await makePngInPage(page, limit + 8, 64, []) });
    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'e2e/screenshots/file-error-too-large.png' });

    const events = await settledFileErrors(page, 1);
    expect(events).toEqual([
      {
        name: 'file_error',
        properties: { app: 'lopsy', kind: 'too-large', reason: `Image width exceeded ${limit}`, format: 'png', count: 1, limit },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(NAME_PARTS);
    expect(JSON.stringify(events)).not.toContain(String(limit + 8));
  });

  test('a file that will not decode sends one decode-failed event, built apart from the toast that names it', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 300, 200);
    watchDialogs(page, true);

    const name = "Ada's holiday notes.png";
    await openWithFileMenu(page, { name, mimeType: 'image/png', buffer: Buffer.from('These are notes, not a PNG.\n', 'utf8') });
    await expect.poll(() => toasts(page), { timeout: 20_000 }).toEqual([`Failed to open image: ${name}`]);
    await page.screenshot({ path: 'e2e/screenshots/file-error-decode-failed.png' });

    const events = await settledFileErrors(page, 1);
    expect(events).toEqual([
      { name: 'file_error', properties: { app: 'lopsy', kind: 'decode-failed', reason: 'Image could not be decoded', format: 'png', count: 1 } },
    ]);
    expect(JSON.stringify(events)).not.toMatch(NAME_PARTS);
  });

  test('a type Lopsy does not read, opened from the start screen, sends one unsupported-type event', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    const start = page.getByRole('dialog', { name: 'New Document' });
    await expect(start).toBeVisible({ timeout: 15_000 });

    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open File…' }).click()]);
    await chooser.setFiles({ name: 'Ada Lovelace.heic', mimeType: 'image/heic', buffer: Buffer.from('not decodable here', 'utf8') });
    await expect.poll(async () => (await toasts(page)).length, { timeout: 20_000 }).toBe(1);
    expect((await toasts(page))[0]).toContain('Failed to open file');

    const events = await settledFileErrors(page, 1);
    expect(events).toEqual([
      { name: 'file_error', properties: { app: 'lopsy', kind: 'unsupported-type', reason: 'File type not supported', format: 'heic', count: 1 } },
    ]);
    expect(JSON.stringify(events)).not.toMatch(NAME_PARTS);
    await expect(start).toBeVisible();
  });
});
