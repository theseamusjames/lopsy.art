/**
 * Smoke test of the production build (the `preview` project, LOPSY_PREVIEW=1,
 * `npm run test:e2e:preview`): every other spec runs on the dev server, where
 * the dev hooks exist and the pages are not built. Here the agent page loads
 * from dist/agent/index.html with `window.lopsy` as its only API, and the
 * editor at `/` offers the same `window.lopsy`.
 */
import { test, expect, type Page } from './fixtures';

type Outcome =
  | { ok: true; result: unknown }
  | { ok: true; results: unknown[] }
  | { ok: false; error: { code: string; message: string } };

interface PreviewWindow {
  lopsy?: { describe: () => Array<{ id: string }>; run: (invocation: unknown) => Promise<Outcome> };
}

/** Dev-only hooks that src/dev-hooks.ts installs; none may exist in a production build. */
const DEV_HOOKS = ['__editorStore', '__uiStore', '__lopsyCommands', '__readLayerPixels', '__readCompositedPixels', '__engineStarted'];

async function devHooksPresent(page: Page): Promise<string[]> {
  return page.evaluate((names) => names.filter((name) => name in window), DEV_HOOKS);
}

test('the built agent page offers window.lopsy and no dev hooks, and exports the image it was asked for', async ({ page }) => {
  const response = await page.goto('/agent/');
  expect(response?.ok()).toBe(true);
  expect(await page.title()).toBe('Lopsy — Agent page');
  await page.waitForFunction(() => !!(window as unknown as PreviewWindow).lopsy);
  expect(await devHooksPresent(page)).toEqual([]);
  expect(await page.evaluate(() => typeof (window as unknown as { lopsy: unknown }).lopsy)).toBe('object');

  const ids = await page.evaluate(() => (window as unknown as PreviewWindow).lopsy!.describe().map((d) => d.id));
  expect(ids).toContain('doc.new');
  expect(ids.some((id) => id.startsWith('ui.'))).toBe(false);

  const outcome = await page.evaluate(() =>
    (window as unknown as PreviewWindow).lopsy!.run([
      { op: 'doc.new', width: 64, height: 48 },
      { op: 'color.set', foreground: '#ff0000' },
      { op: 'select.rect', x: 8, y: 8, width: 16, height: 16 },
      { op: 'paint.fill' },
      { op: 'doc.export', format: 'png' },
    ]),
  );
  if (!outcome.ok) throw new Error(`the recipe failed: ${outcome.error.code}: ${outcome.error.message}`);
  if (!('results' in outcome)) throw new Error('expected a list of results');
  const exported = outcome.results.at(-1) as { base64: string; width: number; height: number; mime: string };
  expect({ width: exported.width, height: exported.height, mime: exported.mime }).toEqual({ width: 64, height: 48, mime: 'image/png' });

  const decoded = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return { size: [bitmap.width, bitmap.height], inside: at(15, 15), outside: at(40, 30) };
  }, exported.base64);
  expect(decoded).toEqual({ size: [64, 48], inside: [255, 0, 0, 255], outside: [255, 255, 255, 255] });
  await expect(page.locator('[data-testid="canvas-container"] canvas[aria-label="Drawing canvas"]')).toBeVisible();
});

test('/agent redirects to the built page', async ({ page }) => {
  await page.goto('/agent');
  expect(new URL(page.url()).pathname).toBe('/agent/');
  await page.waitForFunction(() => !!(window as unknown as PreviewWindow).lopsy);
});

test('the built editor at / offers window.lopsy and no dev hooks, and a document made through it opens the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as PreviewWindow).lopsy);
  expect(await devHooksPresent(page)).toEqual([]);

  const ids = await page.evaluate(() => (window as unknown as PreviewWindow).lopsy!.describe().map((d) => d.id));
  expect(ids).toContain('doc.new');
  expect(ids.some((id) => id.startsWith('ui.'))).toBe(false);

  const outcome = await page.evaluate(() =>
    (window as unknown as PreviewWindow).lopsy!.run([
      { op: 'doc.new', width: 64, height: 48 },
      { op: 'layer.add' },
      { op: 'doc.info' },
    ]),
  );
  if (!outcome.ok) throw new Error(`the calls failed: ${outcome.error.code}: ${outcome.error.message}`);
  if (!('results' in outcome)) throw new Error('expected a list of results');
  const info = outcome.results.at(-1) as { history: { undo: string[] } };
  expect(info.history.undo).toEqual(['New Document', 'Add Layer']);
  await expect(page.getByRole('dialog', { name: 'New Document' })).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Application menu"]')).toBeVisible();
  await expect(page.locator('[data-layer-id]').filter({ hasText: 'Layer 2' })).toBeVisible();
});
