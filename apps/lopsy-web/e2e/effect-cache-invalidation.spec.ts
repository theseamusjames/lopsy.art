import { test, expect, type Page } from './fixtures';
import {
  addLayer, closeEffectsPanel, configureEffect, createDocument, docToScreen, moveLayerTo, selectTool,
  setActiveLayer, setEffectColor, setForegroundColor, setToolOption, waitForStore,
} from './helpers';

// The live view replays each layer's cached drop shadow / glow / stroke
// images while nothing they are built from has changed. Export never uses
// that cache, so after every kind of edit the canvas must still match a
// fresh export pixel for pixel: a stale cache shows up as an old shadow,
// glow or outline left where the layer used to be.
//
// Every comparison reads the canvas twice and checks the cache served the
// second frame, so it is the replayed images that are compared.

const DOC_W = 600;
const DOC_H = 400;

interface CacheStats {
  entries: number;
  images: number;
  bytes: number;
  budgetBytes: number;
  hits: number;
  misses: number;
}

async function cacheStats(page: Page): Promise<CacheStats> {
  const stats = await page.evaluate(() => {
    const fn = (window as unknown as { __effectCacheStats?: () => CacheStats | null }).__effectCacheStats;
    return fn ? fn() : null;
  });
  expect(stats, '__effectCacheStats is exposed in dev builds').not.toBeNull();
  return stats!;
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 6): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function fillRect(page: Page, x0: number, y0: number, x1: number, y1: number, tool = 'marquee-rect'): Promise<void> {
  await selectTool(page, tool);
  await dragDoc(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function exportPng(page: Page): Promise<number[]> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Array.from(Buffer.concat(chunks));
}

interface Comparison {
  mismatched: number;
  worst: { x: number; y: number; live: number[]; exported: number[] } | null;
  liveHits: number;
}

/**
 * Compare every document pixel of the live canvas with a fresh export. The
 * canvas is read twice; the second read must be served from the cache.
 */
async function compareLiveWithExport(page: Page, label: string): Promise<Comparison> {
  await page.evaluate(() => (window as unknown as { __readCompositedPixels: () => Promise<unknown> }).__readCompositedPixels());
  const before = await cacheStats(page);
  const png = await exportPng(page);
  const result = await page.evaluate(async ({ bytes }) => {
    const w = window as unknown as Record<string, unknown>;
    const snap = await (w.__readCompositedPixels as () => Promise<{ width: number; height: number; pixels: number[] }>)();
    const state = (w.__editorStore as {
      getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } };
    }).getState();
    // The PNG carries the document's colour profile; decode its stored
    // values as they are, the way the canvas readback reports them.
    const img = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), { colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const exported = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const ratio = snap.width / container.clientWidth;
    const cssW = snap.width / ratio;
    const cssH = snap.height / ratio;
    const { width, height } = state.document;
    let mismatched = 0;
    let worst: { x: number; y: number; live: number[]; exported: number[]; d: number } | null = null;
    for (let y = 0; y < height; y++) {
      const sy = Math.floor(((y + 0.5 - height / 2) * state.viewport.zoom + state.viewport.panY + cssH / 2) * ratio);
      for (let x = 0; x < width; x++) {
        const sx = Math.floor(((x + 0.5 - width / 2) * state.viewport.zoom + state.viewport.panX + cssW / 2) * ratio);
        const li = ((snap.height - 1 - sy) * snap.width + sx) * 4;
        const ei = (y * width + x) * 4;
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(snap.pixels[li + c]! - exported[ei + c]!));
        if (d > 2) {
          mismatched++;
          if (!worst || d > worst.d) {
            worst = {
              x, y, d,
              live: [snap.pixels[li]!, snap.pixels[li + 1]!, snap.pixels[li + 2]!],
              exported: [exported[ei]!, exported[ei + 1]!, exported[ei + 2]!],
            };
          }
        }
      }
    }
    return { mismatched, worst: worst ? { x: worst.x, y: worst.y, live: worst.live, exported: worst.exported } : null };
  }, { bytes: png });
  const after = await cacheStats(page);
  await page.screenshot({ path: `e2e/screenshots/effect-cache-${label}.png` });
  return { ...result, liveHits: after.hits - before.hits };
}

async function expectLiveMatchesExport(page: Page, label: string): Promise<void> {
  const cmp = await compareLiveWithExport(page, label);
  expect(cmp.liveHits, `${label}: the compared frame replayed cached effects`).toBeGreaterThan(0);
  expect(cmp.mismatched, `${label}: live canvas differs from export, worst ${JSON.stringify(cmp.worst)}`).toBe(0);
}

async function layerPosition(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const l = store.getState().document.layers.find((layer) => layer.id === lid)!;
    return { x: l.x, y: l.y };
  }, id);
}

/**
 * A plain blue layer to paint on, under a red square that carries a drop
 * shadow, an outer glow and an outside stroke — cached and verified.
 */
async function setUpStyledSquare(page: Page): Promise<{ plain: string; styled: string }> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC_W, DOC_H, false);
  await page.waitForSelector('[data-testid="canvas-container"]');

  const plain = await addLayer(page);
  await setForegroundColor(page, 40, 60, 220);
  await fillRect(page, 380, 60, 520, 160);

  const styled = await addLayer(page);
  await setForegroundColor(page, 220, 30, 30);
  await fillRect(page, 140, 120, 300, 260);
  await configureEffect(page, 'Drop Shadow', { 'Offset X': 24, 'Offset Y': 18, Blur: 6 });
  await setEffectColor(page, 'Shadow color', 0, 0, 0);
  await configureEffect(page, 'Outer Glow', { Size: 14 });
  await setEffectColor(page, 'Glow color', 255, 200, 0);
  await configureEffect(page, 'Stroke', { Width: 6 });
  await setEffectColor(page, 'Stroke color', 0, 200, 120);
  await page.locator('[aria-label="Stroke position: outside"]').click();
  await closeEffectsPanel(page);

  await expectLiveMatchesExport(page, 'initial');
  const settled = await cacheStats(page);
  expect(settled.entries).toBe(1);
  expect(settled.images).toBe(3);
  return { plain, styled };
}

test.describe('Live effect cache stays in step with the layer', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });
  test.describe.configure({ timeout: 300_000 });

  test('painting another layer reuses the cached effects', async ({ page }) => {
    const { plain } = await setUpStyledSquare(page);
    await setActiveLayer(page, plain);
    await setForegroundColor(page, 30, 160, 60);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 30);
    const missesBefore = (await cacheStats(page)).misses;
    await dragDoc(page, 120, 300, 560, 340, 12);
    expect((await cacheStats(page)).misses, 'no styled layer was recomputed').toBe(missesBefore);
    await expectLiveMatchesExport(page, 'brush-other-layer');
  });

  test('editing the layer\'s pixels redraws its effects', async ({ page }) => {
    const { styled } = await setUpStyledSquare(page);
    // Grow the square to the right: shadow, glow and outline follow the new edge.
    await setActiveLayer(page, styled);
    await setForegroundColor(page, 220, 30, 30);
    await fillRect(page, 290, 140, 340, 200);
    await expectLiveMatchesExport(page, 'pixels');
  });

  test('painting the layer\'s mask redraws its effects', async ({ page }) => {
    const { styled } = await setUpStyledSquare(page);
    // Hide the square's top band; the effects trace the masked edge (#977).
    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 60);
    await setToolOption(page, 'Hardness', 100);
    await dragDoc(page, 120, 140, 360, 140, 8);
    await page.locator(`[data-layer-id="${styled}"]`).click();
    await page.waitForTimeout(300);
    await expectLiveMatchesExport(page, 'mask');
  });

  test('changing an effect setting redraws it', async ({ page }) => {
    await setUpStyledSquare(page);
    await configureEffect(page, 'Drop Shadow', { 'Offset X': -30, 'Offset Y': 26 });
    await closeEffectsPanel(page);
    await expectLiveMatchesExport(page, 'effect-param');
  });

  test('changing the layer\'s opacity redraws its effects', async ({ page }) => {
    const { styled } = await setUpStyledSquare(page);
    // The shadow and outside stroke are knocked out by the layer's coverage
    // times its opacity, which only shows on partly covered pixels — so give
    // the layer an anti-aliased ellipse.
    await setActiveLayer(page, styled);
    await setForegroundColor(page, 220, 30, 30);
    await fillRect(page, 320, 200, 470, 330, 'marquee-ellipse');
    await expectLiveMatchesExport(page, 'opacity-before');
    await page.locator(`[data-layer-id="${styled}"]`).locator('button[aria-label*="Opacity"]').click();
    const opacity = page.locator('input[type="range"][aria-label*="opacity"]');
    await opacity.waitFor({ state: 'visible', timeout: 3000 });
    await opacity.fill('60');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expectLiveMatchesExport(page, 'opacity');
  });

  test('moving the layer leaves no effects behind', async ({ page }) => {
    const { styled } = await setUpStyledSquare(page);
    const before = await layerPosition(page, styled);
    await moveLayerTo(page, styled, before.x + 90, before.y + 60);
    const after = await layerPosition(page, styled);
    expect(after.x - before.x).toBeGreaterThan(40);
    await expectLiveMatchesExport(page, 'move');
  });

  test('turning the effects off frees the cached images', async ({ page }) => {
    const { styled } = await setUpStyledSquare(page);
    expect((await cacheStats(page)).bytes).toBeGreaterThan(0);
    await page.locator(`[data-layer-id="${styled}"]`).locator('button[aria-label*="effects"]').click();
    for (const name of ['Drop Shadow', 'Outer Glow', 'Stroke']) {
      const box = page.locator(`[aria-label="Enable ${name}"]`);
      await box.waitFor({ state: 'visible', timeout: 5000 });
      if (await box.isChecked()) await box.click();
    }
    await closeEffectsPanel(page);
    await page.evaluate(() => (window as unknown as { __readCompositedPixels: () => Promise<unknown> }).__readCompositedPixels());
    const cleared = await cacheStats(page);
    expect(cleared.entries).toBe(0);
    expect(cleared.bytes).toBe(0);
  });
});
