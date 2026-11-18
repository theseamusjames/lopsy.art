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
import { createDocument, getPixelAt, moveLayerTo, waitForStore } from './helpers';

const PHOTOS_ORIGIN = 'http://localhost:5174';

type Mode = 'done' | 'cancel' | 'huge' | 'manual';

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
  if (${JSON.stringify(mode)} === 'huge') {
    // A tiny PNG whose header claims 20000 x 20000: decoding it would need gigabytes.
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(png.buffer);
    view.setUint32(16, 20000);
    view.setUint32(20, 20000);
    png[24] = 16;
    png[25] = 6;
    window.opener.postMessage({ protocol: 1, type: 'photos:graded', id, ok: true, png: png.buffer, recipe: {} }, lopsyOrigin, [png.buffer]);
    return;
  }
  if (${JSON.stringify(mode)} === 'manual') {
    // The test answers later, as a user who takes their time would.
    window.__answer = async () => {
      const canvas = new OffscreenCanvas(m.layer.width, m.layer.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, m.layer.width, m.layer.height);
      const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      window.opener.postMessage({ protocol: 1, type: 'photos:graded', id, ok: true, png, recipe: {} }, lopsyOrigin, [png]);
    };
    return;
  }
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

async function layerGeometry(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((layerId) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
    };
    const l = store.getState().document.layers.find((layer) => layer.id === layerId)!;
    return { x: l.x, y: l.y, width: l.width, height: l.height };
  }, id);
}

/** Paints a half-transparent green block on a new layer; the layer crops to it, so it is offset. */
async function offsetLayer(page: Page): Promise<string> {
  await page.locator('[aria-label="Add Layer"]').click();
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number; activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const s = store.getState();
    const id = s.document.activeLayerId;
    const data = new ImageData(s.document.width, s.document.height);
    for (let y = 30; y < 60; y++) {
      for (let x = 50; x < 90; x++) {
        const i = (y * data.width + x) * 4;
        data.data.set([0, 200, 0, 128], i);
      }
    }
    s.pushHistory('Paint');
    s.updateLayerPixelData(id, data);
    return id;
  });
}

async function gradeFromContextMenu(
  page: Page,
  context: BrowserContext,
  id: string,
): Promise<{ received: Record<string, number | string>; photos: Page }> {
  await page.locator(`[data-layer-id="${id}"]`).click({ button: 'right' });
  const [photos] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Grade in Lopsy Photos…' }).click(),
  ]);
  await expect.poll(() => photos.evaluate(() => (window as unknown as { __received: unknown }).__received)).not.toBeNull();
  const received = await photos.evaluate(() => (window as unknown as { __received: Record<string, number | string> }).__received);
  return { received, photos };
}

test.describe('Grade in Lopsy Photos, offset layers', () => {
  test('an offset layer, and one past the canvas, go over whole and come back at the same size and place', async ({ page, context, baseURL }) => {
    await serveGradePage(context, new URL(baseURL!).origin, 'done');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 120, 80, true);
    const id = await offsetLayer(page);
    const before = await layerGeometry(page, id);
    // The paint cropped the layer to its block: it sits away from the origin.
    expect(before.x).toBeGreaterThan(0);
    expect(before.y).toBeGreaterThan(0);

    const first = await gradeFromContextMenu(page, context, id);
    expect(first.received).toMatchObject({ width: before.width, height: before.height, fullW: before.width, fullH: before.height });
    await expect.poll(() => layerState(page, id).then((s) => s.label)).toBe('Grade in Lopsy Photos');
    expect(await layerGeometry(page, id)).toEqual(before);
    // The graded (red) pixels sit where the block was.
    await expect.poll(() => getPixelAt(page, before.x + 2, before.y + 2, id)).toMatchObject({ r: 255, g: 0, b: 0 });
    // Photos closes its grade tab when it is done; the stand-in leaves that to the test.
    await first.photos.close();

    // Drag the layer so it hangs off the canvas's left and top edges, then grade again.
    await moveLayerTo(page, id, -15, -10);
    const moved = await layerGeometry(page, id);
    expect(moved.x).toBeLessThan(0);
    expect(moved.y).toBeLessThan(0);
    const undoBefore = (await layerState(page, id)).undo;
    const second = await gradeFromContextMenu(page, context, id);
    expect(second.received).toMatchObject({ width: moved.width, height: moved.height, fullW: moved.width, fullH: moved.height });
    await expect.poll(() => layerState(page, id).then((s) => s.undo)).toBe(undoBefore + 1);
    expect(await layerGeometry(page, id)).toEqual(moved);
    await page.screenshot({ path: 'e2e/screenshots/photos-grade-offset.png' });
  });
});

test.describe('Grade in Lopsy Photos, untrusted results', () => {
  test('a PNG claiming a huge size is refused before the engine decodes it', async ({ page, context, baseURL }) => {
    await serveGradePage(context, new URL(baseURL!).origin, 'huge');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 64, 48, false);
    const bgId = await backgroundId(page);
    const before = await layerState(page, bgId);
    await gradeFromContextMenu(page, context, bgId);
    await expect(page.getByText(/Couldn't grade in Lopsy Photos: the graded layer is 20000 × 20000, not 64 × 48/)).toBeVisible();
    // The engine is alive and the layer untouched.
    expect(await getPixelAt(page, 10, 10, bgId)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 });
    expect(await layerState(page, bgId)).toEqual(before);
  });

  test('a layer locked while it is being graded is left alone', async ({ page, context, baseURL }) => {
    await serveGradePage(context, new URL(baseURL!).origin, 'manual');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 64, 48, false);
    const bgId = await backgroundId(page);
    const { photos } = await gradeFromContextMenu(page, context, bgId);
    await page.locator(`[data-layer-id="${bgId}"]`).getByRole('button', { name: 'Lock layer' }).click();
    const before = await layerState(page, bgId);
    await photos.evaluate(() => (window as unknown as { __answer: () => Promise<void> }).__answer());
    await expect(page.getByText(/was locked while it was being graded; it is unchanged/)).toBeVisible();
    expect(await getPixelAt(page, 10, 10, bgId)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 });
    expect(await layerState(page, bgId)).toEqual(before);
  });
});
