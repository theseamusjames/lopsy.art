/**
 * #796 — A group adjustment node (Vignette, Saturation & Vibrance, …) used
 * to hide every layer effect inside the group. The compositor redirected
 * the children's pixels into the group scratch, but their glow / shadow /
 * stroke passes still wrote to the main composite — underneath the
 * scratch, which was then blended over them. Both the live canvas and the
 * export path (compositeForExport) had the same structure.
 *
 * Also covers the secondary bug: adding an adjustment node pushed no
 * history entry, so it could not be undone.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setActiveLayer,
  selectTool,
  docToScreen,
  setForegroundColor,
  configureEffect,
  setEffectColor,
  closeEffectsPanel,
  addAdjustment,
  getRootGroupId,
  undo,
  redo,
} from './helpers';

interface Rgba { r: number; g: number; b: number; a: number }
interface PixelSnap { width: number; height: number; pixels: number[] }

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Red disc centred on (580, 230), radius 80.
const DISC = { cx: 580, cy: 230, r: 80 };

/** Composite pixels at a list of doc points, from a single readback. */
async function readCompositedAt(page: Page, points: Array<[number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const { document: doc, viewport: vp } = store.getState();
    return pts.map(([x, y]) => {
      if (!result) return { r: 0, g: 0, b: 0, a: 0 };
      const sx = Math.round((x - doc.width / 2) * vp.zoom + vp.panX + result.width / 2);
      const sy = Math.round((y - doc.height / 2) * vp.zoom + vp.panY + result.height / 2);
      const idx = ((result.height - 1 - sy) * result.width + sx) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });
  }, points);
}

/** Quick Export PNG through the File menu and decode the requested pixels. */
async function exportPixelsAt(page: Page, points: Array<[number, number]>): Promise<Rgba[]> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('menuitem', { name: 'Quick Export PNG' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const png = Buffer.concat(chunks);
  PNG_MAGIC.forEach((byte, i) => expect(png[i]).toBe(byte));

  return page.evaluate(async ({ bytes, pts }) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return pts.map(([x, y]) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! };
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }, { bytes: Array.from(png), pts: points });
}

async function readLayerRow(page: Page, layerId: string): Promise<PixelSnap> {
  const snap = await page.evaluate((lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<PixelSnap | null>;
    return fn(lid);
  }, layerId);
  return snap ?? { width: 0, height: 0, pixels: [] };
}

async function groupAdjustmentCount(page: Page, groupId: string): Promise<number> {
  return page.evaluate((gid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; adjustments?: unknown[] }> } };
    };
    const group = store.getState().document.layers.find((l) => l.id === gid);
    return group?.adjustments?.length ?? -1;
  }, groupId);
}

async function lastHistoryLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label ?? null;
  });
}

async function documentWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { width: number } };
    };
    return store.getState().document.width;
  });
}

async function drawRedDiscWithGlowAndStroke(page: Page): Promise<string> {
  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);

  await selectTool(page, 'marquee-ellipse');
  const a = await docToScreen(page, DISC.cx - DISC.r, DISC.cy - DISC.r);
  const b = await docToScreen(page, DISC.cx + DISC.r, DISC.cy + DISC.r);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  await setForegroundColor(page, 0xe0, 0x20, 0x40);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);

  await configureEffect(page, 'Outer Glow', { Size: 40, Spread: 10, Opacity: 100 });
  await setEffectColor(page, 'Glow color', 255, 255, 0);
  await configureEffect(page, 'Stroke', { Width: 6 });
  await setEffectColor(page, 'Stroke color', 0, 0, 255);
  await closeEffectsPanel(page);
  await page.waitForTimeout(200);
  return layerId;
}

/**
 * Find the stroke ring and the glow halo on the disc's horizontal radius to
 * the right, from the effect-free layer texture (the disc edge) plus the
 * composite (where blue and yellow actually landed).
 */
async function locateEffects(page: Page, layerId: string): Promise<{ stroke: [number, number]; glow: [number, number] }> {
  const layer = await readLayerRow(page, layerId);
  expect(layer.width).toBeGreaterThan(0);
  const xs = Array.from({ length: 60 }, (_, i) => DISC.cx + DISC.r - 10 + i);
  const row = await readCompositedAt(page, xs.map((x) => [x, DISC.cy] as [number, number]));
  let strokeX = -1;
  let bluest = -Infinity;
  row.forEach((p, i) => {
    const blueness = p.b - Math.max(p.r, p.g);
    if (blueness > bluest) {
      bluest = blueness;
      strokeX = xs[i]!;
    }
  });
  // Glow: just outside the 6px stroke ring, the yellow halo over the white
  // background — full red and green, blue pulled well below 255.
  const glowIdx = row.findIndex((p, i) => xs[i]! >= strokeX + 6 && p.r > 240 && p.g > 240 && p.b < 215);
  expect(bluest, 'stroke ring must be visible before any adjustment').toBeGreaterThan(100);
  expect(glowIdx, 'glow halo must be visible before any adjustment').toBeGreaterThanOrEqual(0);
  return { stroke: [strokeX, DISC.cy], glow: [xs[glowIdx]!, DISC.cy] };
}

function expectClose(actual: Rgba, expected: Rgba, tolerance: number, what: string): void {
  const delta = Math.max(
    Math.abs(actual.r - expected.r),
    Math.abs(actual.g - expected.g),
    Math.abs(actual.b - expected.b),
  );
  expect(delta, `${what}: got ${JSON.stringify(actual)}, expected ≈${JSON.stringify(expected)}`)
    .toBeLessThanOrEqual(tolerance);
}

test.describe('#796 — group adjustments keep child layer effects', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'effects and adjustments panels are desktop-only');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(200);
  });

  test('glow and stroke survive a Vignette node on the parent group, live and in export', async ({ page }) => {
    const layerId = await drawRedDiscWithGlowAndStroke(page);
    const { stroke, glow } = await locateEffects(page, layerId);
    const [strokeBefore, glowBefore] = await readCompositedAt(page, [stroke, glow]);

    const rootId = await getRootGroupId(page);
    await addAdjustment(page, rootId, 'vignette', { vignette: 30 });
    await closeEffectsPanel(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/group-adj-layer-effects.png' });

    // The vignette is negligible this close to the centre (smoothstep from
    // 0.5 of the half-diagonal), so the effects must look the same as
    // before. Before the fix both probes read the white background.
    const [strokeAfter, glowAfter] = await readCompositedAt(page, [stroke, glow]);
    expectClose(strokeAfter!, strokeBefore!, 12, 'stroke ring under vignette');
    expectClose(glowAfter!, glowBefore!, 12, 'glow halo under vignette');

    // A second frame takes the cached pre-adjustment scratch path (#663) —
    // the effects must be part of that cache too.
    await page.waitForTimeout(300);
    const [strokeCached, glowCached] = await readCompositedAt(page, [stroke, glow]);
    expectClose(strokeCached!, strokeBefore!, 12, 'stroke ring (cached group scratch)');
    expectClose(glowCached!, glowBefore!, 12, 'glow halo (cached group scratch)');

    // The corner shows the vignette really is applied to the group.
    const [corner] = await readCompositedAt(page, [[4, 4]]);
    expect(corner!.r).toBeLessThan(230);

    const [strokeExport, glowExport, cornerExport] = await exportPixelsAt(page, [stroke, glow, [4, 4]]);
    expectClose(strokeExport!, strokeAfter!, 12, 'exported stroke ring');
    expectClose(glowExport!, glowAfter!, 12, 'exported glow halo');
    expect(cornerExport!.r).toBeLessThan(230);
  });

  test('adding an adjustment node is undoable from the keyboard', async ({ page }) => {
    const rootId = await getRootGroupId(page);
    const countBefore = await groupAdjustmentCount(page, rootId);
    const [cornerBefore] = await readCompositedAt(page, [[4, 4]]);
    expect(cornerBefore!.r).toBeGreaterThan(245);

    await addAdjustment(page, rootId, 'vignette', { vignette: 30 });
    await closeEffectsPanel(page);
    await page.waitForTimeout(200);
    expect(await groupAdjustmentCount(page, rootId)).toBe(countBefore + 1);
    const [cornerVignetted] = await readCompositedAt(page, [[4, 4]]);
    expect(cornerVignetted!.r).toBeLessThan(230);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await lastHistoryLabel(page)).toBe('Add Adjustment');
    await undo(page);
    await page.waitForTimeout(200);
    expect(await groupAdjustmentCount(page, rootId)).toBe(countBefore);
    // Only the adjustment was undone — not the step before it (creating
    // this 800×600 document).
    expect(await documentWidth(page)).toBe(800);
    const [cornerUndone] = await readCompositedAt(page, [[4, 4]]);
    expect(cornerUndone!.r).toBeGreaterThan(245);

    await redo(page);
    await page.waitForTimeout(200);
    expect(await groupAdjustmentCount(page, rootId)).toBe(countBefore + 1);
  });
});
