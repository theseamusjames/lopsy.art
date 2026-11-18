/**
 * Grade in Lopsy Photos, Lopsy's side (spec 6.12, "Grade a layer").
 *
 * A stand-in Photos page is served with `context.route` at the Photos URL
 * this build is configured with (playwright.photos.config.ts). It plays the
 * Photos side of the grade by hand: it says ready, records the layer it is
 * sent, and answers either Done (a red PNG of the layer's size and a recipe)
 * or Cancel.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { createDocument, getPixelAt, waitForStore } from './helpers';

const PHOTOS_ORIGIN = 'http://localhost:5174';

type Mode = 'done' | 'cancel';

const gradePage = (lopsyOrigin: string, mode: Mode): string => `<!doctype html><meta charset="utf-8"><title>Photos grade stand-in</title><body>
<script>
window.__received = null;
const id = new URLSearchParams(location.search).get('grade');
const lopsyOrigin = ${JSON.stringify(lopsyOrigin)};
window.addEventListener('message', async (e) => {
  if (e.origin !== lopsyOrigin || e.source !== window.opener) return;
  const m = e.data;
  if (m.type !== 'lopsy:grade' || m.id !== id) return;
  const head = new DataView(m.layer.pixels);
  window.__received = {
    name: m.layer.name,
    width: m.layer.width,
    height: m.layer.height,
    byteLength: m.layer.pixels.byteLength,
    fullW: head.getInt32(16, true),
    fullH: head.getInt32(20, true),
  };
  if (${JSON.stringify(mode)} === 'cancel') {
    window.opener.postMessage({ protocol: 1, type: 'photos:graded', id, ok: false, cancelled: true }, lopsyOrigin);
    return;
  }
  const canvas = new OffscreenCanvas(m.layer.width, m.layer.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, m.layer.width, m.layer.height);
  const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  window.opener.postMessage(
    { protocol: 1, type: 'photos:graded', id, ok: true, png, recipe: { tone: { exposure: 0.5 } } },
    lopsyOrigin,
    [png],
  );
});
window.opener.postMessage({ protocol: 1, type: 'photos:ready', id }, lopsyOrigin);
</script>`;

async function serveGradePage(context: BrowserContext, lopsyOrigin: string, mode: Mode): Promise<void> {
  await context.unroute(`${PHOTOS_ORIGIN}/**`).catch(() => {});
  await context.route(`${PHOTOS_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: gradePage(lopsyOrigin, mode) }),
  );
}

async function backgroundId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; name: string }> } };
    };
    return store.getState().document.layers.find((l) => l.name === 'Background')!.id;
  });
}

async function layerState(page: Page, id: string): Promise<{ gradeRecipe?: unknown; undo: number; label: string | null }> {
  return page.evaluate((layerId) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; gradeRecipe?: unknown }> };
        undoStack: Array<{ label?: string }>;
      };
    };
    const s = store.getState();
    const layer = s.document.layers.find((l) => l.id === layerId);
    return { gradeRecipe: layer?.gradeRecipe, undo: s.undoStack.length, label: s.undoStack.at(-1)?.label ?? null };
  }, id);
}

test.describe('Grade in Lopsy Photos', () => {
  test('grading a layer replaces its pixels as one undoable step and keeps the recipe', async ({ page, context, baseURL }) => {
    await serveGradePage(context, new URL(baseURL!).origin, 'done');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 80, false);
    const bgId = await backgroundId(page);
    expect(await getPixelAt(page, 10, 10, bgId)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 });
    const before = await layerState(page, bgId);

    // The Layer menu offers it too.
    await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Layer', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Grade in Lopsy Photos…' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator(`[data-layer-id="${bgId}"]`).click({ button: 'right' });
    const [photos] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Grade in Lopsy Photos…' }).click(),
    ]);
    await photos.waitForURL(/grade=/);
    await expect.poll(() => photos.evaluate(() => (window as unknown as { __received: unknown }).__received)).not.toBeNull();
    const received = await photos.evaluate(() => (window as unknown as { __received: Record<string, number | string> }).__received);
    expect(received).toMatchObject({ name: 'Background', width: 120, height: 80, fullW: 120, fullH: 80 });

    // Done came back: the layer is the graded (red) pixels, as one history step.
    await expect.poll(() => getPixelAt(page, 10, 10, bgId), { timeout: 30_000 }).toMatchObject({ r: 255, g: 0, b: 0 });
    const after = await layerState(page, bgId);
    expect(after.undo).toBe(before.undo + 1);
    expect(after.label).toBe('Grade in Lopsy Photos');
    expect(after.gradeRecipe).toEqual({ tone: { exposure: 0.5 } });
    await page.screenshot({ path: 'e2e/screenshots/photos-grade-done.png' });

    // Undo restores the original pixels and drops the recipe.
    await page.locator('[data-testid="canvas-container"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect.poll(() => getPixelAt(page, 10, 10, bgId)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect((await layerState(page, bgId)).gradeRecipe).toBeUndefined();
  });

  test('Cancel leaves the layer and history alone', async ({ page, context, baseURL }) => {
    await serveGradePage(context, new URL(baseURL!).origin, 'cancel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 64, 48, false);
    const bgId = await backgroundId(page);
    const before = await layerState(page, bgId);

    await page.locator(`[data-layer-id="${bgId}"]`).click({ button: 'right' });
    const [photos] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Grade in Lopsy Photos…' }).click(),
    ]);
    await expect.poll(() => photos.evaluate(() => (window as unknown as { __received: unknown }).__received)).not.toBeNull();
    await page.waitForTimeout(1000);
    expect(await getPixelAt(page, 10, 10, bgId)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(await layerState(page, bgId)).toEqual(before);
  });
});
